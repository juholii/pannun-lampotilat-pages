(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const profileStorageKey = 'pannu-active-profile-v1';
  const profileListStorageKey = 'pannu-profiles-v1';
  const profileControlIds = ['switch-boiler', 'boiler-select', 'rename-boiler', 'delete-boiler', 'restore-model'];
  const validProfileId = id => typeof id === 'string' && /^(?:source|own|boiler-[a-z0-9-]+)$/.test(id);
  let profiles = [{ id: 'source', name: 'Mallipannu' }];
  let activeProfile = 'source';
  try {
    const saved = JSON.parse(localStorage.getItem(profileListStorageKey) || 'null');
    if (Array.isArray(saved) && saved.length && saved.every(profile => profile && validProfileId(profile.id) && typeof profile.name === 'string' && profile.name.trim().length > 0 && profile.name.length <= 60) && new Set(saved.map(profile => profile.id)).size === saved.length) {
      profiles = saved.map(profile => ({ id: profile.id, name: profile.name.trim() }));
    } else if (localStorage.getItem(profileStorageKey) === 'own' || localStorage.getItem('pannu-own-backup-state-v1') || localStorage.getItem('pannu-own-imports-v1') || localStorage.getItem('pannu-own-export-job-v1')) {
      profiles.push({ id: 'own', name: 'Oma pannu' });
    }
    const savedActive = localStorage.getItem(profileStorageKey);
    activeProfile = profiles.some(profile => profile.id === savedActive) ? savedActive : profiles[0].id;
  } catch { /* Keep the source view if browser storage is unavailable. */ }
  const profileKeys = id => id === 'source' ? ['pannu-imports-v1', 'pannu-backup-state-v1', 'pannu-export-job-v1'] : id === 'own' ? ['pannu-own-imports-v1', 'pannu-own-backup-state-v1', 'pannu-own-export-job-v1'] : [`pannu-${id}-imports-v1`, `pannu-${id}-backup-state-v1`, `pannu-${id}-export-job-v1`];
  const ownBoiler = activeProfile !== 'source';
  const [storageKey, backupStorageKey, exportJobStorageKey] = profileKeys(activeProfile);
  const cooldownStorageKey = 'pannu-price-cooldown-v1';
  let priceCooldownUntil = 0;
  let cooldownTimer;
  try {
    const saved = Number(localStorage.getItem(cooldownStorageKey));
    if (Number.isFinite(saved) && saved > Date.now()) priceCooldownUntil = saved;
  } catch { /* The current page can still enforce the pause without storage. */ }
  const directPrices = window.createPannuBrowserPriceService?.({ onWarning: message => notify(message, true) });
  const fmt = value => value === null || value === undefined ? '—' : new Intl.NumberFormat('fi-FI', { maximumFractionDigits: 2 }).format(value);
  const temp = value => value === null || value === undefined ? '—' : `${fmt(value)} °C`;
  const energy = (value, exact = false) => value === null || value === undefined ? '—' : `${exact ? new Intl.NumberFormat('fi-FI', { maximumFractionDigits: 20 }).format(value) : fmt(value)} Wh`;
  const priceFormat = value => value === null || value === undefined ? '—' : new Intl.NumberFormat('fi-FI', { maximumFractionDigits: 20 }).format(value);
  const priceLabel = value => value === null || value === undefined ? '—' : `${priceFormat(value)} snt/kWh`;
  const fields = ['min', 'max', 'consumption'];
  const mode = window.parsePannuCSV.heatingMode;
  const modes = {
    oil: { label: 'Öljy', detail: 'Poltin päällä' },
    electric: { label: 'Sähkö', detail: 'Poltin pois päältä · vastukset' },
    boundary: { label: 'Raja-arvo', detail: 'Tila määrittelemätön' },
    missing: { label: 'Ei tietoa', detail: 'Kulutuslukema puuttuu' }
  };
  const hourLabel = hour => `${String(hour).padStart(2, '0')}:00`;
  const localDate = key => new Date(`${key}T12:00:00`);
  const validDay = key => {
    if (typeof key !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return false;
    const date = new Date(`${key}T12:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === key;
  };
  const todayKey = () => {
    const parts = new Intl.DateTimeFormat('en', { timeZone: 'Europe/Helsinki', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
    const part = type => parts.find(p => p.type === type).value;
    return `${part('year')}-${part('month')}-${part('day')}`;
  };
  const shiftDay = (key, amount) => {
    const date = new Date(`${key}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + amount);
    return date.toISOString().slice(0, 10);
  };
  const monthName = key => localDate(`${key}-01`).toLocaleDateString('fi-FI', { month: 'long', year: 'numeric' });
  const capitalize = text => text.charAt(0).toUpperCase() + text.slice(1);
  const emptyDay = () => Array.from({ length: 24 }, (_, hour) => ({ hour, min: null, max: null, consumption: null }));
  const selectedRows = () => days[selected] || emptyDay();
  const base = ownBoiler ? {} : window.PANNU_DATA?.days || {};
  let imported = {};
  let archivedPrices = {};
  let storageWarning = '';
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || '{}');
    if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
      for (const [date, rows] of Object.entries(saved)) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Array.isArray(rows) || rows.length !== 24) continue;
        // Preserve temperature imports saved by the earlier site version.
        for (const row of rows) if (row && row.consumption === undefined) row.consumption = null;
        if (!rows.every((r, hour) => r && r.hour === hour && fields.every(k => r[k] === null || (typeof r[k] === 'number' && Number.isFinite(r[k]))) && (r.consumption === null || r.consumption >= 0) && (r.min === null || r.max === null || r.min <= r.max))) continue;
        imported[date] = rows;
      }
    }
  } catch { storageWarning = 'Selaimen tallennustila ei ole käytettävissä. Tuodut tiedot ovat käytössä tämän sivun avaamisen ajan.'; }
  try {
    const saved = localStorage.getItem(backupStorageKey);
    if (saved) {
      const restored = validateBackup(JSON.parse(saved));
      imported = { ...imported, ...restored.days };
      archivedPrices = restored.prices;
    }
  } catch { storageWarning = 'Tallennettujen tietojen lukeminen epäonnistui. Voit tuoda ne uudelleen tallentamastasi tiedostosta.'; }
  let days = {};
  let dates = [];
  let selected = '';
  let visibleMonth = '';
  let range = 'all';
  let selectedHour = 0;
  let activeView = 'boiler';
  let chartGeometry = null;
  let energyGeometry = null;
  let priceGeometry = null;
  let priceDay = null;
  let priceLoading = false;
  let priceError = '';
  let priceTimer;
  let priceController;
  let priceRequestId = 0;
  let exportController = null;
  let pendingExport = null;
  try {
    const job = JSON.parse(localStorage.getItem(exportJobStorageKey) || 'null');
    if (job && validDay(job.from) && validDay(job.to) && job.from <= job.to && (Date.parse(`${job.to}T12:00:00Z`) - Date.parse(`${job.from}T12:00:00Z`)) / 86400000 < 366) pendingExport = { from: job.from, to: job.to };
  } catch { /* A malformed saved job does not affect measurements. */ }
  const priceMemory = new Map();
  const ranges = { all: [0, 23], morning: [0, 7], day: [8, 15], evening: [16, 23] };

  function validateBackup(value) {
    const record = item => item && typeof item === 'object' && !Array.isArray(item);
    const numeric = number => number === null || (typeof number === 'number' && Number.isFinite(number));
    if (!record(value) || value.format !== 'pannu-backup' || value.version !== 1 || !record(value.days) || !record(value.prices)) throw new Error('Tiedosto ei ole tuettu Pannu-tallenne.');
    if (value.timeZone !== 'Europe/Helsinki' || value.units?.temperature !== '°C' || value.units?.consumption !== 'Wh' || value.units?.price !== 'snt/kWh') throw new Error('Tallenteen yksiköt tai aikavyöhyke eivät ole tuettuja.');
    const result = { days: {}, prices: {} };
    for (const [date, rows] of Object.entries(value.days)) {
      if (!validDay(date) || !Array.isArray(rows) || rows.length !== 24 || !rows.every((row, hour) => record(row) && row.hour === hour && fields.every(field => numeric(row[field])) && (row.consumption === null || row.consumption >= 0) && (row.min === null || row.max === null || row.min <= row.max))) throw new Error('Tallenteen mittaustiedoissa on virhe.');
      result.days[date] = rows.map(row => ({ hour: row.hour, min: row.min, max: row.max, consumption: row.consumption }));
    }
    for (const [date, entry] of Object.entries(value.prices)) {
      if (!validDay(date) || !record(entry) || entry.date !== date || !Array.isArray(entry.hours) || entry.hours.length !== 24 || !entry.hours.every((row, hour) => record(row) && row.hour === hour && ['available', 'missing'].includes(row.status) && (row.status === 'available' ? typeof row.priceSntPerKwh === 'number' && Number.isFinite(row.priceSntPerKwh) : row.priceSntPerKwh === null))) throw new Error('Tallenteen hintatiedoissa on virhe.');
      result.prices[date] = { date, hours: entry.hours.map(row => ({ hour: row.hour, priceSntPerKwh: row.priceSntPerKwh, status: row.status })), fromCache: true };
    }
    return result;
  }
  function backupDocument(measurements = days, prices = archivedPrices) {
    return { format: 'pannu-backup', version: 1, exportedAt: new Date().toISOString(), timeZone: 'Europe/Helsinki', units: { temperature: '°C', consumption: 'Wh', price: 'snt/kWh' }, selectedDate: selected, days: measurements, prices };
  }
  function persistBrowserData() {
    localStorage.setItem(backupStorageKey, JSON.stringify(backupDocument(imported)));
  }
  function archivePrices(data, { persist = true } = {}) {
    const previous = archivedPrices[data.date];
    const hours = data.hours.map((row, hour) => row.status === 'available' ? { hour, priceSntPerKwh: row.priceSntPerKwh, status: 'available' } : previous?.hours[hour] || { hour, priceSntPerKwh: null, status: 'missing' });
    if (hours.some(row => row.status === 'available' || data.hours[row.hour].status === 'missing')) archivedPrices[data.date] = { date: data.date, hours, fromCache: true };
    if (!persist) return;
    try { persistBrowserData(); }
    catch { notify('Selaimeen tallentaminen ei onnistunut. Vie kaikki tiedot, jos haluat säilyttää ne.', true); }
  }

  function notify(text, error = false) {
    $('notice').textContent = text;
    $('notice').classList.toggle('error', error);
    $('notice').hidden = !text;
  }
  function mergeData() {
    days = structuredClone(base);
    for (const rows of Object.values(days)) for (const row of rows) row.consumption ??= null;
    let conflict = false;
    for (const [date, rows] of Object.entries(imported)) {
      days[date] ||= emptyDay();
      for (const row of rows) {
        const current = days[date][row.hour];
        // Updated source files always take priority over previously imported values.
        const candidate = { ...current };
        for (const field of fields) {
          if (current[field] === null) candidate[field] = row[field];
          else if (row[field] !== null && current[field] !== row[field]) conflict = true;
        }
        if (candidate.min !== null && candidate.max !== null && candidate.min > candidate.max) conflict = true;
        else days[date][row.hour] = candidate;
      }
    }
    dates = Object.keys(days).filter(date => days[date].some(row => fields.some(field => row[field] !== null))).sort();
    $('reset-imports').hidden = !Object.keys(imported).length;
    $('source-name').textContent = ownBoiler ? 'Oman pannun tiedot' : 'Lähteet: Pannun_Anturi ja Consumption';
    $('source-count').textContent = ownBoiler ? `${dates.length} ${dates.length === 1 ? 'päivä' : 'päivää'}` : `${window.PANNU_DATA?.fileCount || 0} lähdetiedostoa · ${dates.length} päivää`;
    if (conflict) notify('Selaimeen aiemmin tuoduissa tiedoissa on ristiriita päivitettyjen lähdetiedostojen kanssa. Lähdetiedostojen lukemia käytetään ensisijaisesti.', true);
  }
  function extremes(rows) {
    const minima = rows.filter(r => r.min !== null);
    const maxima = rows.filter(r => r.max !== null);
    const complete = rows.filter(r => r.min !== null && r.max !== null);
    const min = minima.length ? Math.min(...minima.map(r => r.min)) : null;
    const max = maxima.length ? Math.max(...maxima.map(r => r.max)) : null;
    const spread = complete.length ? Math.max(...complete.map(r => r.max - r.min)) : null;
    return { min, max, spread, complete };
  }
  function energySummary(rows) {
    const readings = rows.filter(r => r.consumption !== null);
    return {
      count: readings.length,
      total: readings.length ? readings.reduce((sum, r) => sum + r.consumption, 0) : null,
      oil: readings.filter(r => mode(r.consumption) === 'oil').length,
      electric: readings.filter(r => mode(r.consumption) === 'electric').length,
      boundary: readings.filter(r => mode(r.consumption) === 'boundary').length
    };
  }
  function timeDescription(rows, test) {
    const hours = rows.filter(test).map(r => hourLabel(r.hour));
    return hours.length ? `Klo ${hours.slice(0, 3).join(', ')}${hours.length > 3 ? ` ja ${hours.length - 3} muuna tuntina` : ''}` : 'Ei mittaustietoja';
  }
  function renderCalendar() {
    const yearKey = visibleMonth.slice(0, 4);
    const months = Array.from({ length: 12 }, (_, i) => `${yearKey}-${String(i + 1).padStart(2, '0')}`);
    $('month-select').replaceChildren(...months.map(month => new Option(capitalize(monthName(month)), month)));
    $('month-select').value = visibleMonth;
    const availableMonths = [...new Set(dates.map(date => date.slice(0, 7)))];
    $('available-months').replaceChildren(...availableMonths.map(month => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'available-month-button';
      button.textContent = capitalize(monthName(month));
      button.setAttribute('aria-pressed', String(month === visibleMonth));
      button.addEventListener('click', () => selectDay(dates.find(date => date.startsWith(month))));
      return button;
    }));
    $('available-months-empty').hidden = availableMonths.length > 0;
    $('date-input').value = selected;
    $('calendar-month').textContent = capitalize(monthName(visibleMonth));
    const [year, month] = visibleMonth.split('-').map(Number);
    const first = localDate(`${visibleMonth}-01`);
    const offset = (first.getDay() + 6) % 7;
    const last = new Date(first); last.setMonth(first.getMonth() + 1); last.setDate(0);
    const length = last.getDate();
    const fragment = document.createDocumentFragment();
    for (let i = 0; i < offset; i++) { const blank = document.createElement('span'); blank.setAttribute('aria-hidden', 'true'); fragment.append(blank); }
    for (let day = 1; day <= length; day++) {
      const date = `${visibleMonth}-${String(day).padStart(2, '0')}`;
      const button = document.createElement('button');
      button.textContent = day;
      button.className = `date-cell${days[date] ? ' available' : ''}${selected === date ? ' selected' : ''}`;
      button.disabled = false;
      button.setAttribute('aria-label', `${day}.${month}.${year}${dates.includes(date) ? ', mittauksia ja sähkön hinnat' : ', näytä sähkön hinnat'}`);
      if (selected === date) button.setAttribute('aria-current', 'date');
      button.addEventListener('click', () => selectDay(date));
      fragment.append(button);
    }
    $('calendar').replaceChildren(fragment);
    $('prev-month').disabled = !validDay(shiftDay(`${visibleMonth}-01`, -1));
    const next = new Date(`${visibleMonth}-01T12:00:00Z`); next.setUTCMonth(next.getUTCMonth() + 1);
    $('next-month').disabled = !validDay(next.toISOString().slice(0, 10));
    const monthDates = dates.filter(date => date.startsWith(visibleMonth));
    const rows = selectedRows();
    const stats = extremes(rows);
    $('month-days').textContent = `${monthDates.length} / ${length}`;
    $('day-summary-min').textContent = temp(stats.min);
    $('day-summary-max').textContent = temp(stats.max);
    for (const field of ['min', 'max']) {
      const button = $(`day-summary-${field}-button`);
      const target = stats[field] === null ? null : rows.find(row => row[field] === stats[field]);
      button.disabled = !target;
      button.dataset.date = target ? selected : '';
      button.dataset.hour = target ? String(target.hour) : '';
      const label = field === 'min' ? 'Päivän alin lämpötila' : 'Päivän ylin lämpötila';
      const description = target ? `${label} ${temp(stats[field])} · Näytä ${localDate(selected).toLocaleDateString('fi-FI')} klo ${hourLabel(target.hour)}` : `${label} · Ei mittauksia valittuna päivänä`;
      button.setAttribute('aria-label', description);
      button.title = description;
    }
    const consumption = energySummary(monthDates.flatMap(date => days[date]));
    $('month-consumption').textContent = energy(consumption.total);
    $('month-consumption-count').textContent = `${consumption.count} / ${length * 24} kulutuslukemaa · saatavilla olevien tuntien summa`;
  }
  function selectDay(date) {
    if (!validDay(date)) return;
    selected = date;
    visibleMonth = date.slice(0, 7);
    if (location.hash !== `#${date}`) history.replaceState(null, '', `#${date}`);
    renderCalendar();
    renderDay();
  }
  function renderDay() {
    $('export-button').disabled = false;
    const rows = selectedRows();
    beginPriceLoad();
    const stats = extremes(rows);
    const date = localDate(selected);
    $('day-title').textContent = capitalize(date.toLocaleDateString('fi-FI', { weekday: 'long' })) + ' ' + date.toLocaleDateString('fi-FI');
    const consumption = energySummary(rows);
    const hasTemperature = rows.some(r => r.min !== null || r.max !== null);
    const hasMeasurements = hasTemperature || consumption.count > 0;
    $('temperature-summary').hidden = $('temperature-panel').hidden = !hasTemperature;
    $('consumption-panel').hidden = !consumption.count;
    $('no-measurements').hidden = hasMeasurements;
    $('day-consumption').textContent = energy(consumption.total);
    $('oil-hours').textContent = consumption.count ? `${consumption.oil} ${consumption.oil === 1 ? 'tunti' : 'tuntia'}` : '—';
    $('electric-hours').textContent = consumption.count ? `${consumption.electric} ${consumption.electric === 1 ? 'tunti' : 'tuntia'}` : '—';
    const knownHours = consumption.oil + consumption.electric;
    const oilPercent = knownHours ? Math.round(consumption.oil / knownHours * 1000) / 10 : null;
    $('oil-share').textContent = knownHours ? `${fmt(oilPercent)} %` : '—';
    $('electric-share').textContent = knownHours ? `${fmt(100 - oilPercent)} %` : '—';
    $('heating-share-note').textContent = knownHours === 24 ? 'Osuudet päivän tunneista.' : knownHours ? `Osuudet tunnetuista tunneista (${knownHours}/24 h).` : 'Lämmitystavan osuuksia ei voida laskea.';
    const mostlyOil = knownHours > 0 && consumption.oil / knownHours > 0.7;
    const mostlyElectric = knownHours > 0 && consumption.electric / knownHours > 0.7;
    const feedback = $('heating-feedback');
    const feedbackStart = selected === todayKey() ? 'Tänään lämmitys painottui' : 'Päivän lämmitys painottui';
    feedback.hidden = !mostlyOil && !mostlyElectric;
    feedback.classList.toggle('oil', mostlyOil);
    feedback.classList.toggle('electric', mostlyElectric);
    feedback.textContent = mostlyOil ? `${feedbackStart} öljyyn. Hyvä valinta, jos pörssisähkö oli öljyä kalliimpaa 🙂` : mostlyElectric ? `${feedbackStart} sähköön. Hyvä valinta, jos sähkö oli öljyä edullisempaa 🙂` : '';
    $('consumption-count').textContent = `${consumption.count} / 24 lukemaa${consumption.count < 24 ? ' · saatavilla olevien tuntien summa' : ''}${consumption.boundary ? ` · ${consumption.boundary} tuntia tasan 1,00 Wh` : ''}`;
    document.title = `${date.toLocaleDateString('fi-FI')} — Pannu`;
    for (const [id, value] of [['day-min', stats.min], ['day-max', stats.max], ['day-range', stats.spread]]) {
      $(id).innerHTML = `${fmt(value)}${value === null ? '' : '<span class="degree">°C</span>'}`;
    }
    $('day-min-time').textContent = timeDescription(rows, r => r.min !== null && r.min === stats.min);
    $('day-max-time').textContent = timeDescription(rows, r => r.max !== null && r.max === stats.max);
    $('day-range-time').textContent = timeDescription(rows, r => r.min !== null && r.max !== null && Math.abs((r.max - r.min) - stats.spread) < 0.000001);
    $('prev-day').disabled = !validDay(shiftDay(selected, -1));
    $('next-day').disabled = !validDay(shiftDay(selected, 1));
    $('latest-day').disabled = !dates.length || selected === dates.at(-1);
    renderView();
    const tbody = document.createDocumentFragment();
    for (const row of rows) {
      const tr = document.createElement('tr');
      tr.dataset.hour = row.hour;
      const diff = row.min === null || row.max === null ? null : row.max - row.min;
      const classification = mode(row.consumption);
      tr.innerHTML = `<td>${hourLabel(row.hour)}</td><td>${temp(row.min)}</td><td>${temp(row.max)}</td><td><div class="range-cell"><span class="range-value">${fmt(diff)}</span>${diff === null ? '' : `<span class="range-track" aria-hidden="true"><i style="width:${stats.spread ? diff / stats.spread * 100 : 0}%"></i></span>`}</div></td><td>${energy(row.consumption, true)}</td><td data-price>${priceCellText(row.hour)}</td><td><span class="mode-badge ${classification}">${modes[classification].label}</span><span class="mode-detail">${modes[classification].detail}</span></td>`;
      tbody.append(tr);
    }
    $('readings-table').replaceChildren(tbody);
    document.querySelector('.table-scroll').scrollTop = 0;
    renderChart();
  }
  function renderView() {
    const prices = activeView === 'prices';
    const rows = selectedRows();
    const complete = extremes(rows).complete.length;
    const consumption = energySummary(rows);
    const hasMeasurements = rows.some(row => fields.some(field => row[field] !== null));
    $('boiler-view').hidden = prices;
    $('prices-view').hidden = !prices;
    $('month-summary').hidden = prices;
    $('latest-day').hidden = prices;
    for (const view of ['boiler', 'prices']) {
      const tab = $(`${view}-tab`);
      const active = view === activeView;
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
    }
    $('table-panel').hidden = !prices && !hasMeasurements;
    $('table-panel').classList.toggle('prices-only', prices);
    $('view-eyebrow').textContent = prices ? 'PÖRSSISÄHKÖN TUNTIHINNAT' : 'PANNUN LÄMPÖTILAT JA LÄMMITYSTAPA';
    $('day-subtitle').textContent = prices ? 'Valitun päivän pörssisähkön tuntihinnat' : hasMeasurements ? `${capitalize(monthName(selected.slice(0, 7)))} · Lämpötilat ${complete}/24 h · Lämmitystapa ${consumption.count}/24 h` : 'Ei pannun mittauksia tältä päivältä';
    $('table-title').textContent = prices ? 'Tuntikohtaiset sähkön hinnat' : 'Tuntikohtaiset lukemat';
    $('table-caption').textContent = `${localDate(selected).toLocaleDateString('fi-FI')} · Kaikki 24 tuntia`;
    $('table-accessible-caption').textContent = prices ? `${selected}, pörssisähkön tuntihinnat` : `${selected}, tunnin alin ja ylin lämpötila ja polttimen tila`;
    $('reading-count').textContent = prices ? '24 tuntia · Hinta snt/kWh' : `Lämpötilat ${complete}/24 h · Lämmitystapa ${consumption.count}/24 h`;
    for (const id of ['chart-tooltip', 'energy-tooltip', 'price-tooltip']) $(id).hidden = true;
  }
  function selectView(view) {
    activeView = view;
    renderView();
  }
  function setRange(next, redraw = true) {
    range = next;
    document.querySelectorAll('[data-range]').forEach(button => {
      const active = button.dataset.range === range;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    if (redraw && selected) renderChart();
  }
  function selectDayExtreme(field) {
    const button = $(`day-summary-${field}-button`);
    if (button.disabled || !validDay(button.dataset.date)) return;
    const date = button.dataset.date;
    selectedHour = Number(button.dataset.hour);
    setRange('all', false);
    selectDay(date);
    selectView('boiler');
    $('hour-select').focus({ preventScroll: true });
    $('temperature-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function renderChart() {
    const [start, end] = ranges[range];
    const rows = selectedRows().slice(start, end + 1);
    const values = rows.flatMap(r => [r.min, r.max]).filter(v => v !== null);
    const bottom = values.length ? Math.floor(Math.min(...values) / 5) * 5 - 5 : 0;
    const top = values.length ? Math.ceil(Math.max(...values) / 5) * 5 + 5 : 100;
    const x = hour => 54 + (hour - start) / (end - start) * 814;
    const y = value => 222 - (value - bottom) / (top - bottom) * 197;
    chartGeometry = { start, end, x, y };
    let svg = `<title id="chart-svg-title">${selected}: tunnin alin ja ylin lämpötila</title><desc id="chart-svg-desc">Sininen viiva on alin ja ruskea ylin lämpötila. Kaikki arvot ovat myös taulukossa kuvaajan alapuolella. Puuttuvan lukeman kohdalla viiva katkeaa.</desc>`;
    const step = Math.max(5, Math.ceil((top - bottom) / 5 / 5) * 5);
    for (let value = bottom; value <= top; value += step) svg += `<line class="gridline" x1="54" x2="868" y1="${y(value)}" y2="${y(value)}"/><text class="axis-label" x="38" y="${y(value) + 4}" text-anchor="end">${fmt(value)}</text>`;
    const tickHours = rows.filter(r => range !== 'all' || r.hour % 3 === 0 || r.hour === end);
    for (const row of tickHours) svg += `<text class="axis-label" x="${x(row.hour)}" y="249" text-anchor="middle">${hourLabel(row.hour)}</text>`;
    // Separate paths preserve gaps: missing readings never become zero or interpolated values.
    const groups = predicate => {
      const output = []; let group = [];
      for (const row of rows) {
        if (predicate(row)) group.push(row);
        else if (group.length) { output.push(group); group = []; }
      }
      if (group.length) output.push(group);
      return output;
    };
    for (const group of groups(r => r.min !== null && r.max !== null)) {
      const points = [...group.map(r => `${x(r.hour)},${y(r.max)}`), ...[...group].reverse().map(r => `${x(r.hour)},${y(r.min)}`)];
      svg += `<polygon class="range-area" points="${points.join(' ')}"/>`;
    }
    for (const field of ['min', 'max']) {
      for (const group of groups(r => r[field] !== null)) {
        svg += `<path class="series ${field}-line" d="${group.map((r, i) => `${i ? 'L' : 'M'}${x(r.hour)},${y(r[field])}`).join(' ')}"/>`;
        for (const r of group) svg += `<circle class="point ${field}-point" cx="${x(r.hour)}" cy="${y(r[field])}" r="3.2"/>`;
      }
    }
    if (!values.length) svg += '<text x="450" y="120" text-anchor="middle" class="axis-label">Tältä aikaväliltä ei ole lukemia</text>';
    svg += '<g id="chart-highlight"></g>';
    $('chart').innerHTML = svg;
    renderEnergyChart();
    renderPricePanel();
    $('hour-select').replaceChildren(...rows.map(r => new Option(hourLabel(r.hour), r.hour)));
    selectedHour = Math.max(start, Math.min(end, selectedHour));
    inspectHour(selectedHour, false);
    $('chart-tooltip').hidden = true;
  }
  function priceCellText(hour) {
    const row = priceDay?.hours[hour];
    if (row?.status === 'available') return priceFormat(row.priceSntPerKwh);
    if (priceLoading) return 'Haetaan…';
    if (row?.status === 'error' || priceError) return 'Haku epäonnistui';
    return 'Ei hintatietoa';
  }
  function updatePriceTable() {
    for (const tr of $('readings-table').children) tr.querySelector('[data-price]').textContent = priceCellText(Number(tr.dataset.hour));
  }
  function beginPriceLoad(force = false) {
    clearTimeout(priceTimer);
    priceController?.abort();
    const requestId = ++priceRequestId;
    const date = selected;
    const cached = priceMemory.get(date);
    const freshCache = !force && cached && Date.now() - cached.savedAt < cached.ttl;
    priceDay = freshCache ? cached.data : archivedPrices[date] || null;
    priceError = '';
    priceLoading = !freshCache;
    if (priceLoading && priceCooldownUntil > Date.now()) {
      priceLoading = false;
      priceError = cooldownMessage();
      updatePriceCooldown();
      return;
    }
    if (!['http:', 'https:'].includes(location.protocol)) {
      priceLoading = false;
      if (!priceDay) priceError = 'Avaa sivusto Avaa-sivusto.cmd-tiedostosta, jotta pörssisähkön hintahaku on käytössä.';
    }
    if (!priceLoading) return;
    // Avoid starting upstream requests for every intermediate day when arrows are pressed quickly.
    priceTimer = setTimeout(async () => {
      const controller = new AbortController();
      priceController = controller;
      const timeout = setTimeout(() => controller.abort(), 90000);
      try {
        const data = await requestPriceDay(date, { refresh: force, signal: controller.signal });
        if (requestId !== priceRequestId || date !== selected) return;
        priceDay = data;
        if (data.hours.some(row => row.reason === 'rate_limit')) startPriceCooldown(data.retryAfterSeconds);
        archivePrices(data);
        const savedHours = archivedPrices[date]?.hours;
        if (savedHours && data.hours.some((row, hour) => row.status !== 'available' && savedHours[hour].status === 'available')) {
          priceDay = { ...data, fromCache: true, hours: data.hours.map((row, hour) => row.status === 'available' || savedHours[hour].status !== 'available' ? row : savedHours[hour]) };
        }
        const complete = data.hours.every(r => r.status === 'available');
        if (data.hours.some(r => r.status !== 'error')) priceMemory.set(date, { data: priceDay, savedAt: Date.now(), ttl: complete ? 600000 : 60000 });
      } catch {
        if (requestId !== priceRequestId || date !== selected) return;
        priceError = directPrices ? 'Hintoja ei voitu hakea. Tarkista internetyhteys ja yritä uudelleen Päivitä hinnat -painikkeella.' : 'Hintoja ei voitu hakea. Tarkista internetyhteys ja paikallisen palvelimen käynnissäolo. Yritä uudelleen Päivitä hinnat -painikkeella.';
      } finally {
        clearTimeout(timeout);
        if (requestId === priceRequestId && date === selected) {
          priceLoading = false;
          renderPricePanel();
          updatePriceTable();
          inspectHour(selectedHour);
        }
      }
    }, force ? 0 : 200);
  }
  function renderPricePanel() {
    const hours = priceDay?.hours || Array.from({ length: 24 }, (_, hour) => ({ hour, priceSntPerKwh: null, status: 'missing' }));
    const available = hours.filter(r => r.status === 'available');
    const failed = hours.filter(r => r.status === 'error').length;
    const limited = hours.some(r => r.reason === 'rate_limit');
    const minimum = available.length ? Math.min(...available.map(r => r.priceSntPerKwh)) : null;
    const maximum = available.length ? Math.max(...available.map(r => r.priceSntPerKwh)) : null;
    $('price-min').textContent = priceLabel(minimum);
    $('price-max').textContent = priceLabel(maximum);
    $('price-average').textContent = available.length ? `${new Intl.NumberFormat('fi-FI', { maximumFractionDigits: 3 }).format(available.reduce((sum, r) => sum + r.priceSntPerKwh, 0) / available.length)} snt/kWh` : '—';
    $('price-average-label').textContent = available.length === 24 ? 'Päivän tuntihintojen keskiarvo' : 'Saatavilla olevien tuntien keskiarvo';
    $('price-min-time').textContent = timeDescription(available, r => r.priceSntPerKwh === minimum);
    $('price-max-time').textContent = timeDescription(available, r => r.priceSntPerKwh === maximum);
    $('price-count').textContent = `${available.length} / 24 tuntihintaa`;
    const status = $('price-status');
    status.classList.toggle('error', Boolean(priceError || failed));
    status.textContent = priceLoading ? 'Haetaan päivän 24 tuntihintaa…' : priceError || (available.length ? `${available.length} / 24 tuntihintaa${priceDay?.fromCache ? ' · Tallennetut API-hinnat' : ' · Haettu API:sta'}${failed ? ` · ${failed} tunnin haku epäonnistui` : ''}${available.length + failed < 24 ? ` · ${24 - available.length - failed} tunnille ei löytynyt hintaa` : ''}` : failed ? 'Hintojen haku epäonnistui. Yritä uudelleen Päivitä hinnat -painikkeella.' : selected >= todayKey() ? 'API:ssa ei ole vielä hintoja tälle päivälle. Tarkista saatavuus myöhemmin Päivitä hinnat -painikkeella.' : 'API:ssa ei ole hintoja tälle päivälle.');
    if (!priceLoading && limited) status.textContent = `${available.length} / 24 tuntihintaa · API:n kutsuraja saavutettiin. Odota noin ${priceDay.retryAfterSeconds || 60} sekuntia ja valitse Päivitä hinnat. Saatavilla olevat hinnat näkyvät edelleen.`;
    $('refresh-prices').disabled = priceLoading || !selected || priceCooldownUntil > Date.now() || !['http:', 'https:'].includes(location.protocol);
    const [start, end] = ranges[range];
    $('price-range').textContent = range === 'all' ? 'Koko päivä' : `${hourLabel(start)}–${hourLabel(end)}`;
    const rows = hours.slice(start, end + 1);
    const values = rows.filter(r => r.status === 'available').map(r => r.priceSntPerKwh);
    const lo = values.length ? Math.min(0, ...values) : 0;
    const hi = values.length ? Math.max(0, ...values) : 1;
    const span = Math.max(1, hi - lo);
    const bottom = lo - span * 0.1;
    const top = hi + span * 0.1;
    const x = hour => 54 + (hour - start) / (end - start) * 814;
    const y = value => 222 - (value - bottom) / (top - bottom) * 197;
    priceGeometry = { x, y, start, end };
    let svg = `<title id="price-svg-title">${selected}: pörssisähkön tuntihinnat</title><desc id="price-svg-desc">API:n palauttamat tuntikeskiarvot sentteinä kilowattitunnilta. Negatiivinen hinta näytetään nollaviivan alapuolella. Puuttuva hinta katkaisee viivan. Tarkat hinnat ovat myös taulukossa.</desc>`;
    for (let i = 0; i <= 4; i++) {
      const value = bottom + (top - bottom) * i / 4;
      svg += `<line class="gridline" x1="54" x2="868" y1="${y(value)}" y2="${y(value)}"/><text class="axis-label" x="38" y="${y(value) + 4}" text-anchor="end">${fmt(value)}</text>`;
    }
    svg += `<line class="zero-line" x1="54" x2="868" y1="${y(0)}" y2="${y(0)}"/>`;
    let path = '';
    let connected = false;
    for (const row of rows) {
      if (range !== 'all' || row.hour % 3 === 0 || row.hour === end) svg += `<text class="axis-label" x="${x(row.hour)}" y="249" text-anchor="middle">${hourLabel(row.hour)}</text>`;
      if (row.status !== 'available') { connected = false; continue; }
      path += `${connected ? 'L' : 'M'}${x(row.hour)},${y(row.priceSntPerKwh)} `;
      connected = true;
      svg += `<circle class="price-point${row.priceSntPerKwh < 0 ? ' negative' : ''}" cx="${x(row.hour)}" cy="${y(row.priceSntPerKwh)}" r="3.5"/>`;
    }
    svg += `<path class="price-line" d="${path}"/>`;
    if (!values.length) svg += `<text x="450" y="120" text-anchor="middle" class="axis-label">${priceLoading ? 'Hintoja haetaan…' : 'Ei hintatietoja tällä aikavälillä'}</text>`;
    svg += '<g id="price-highlight"></g>';
    $('price-chart').innerHTML = svg;
    $('price-hour-select').replaceChildren(...rows.map(r => new Option(hourLabel(r.hour), r.hour)));
    $('price-tooltip').hidden = true;
  }
  function renderEnergyChart() {
    const [start, end] = ranges[range];
    const rows = selectedRows().slice(start, end + 1);
    const slotWidth = 814 / rows.length;
    const x = hour => 54 + (hour - start + 0.5) * slotWidth;
    energyGeometry = { start, end, x, slotWidth };
    $('energy-range').textContent = range === 'all' ? 'Koko päivä' : `${hourLabel(start)}–${hourLabel(end)}`;
    let svg = `<title id="energy-svg-title">${selected}: tuntikohtainen lämmitystapa</title><desc id="energy-svg-desc">Oranssi tarkoittaa öljykäyttöä ja polttimen päälläoloa. Vihreä tarkoittaa sähkövastuksia ja polttimen pois päältä olemista. Harmaa raja-arvo tarkoittaa määrittelemätöntä tilaa. Katkoviivakehys merkitsee puuttuvaa mittausta.</desc>`;
    for (const row of rows) {
      const classification = mode(row.consumption);
      svg += `<rect class="mode-marker ${classification}" x="${x(row.hour) - slotWidth * 0.4}" y="75" width="${slotWidth * 0.8}" height="65" rx="4"/>`;
      if (range !== 'all' || row.hour % 3 === 0 || row.hour === end) svg += `<text class="axis-label" x="${x(row.hour)}" y="170" text-anchor="middle">${hourLabel(row.hour)}</text>`;
    }
    svg += '<g id="energy-highlight"></g>';
    $('energy-chart').innerHTML = svg;
    $('energy-hour-select').replaceChildren(...rows.map(r => new Option(hourLabel(r.hour), r.hour)));
    $('energy-tooltip').hidden = true;
  }
  function inspectHour(hour, tooltip = false) {
    selectedHour = hour;
    const row = selectedRows()[hour];
    $('hour-select').value = hour;
    $('energy-hour-select').value = hour;
    $('price-hour-select').value = hour;
    const diff = row.min !== null && row.max !== null ? row.max - row.min : null;
    $('hour-values').textContent = `Alin ${temp(row.min)} · Ylin ${temp(row.max)} · Ero ${temp(diff)}`;
    const classification = mode(row.consumption);
    $('energy-hour-values').textContent = `${modes[classification].label} · ${modes[classification].detail}`;
    $('price-hour-values').textContent = priceDay?.hours[hour]?.status === 'available' ? priceLabel(priceDay.hours[hour].priceSntPerKwh) : priceCellText(hour);
    $('price-source-link').href = `https://sahkonhinta-api.azurewebsites.net/api/GetPrice?date=${selected}&hour=${String(hour).padStart(2, '0')}`;
    const price = priceDay?.hours[hour];
    $('price-highlight').innerHTML = `<line class="hover-line" x1="${priceGeometry.x(hour)}" x2="${priceGeometry.x(hour)}" y1="20" y2="222"/>${price?.status === 'available' ? `<circle class="price-point" cx="${priceGeometry.x(hour)}" cy="${priceGeometry.y(price.priceSntPerKwh)}" r="5"/>` : ''}`;
    for (const tr of $('readings-table').children) tr.classList.toggle('selected-row', Number(tr.dataset.hour) === hour);
    const { x, y } = chartGeometry;
    $('chart-highlight').innerHTML = `<line class="hover-line" x1="${x(hour)}" x2="${x(hour)}" y1="20" y2="222"/>${['min', 'max'].filter(k => row[k] !== null).map(k => `<circle class="point ${k}-point" cx="${x(hour)}" cy="${y(row[k])}" r="5"/>`).join('')}`;
    $('energy-highlight').innerHTML = `<rect class="selected-energy-hour" x="${energyGeometry.x(hour) - energyGeometry.slotWidth / 2 + 1}" y="65" width="${energyGeometry.slotWidth - 2}" height="85" rx="4"/>`;
    if (tooltip) {
      const box = $('chart-tooltip');
      box.innerHTML = `<strong>Klo ${hourLabel(hour)}</strong>Alin ${temp(row.min)}<br>Ylin ${temp(row.max)}<br>${modes[classification].label} · ${modes[classification].detail}`;
      box.hidden = false;
      const width = $('chart-container').clientWidth;
      box.style.left = `${Math.max(0, Math.min(width - box.offsetWidth, x(hour) / 900 * width + 14))}px`;
      box.style.top = '18px';
    }
  }
  function switchMonth(direction) {
    const date = new Date(`${visibleMonth}-01T12:00:00Z`);
    date.setUTCMonth(date.getUTCMonth() + direction);
    selectDay(date.toISOString().slice(0, 10));
  }
  async function importFiles(fileList) {
    const files = [...fileList].filter(file => /\.csv$/i.test(file.name));
    if (!files.length) { notify('Valinnassa ei ollut CSV-tiedostoja.', true); return; }
    $('import-button').disabled = $('folder-button').disabled = true;
    $('backup-import').disabled = $('reset-imports').disabled = true;
    for (const id of profileControlIds) $(id).disabled = true;
    notify(`Luetaan ${files.length} CSV-tiedostoa…`);
    const pending = structuredClone(imported);
    const combined = structuredClone(days);
    const touched = new Set();
    try {
      for (const file of files) {
        const buffer = await file.arrayBuffer();
        let text;
        try { text = new TextDecoder('utf-8', { fatal: true }).decode(buffer); }
        catch { text = new TextDecoder('windows-1252').decode(buffer); }
        const rows = window.parsePannuCSV(text, file.name);
        for (const row of rows) {
          combined[row.date] ||= emptyDay();
          pending[row.date] ||= emptyDay();
          const current = combined[row.date][row.hour];
          for (const field of fields) {
            if (row[field] === null) continue;
            if (current[field] !== null && current[field] !== row[field]) throw new Error(`${file.name}: ristiriitainen lukema ${row.date} klo ${hourLabel(row.hour)}. Olemassa olevia lukemia ei muutettu.`);
            current[field] = row[field];
            pending[row.date][row.hour][field] = row[field];
          }
          if (current.min !== null && current.max !== null && current.min > current.max) throw new Error(`${file.name}: alin lukema ylittää ylimmän (${row.date}, ${hourLabel(row.hour)}).`);
          touched.add(row.date);
        }
      }
      if (!touched.size) { notify('Valituissa tiedostoissa ei ollut lämpötila- tai kulutuslukemia. Palautettu yhteensä -osiot ohitetaan.'); return; }
      let stored = true;
      imported = pending;
      try { persistBrowserData(); } catch { stored = false; }
      mergeData();
      selectDay([...touched].sort().at(-1));
      notify(`Tuotu ${files.length} tiedostoa, ${touched.size} päivää. ${stored ? 'Tiedot on tallennettu tähän selaimeen.' : 'Selaimeen tallentaminen ei onnistunut. Tiedot ovat käytössä vain tämän sivun avaamisen ajan.'}`, !stored);
    } catch (error) { notify(`Tuonti keskeytettiin. Valittuja tiedostoja ei tuotu.\n${error.message}`, true); }
    finally {
      $('import-button').disabled = $('folder-button').disabled = false;
      $('backup-import').disabled = $('reset-imports').disabled = false;
      for (const id of profileControlIds) $(id).disabled = false;
      $('file-input').value = $('folder-input').value = '';
    }
  }

  async function importBackup(file) {
    if (!file) return;
    $('backup-import').disabled = $('backup-export').disabled = true;
    $('import-button').disabled = $('folder-button').disabled = $('reset-imports').disabled = true;
    for (const id of profileControlIds) $(id).disabled = true;
    try {
      const document = JSON.parse((await file.text()).replace(/^\uFEFF/, ''));
      const restored = validateBackup(document);
      const combined = structuredClone(days);
      const pending = structuredClone(imported);
      for (const [date, rows] of Object.entries(restored.days)) {
        combined[date] ||= emptyDay();
        pending[date] ||= emptyDay();
        for (const row of rows) {
          for (const field of fields) {
            if (row[field] === null) continue;
            const current = combined[date][row.hour];
            if (current[field] !== null && current[field] !== row[field]) throw new Error(`Tallenne sisältää ristiriitaisen mittauksen (${date}, ${hourLabel(row.hour)}). Olemassa olevia tietoja ei muutettu.`);
            current[field] = pending[date][row.hour][field] = row[field];
          }
          const current = combined[date][row.hour];
          if (current.min !== null && current.max !== null && current.min > current.max) throw new Error(`Lämpötilalukemat ovat ristiriidassa (${date}, ${hourLabel(row.hour)}).`);
        }
      }
      const mergedPrices = structuredClone(archivedPrices);
      for (const [date, entry] of Object.entries(restored.prices)) {
        const current = mergedPrices[date];
        mergedPrices[date] = { ...entry, hours: entry.hours.map((row, hour) => current?.hours[hour]?.status === 'available' ? current.hours[hour] : row) };
      }
      // All validation and merging finish before any existing data changes.
      let stored = true;
      try { localStorage.setItem(backupStorageKey, JSON.stringify(backupDocument(pending, mergedPrices))); } catch { stored = false; }
      imported = pending;
      archivedPrices = mergedPrices;
      priceMemory.clear();
      mergeData();
      const restoredDates = [...Object.keys(restored.days), ...Object.keys(restored.prices)].sort();
      const target = validDay(document.selectedDate) ? document.selectedDate : restoredDates.at(-1) || selected;
      setRange('all', false);
      selectDay(target);
      notify(`Tiedot tuotu: ${Object.keys(restored.days).length} mittauspäivää ja ${Object.keys(restored.prices).length} hintapäivää.${stored ? ' Tallennettu tähän selaimeen.' : ' Selaimeen tallentaminen ei onnistunut. Tiedot ovat käytössä tämän sivun avaamisen ajan.'}`, !stored);
    } catch (error) { notify(`Tietoja ei tuotu. ${error.message}`, true); }
    finally {
      $('backup-import').disabled = $('backup-export').disabled = false;
      $('import-button').disabled = $('folder-button').disabled = $('reset-imports').disabled = false;
      for (const id of profileControlIds) $(id).disabled = false;
      $('backup-input').value = '';
    }
  }
  function download(text, type, name) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function openBackupExport() {
    if (exportController) { $('backup-dialog').showModal(); return; }
    $('backup-fetch-prices').checked = false;
    $('backup-fetch-prices').disabled = !['http:', 'https:'].includes(location.protocol);
    $('backup-offline').hidden = !$('backup-fetch-prices').disabled;
    $('backup-date-range').hidden = true;
    $('backup-from').value = dates[0] || selected;
    $('backup-to').value = dates.at(-1) || selected;
    $('backup-progress').textContent = '';
    $('backup-progress').classList.toggle('error', false);
    $('backup-dialog').showModal();
    updatePriceCooldown();
  }
  function cooldownMessage(automatic = Boolean(exportController)) {
    if (automatic) {
      const seconds = Math.max(0, Math.ceil((priceCooldownUntil - Date.now()) / 1000));
      return `Hintapalvelun kutsuraja saavutettiin. Haku jatkuu automaattisesti ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')} kuluttua. Saadut hinnat säilyvät.`;
    }
    const minutes = Math.max(1, Math.ceil((priceCooldownUntil - Date.now()) / 60000));
    return `Hintapalvelun kutsuraja saavutettiin. Jatka hakua ${minutes} minuutin kuluttua. Saadut hinnat säilyvät.`;
  }
  function startPriceCooldown(seconds) {
    const requestedSeconds = Number(seconds);
    const duration = Math.max(60, Number.isFinite(requestedSeconds) ? requestedSeconds : 60);
    priceCooldownUntil = Math.max(priceCooldownUntil, Date.now() + duration * 1000);
    try { localStorage.setItem(cooldownStorageKey, String(priceCooldownUntil)); } catch { /* Keep the pause in memory when storage is full. */ }
    updatePriceCooldown();
  }
  function updatePriceCooldown() {
    clearTimeout(cooldownTimer);
    const paused = priceCooldownUntil > Date.now();
    $('backup-cooldown').hidden = !paused;
    $('backup-cooldown').textContent = paused ? cooldownMessage() : '';
    if (!paused) {
      for (const id of ['backup-progress', 'notice']) {
        const element = $(id);
        element.textContent = (element.textContent || '').replace(/Jatka hakua \d+ minuutin kuluttua\./, 'Voit nyt jatkaa hakua.');
      }
    }
    if (!exportController) $('backup-download').disabled = paused && Boolean($('backup-fetch-prices').checked);
    $('backup-resume').hidden = !pendingExport;
    $('backup-resume-note').hidden = !pendingExport;
    $('backup-resume-note').textContent = pendingExport ? `Keskeneräinen haku: ${localDate(pendingExport.from).toLocaleDateString('fi-FI')}–${localDate(pendingExport.to).toLocaleDateString('fi-FI')}` : '';
    $('backup-resume').disabled = paused || Boolean(exportController) || !['http:', 'https:'].includes(location.protocol);
    $('refresh-prices').disabled = paused || priceLoading || !selected || !['http:', 'https:'].includes(location.protocol);
    if (paused) cooldownTimer = setTimeout(updatePriceCooldown, 1000);
  }
  function saveExportJob(job) {
    pendingExport = job;
    try {
      if (job) localStorage.setItem(exportJobStorageKey, JSON.stringify(job));
      else localStorage.removeItem(exportJobStorageKey);
      return true;
    } catch { return false; }
  }
  async function waitForPriceCooldown(signal) {
    while (priceCooldownUntil > Date.now()) {
      if (signal.aborted) throw new Error('Keskeytetty');
      await new Promise((resolve, reject) => {
        const cancel = () => { clearTimeout(timer); signal.removeEventListener('abort', cancel); reject(new Error('Keskeytetty')); };
        const timer = setTimeout(() => { signal.removeEventListener('abort', cancel); resolve(); }, Math.min(1000, priceCooldownUntil - Date.now()));
        signal.addEventListener('abort', cancel, { once: true });
        if (signal.aborted) cancel();
      });
    }
    if (signal.aborted) throw new Error('Keskeytetty');
  }
  function validatePriceDay(data, date) {
    if (data?.date !== date || !Array.isArray(data.hours) || data.hours.length !== 24 || !data.hours.every((row, hour) => row.hour === hour && ['available', 'missing', 'error'].includes(row.status) && (row.status === 'available' ? typeof row.priceSntPerKwh === 'number' && Number.isFinite(row.priceSntPerKwh) : row.priceSntPerKwh === null))) throw new Error('Hintapalvelin palautti virheelliset tiedot.');
  }
  async function requestPriceDay(date, { refresh = false, batch = false, hours, signal } = {}) {
    let data;
    if (directPrices) data = await directPrices.getDay(date, { refresh, batch, hours, signal });
    else {
      const response = await fetch(`/api/prices?date=${date}${refresh ? '&refresh=1' : ''}${batch ? `&mode=export&hours=${hours.join(',')}` : ''}`, { signal });
      if (!response.ok) throw new Error('Hintapalveluun ei saatu yhteyttä.');
      data = await response.json();
    }
    validatePriceDay(data, date);
    return data;
  }
  async function fetchExportDay(date, signal, refresh = false, hours = Array.from({ length: 24 }, (_, hour) => hour)) {
    const controller = new AbortController();
    const cancel = () => controller.abort();
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) controller.abort();
    const timer = setTimeout(cancel, 90000);
    try {
      const data = await requestPriceDay(date, { refresh, batch: true, hours, signal: controller.signal });
      if (signal.aborted) throw new Error('Keskeytetty');
      return data;
    } finally { clearTimeout(timer); signal.removeEventListener('abort', cancel); }
  }
  async function exportBackup() {
    if (exportController) return;
    const fetchPrices = Boolean($('backup-fetch-prices').checked);
    const from = $('backup-from').value;
    const to = $('backup-to').value;
    if (fetchPrices && (!validDay(from) || !validDay(to) || from > to || !['http:', 'https:'].includes(location.protocol))) {
      $('backup-progress').textContent = 'Valitse kelvollinen aikaväli: alkamispäivä ennen päättymispäivää tai sama päivä.';
      $('backup-progress').classList.toggle('error', true);
      return;
    }
    if (!fetchPrices) {
      download(JSON.stringify(backupDocument(), null, 2), 'application/json;charset=utf-8', `pannu-kaikki-tiedot-${todayKey()}.json`);
      $('backup-dialog').close();
      notify('Kaikki mittaukset ja tallennetut sähkön hinnat on viety tiedostoon.');
      return;
    }
    const numberOfDays = (Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86400000 + 1;
    if (numberOfDays > 366) {
      $('backup-progress').textContent = 'Hae sähkön hinnat enintään 366 päivältä kerrallaan. Pidemmän ajan voit hakea osissa.';
      $('backup-progress').classList.toggle('error', true);
      return;
    }
    if (priceCooldownUntil > Date.now()) {
      $('backup-progress').textContent = cooldownMessage();
      $('backup-progress').classList.toggle('error', true);
      updatePriceCooldown();
      return;
    }
    const requestedDates = [];
    for (let date = from; date <= to; date = shiftDay(date, 1)) {
      requestedDates.push(date);
      if (date === to) break;
    }
    const results = new Map();
    const reusedDates = new Set();
    let consecutiveErrors = 0;
    let stoppedReason = '';
    let exportStored = true;
    const controller = new AbortController();
    exportController = controller;
    if (!saveExportJob({ from, to })) exportStored = false;
    for (const id of ['backup-download', 'backup-fetch-prices', 'backup-from', 'backup-to', 'backup-import', 'import-button', 'folder-button', 'reset-imports', ...profileControlIds]) $(id).disabled = true;
    $('backup-progress').classList.toggle('error', false);
    $('backup-stop').hidden = false;
    try {
      dayLoop: for (const [index, date] of requestedDates.entries()) {
        if (controller.signal.aborted) break;
        const saved = archivedPrices[date];
        if (saved?.hours.every(row => row.status === 'available')) {
          results.set(date, saved);
          reusedDates.add(date);
          consecutiveErrors = 0;
          continue;
        }
        $('backup-progress').textContent = `Haetaan puuttuvia tuntihintoja rauhallisesti · ${localDate(date).toLocaleDateString('fi-FI')} · ${index + 1}/${requestedDates.length} päivää. Päivän haku voi kestää noin puoli minuuttia.`;
        try {
          let pauses = 0;
          while (!controller.signal.aborted) {
            const missingHours = Array.from({ length: 24 }, (_, hour) => hour).filter(hour => archivedPrices[date]?.hours[hour]?.status !== 'available');
            if (!missingHours.length) break;
            const data = await fetchExportDay(date, controller.signal, pauses > 0, missingHours);
            archivePrices(data, { persist: false });
            try { persistBrowserData(); } catch { exportStored = false; }
            results.set(date, data);
            if (!missingHours.some(hour => data.hours[hour].reason === 'rate_limit')) break;
            startPriceCooldown(data.retryAfterSeconds);
            if (pauses >= 3 || priceCooldownUntil - Date.now() > 900000) {
              stoppedReason = `Hintapalvelu pyytää lisää odotusaikaa. ${cooldownMessage(false)}`;
              break dayLoop;
            }
            pauses++;
            $('backup-progress').textContent = 'Hintahaku on tauolla ja jatkuu automaattisesti. Voit keskeyttää haun ja viedä saadut tiedot.';
            await waitForPriceCooldown(controller.signal);
            $('backup-progress').textContent = `Jatketaan puuttuvista tunneista · ${localDate(date).toLocaleDateString('fi-FI')} · ${index + 1}/${requestedDates.length} päivää.`;
          }
        } catch {
          if (controller.signal.aborted) break;
          if (!results.has(date)) results.set(date, { date, hours: Array.from({ length: 24 }, (_, hour) => ({ hour, status: 'error', priceSntPerKwh: null })) });
        }
        consecutiveErrors = results.get(date)?.hours.every(row => row.status === 'error') ? consecutiveErrors + 1 : 0;
        if (consecutiveErrors >= 3) {
          stoppedReason = 'Hintapalvelu ei vastannut kolmeen peräkkäiseen päivähakuun. Voit jatkaa myöhemmin.';
          break;
        }
      }
      const report = requestedDates.map(date => {
        const rows = results.get(date)?.hours;
        let availableHours = 0, missingHours = 0, failedHours = 0, pendingHours = 0;
        for (let hour = 0; hour < 24; hour++) {
          if (archivedPrices[date]?.hours[hour]?.status === 'available') availableHours++;
          else if (rows?.[hour].status === 'missing') missingHours++;
          else if (!rows || rows[hour].reason === 'rate_limit') pendingHours++;
          else failedHours++;
        }
        return { date, requested: Boolean(rows) && !reusedDates.has(date), fromCache: reusedDates.has(date), availableHours, missingHours, failedHours, pendingHours };
      });
      const summary = { from, to, cancelled: controller.signal.aborted, stoppedReason, totalHours: requestedDates.length * 24, availableHours: report.reduce((sum, day) => sum + day.availableHours, 0), missingHours: report.reduce((sum, day) => sum + day.missingHours, 0), failedHours: report.reduce((sum, day) => sum + day.failedHours, 0), pendingHours: report.reduce((sum, day) => sum + day.pendingHours, 0), days: report };
      const document = { ...backupDocument(), priceExport: summary };
      if (!summary.pendingHours && !summary.failedHours) saveExportJob(null);
      try { persistBrowserData(); } catch { exportStored = false; }
      download(JSON.stringify(document, null, 2), 'application/json;charset=utf-8', `pannu-kaikki-tiedot-${todayKey()}.json`);
      const message = `${summary.cancelled ? 'Haku keskeytettiin. ' : ''}${stoppedReason ? `${stoppedReason} ` : ''}Tiedosto tallennettu. Valitun ajan hinnat: ${summary.availableHours}/${summary.totalHours} tuntia.${summary.missingHours ? ` ${summary.missingHours} tunnille ei löytynyt hintaa.` : ''}${summary.failedHours ? ` ${summary.failedHours} tunnin haku epäonnistui.` : ''}${summary.pendingHours ? ` ${summary.pendingHours} tuntia odottaa vielä hakua. Vie sama aikaväli uudelleen jatkaaksesi puuttuvista tunneista.` : ''}${exportStored ? '' : ' Selaintallennus ei onnistunut; säilytä viety tiedosto.'}`;
      $('backup-progress').textContent = message;
      $('backup-progress').classList.toggle('error', Boolean(summary.failedHours || summary.pendingHours || !exportStored));
      notify(message, Boolean(summary.failedHours || summary.pendingHours || !exportStored));
      if (archivedPrices[selected]) {
        priceDay = archivedPrices[selected];
        priceMemory.delete(selected);
        renderPricePanel(); updatePriceTable(); inspectHour(selectedHour);
      }
    } catch {
      $('backup-progress').textContent = 'Vienti epäonnistui. Voit yrittää uudelleen; olemassa olevat mittaukset säilyvät.';
      $('backup-progress').classList.toggle('error', true);
      notify($('backup-progress').textContent, true);
    } finally {
      exportController = null;
      for (const id of ['backup-download', 'backup-fetch-prices', 'backup-from', 'backup-to', 'backup-import', 'import-button', 'folder-button', 'reset-imports', ...profileControlIds]) $(id).disabled = false;
      $('backup-stop').hidden = true;
      updatePriceCooldown();
    }
  }

  for (const view of ['boiler', 'prices']) {
    $(`${view}-tab`).addEventListener('click', () => selectView(view));
    $(`${view}-tab`).addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 'boiler' : event.key === 'End' ? 'prices' : view === 'boiler' ? 'prices' : 'boiler';
      selectView(next);
      $(`${next}-tab`).focus();
    });
  }
  $('prev-day').addEventListener('click', () => selectDay(shiftDay(selected, -1)));
  $('next-day').addEventListener('click', () => selectDay(shiftDay(selected, 1)));
  $('latest-day').addEventListener('click', () => selectDay(dates.at(-1)));
  $('today-day').addEventListener('click', () => selectDay(todayKey()));
  $('tomorrow-day').addEventListener('click', () => selectDay(shiftDay(todayKey(), 1)));
  $('date-input').addEventListener('change', event => { if (validDay(event.target.value)) selectDay(event.target.value); else event.target.value = selected; });
  $('prev-month').addEventListener('click', () => switchMonth(-1));
  $('next-month').addEventListener('click', () => switchMonth(1));
  $('month-select').addEventListener('change', event => selectDay(`${event.target.value}-01`));
  $('day-summary-min-button').addEventListener('click', () => selectDayExtreme('min'));
  $('day-summary-max-button').addEventListener('click', () => selectDayExtreme('max'));
  document.querySelectorAll('[data-range]').forEach(button => button.addEventListener('click', () => {
    setRange(button.dataset.range);
  }));
  $('hour-select').addEventListener('change', event => inspectHour(Number(event.target.value)));
  $('energy-hour-select').addEventListener('change', event => inspectHour(Number(event.target.value)));
  $('price-hour-select').addEventListener('change', event => inspectHour(Number(event.target.value)));
  $('refresh-prices').addEventListener('click', () => {
    if (!selected) return;
    beginPriceLoad(true); renderPricePanel(); updatePriceTable(); inspectHour(selectedHour);
  });
  $('chart').addEventListener('pointermove', event => {
    if (!chartGeometry) return;
    const rect = $('chart').getBoundingClientRect();
    const position = (event.clientX - rect.left) / rect.width * 900;
    const { start, end } = chartGeometry;
    inspectHour(Math.max(start, Math.min(end, Math.round(start + (position - 54) / 814 * (end - start)))), true);
  });
  $('chart').addEventListener('pointerleave', () => { $('chart-tooltip').hidden = true; });
  $('energy-chart').addEventListener('pointermove', event => {
    if (!energyGeometry || !selected) return;
    const rect = $('energy-chart').getBoundingClientRect();
    const position = (event.clientX - rect.left) / rect.width * 900;
    const { start, end, x, slotWidth } = energyGeometry;
    const hour = Math.max(start, Math.min(end, start + Math.floor((position - 54) / slotWidth)));
    inspectHour(hour);
    const row = selectedRows()[hour];
    const classification = mode(row.consumption);
    const box = $('energy-tooltip');
    box.innerHTML = `<strong>Klo ${hourLabel(hour)}</strong>${modes[classification].label}<br>${modes[classification].detail}`;
    box.hidden = false;
    const width = $('energy-chart-container').clientWidth;
    box.style.left = `${Math.max(0, Math.min(width - box.offsetWidth, x(hour) / 900 * width + 14))}px`;
    box.style.top = '18px';
  });
  $('energy-chart').addEventListener('pointerleave', () => { $('energy-tooltip').hidden = true; });
  $('price-chart').addEventListener('pointermove', event => {
    if (!priceGeometry || !selected) return;
    const rect = $('price-chart').getBoundingClientRect();
    const position = (event.clientX - rect.left) / rect.width * 900;
    const { start, end, x } = priceGeometry;
    const hour = Math.max(start, Math.min(end, Math.round(start + (position - 54) / 814 * (end - start))));
    inspectHour(hour);
    const box = $('price-tooltip');
    const row = priceDay?.hours[hour];
    box.innerHTML = `<strong>Klo ${hourLabel(hour)}</strong>${row?.status === 'available' ? priceLabel(row.priceSntPerKwh) : priceCellText(hour)}`;
    box.hidden = false;
    const width = $('price-chart-container').clientWidth;
    box.style.left = `${Math.max(0, Math.min(width - box.offsetWidth, x(hour) / 900 * width + 14))}px`;
    box.style.top = '18px';
  });
  $('price-chart').addEventListener('pointerleave', () => { $('price-tooltip').hidden = true; });
  $('import-button').addEventListener('click', () => $('file-input').click());
  $('folder-button').addEventListener('click', () => $('folder-input').click());
  $('file-input').addEventListener('change', e => importFiles(e.target.files));
  $('folder-input').addEventListener('change', e => importFiles(e.target.files));
  function renderProfiles() {
    $('boiler-select').replaceChildren(...profiles.map(profile => new Option(profile.name, profile.id)));
    $('boiler-select').value = activeProfile;
    $('restore-model').hidden = profiles.some(profile => profile.id === 'source');
    $('boiler-profile-note').textContent = ownBoiler ? 'Tuo oman pannusi tiedot käyttämällä nappia Tuo tallennetut tiedot' : 'Näyttää kansioiden mittaukset.';
  }
  function newProfileId() {
    let id;
    do { id = `boiler-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`; } while (profiles.some(profile => profile.id === id));
    return id;
  }
  function saveProfileChanges(nextProfiles, nextActive, removedId) {
    const keys = [profileListStorageKey, profileStorageKey, ...(removedId ? profileKeys(removedId) : [])];
    const previous = new Map();
    try {
      for (const key of keys) previous.set(key, localStorage.getItem(key));
      localStorage.setItem(profileListStorageKey, JSON.stringify(nextProfiles));
      localStorage.setItem(profileStorageKey, nextActive);
      if (removedId) for (const key of profileKeys(removedId)) localStorage.removeItem(key);
    } catch {
      for (const [key, value] of previous) {
        try { if (value === null || value === undefined) localStorage.removeItem(key); else localStorage.setItem(key, value); } catch { /* Keep the current view and report failed storage. */ }
      }
      return false;
    }
    profiles = nextProfiles;
    return true;
  }
  function reloadProfile() {
    history.replaceState(null, '', location.pathname || 'index.html');
    location.reload();
  }
  let editingProfile = false;
  function openProfileName(rename) {
    if (exportController || $('switch-boiler').disabled) return;
    editingProfile = rename;
    let number = 1;
    while (profiles.some(profile => profile.name === `Pannu ${number}`)) number++;
    $('boiler-name').value = rename ? profiles.find(profile => profile.id === activeProfile).name : `Pannu ${number}`;
    $('boiler-dialog-title').textContent = rename ? 'Nimeä pannu uudelleen' : 'Uusi pannu';
    $('save-boiler').textContent = rename ? 'Tallenna nimi' : 'Luo pannu';
    $('boiler-name-error').hidden = true;
    $('boiler-dialog').showModal();
    $('boiler-name').focus();
  }
  renderProfiles();
  $('switch-boiler').addEventListener('click', () => openProfileName(false));
  $('rename-boiler').addEventListener('click', () => openProfileName(true));
  $('close-boiler-dialog').addEventListener('click', () => $('boiler-dialog').close());
  $('boiler-form').addEventListener('submit', event => {
    event.preventDefault();
    if (exportController || $('switch-boiler').disabled) return;
    const name = $('boiler-name').value.trim();
    let error = '';
    if (!name || name.length > 60) error = 'Anna pannulle nimi (1–60 merkkiä).';
    else if (profiles.some(profile => (!editingProfile || profile.id !== activeProfile) && profile.name.toLocaleLowerCase('fi-FI') === name.toLocaleLowerCase('fi-FI'))) error = 'Tämä nimi on jo käytössä. Anna toinen nimi.';
    if (!error) {
      const id = editingProfile ? activeProfile : newProfileId();
      const next = editingProfile ? profiles.map(profile => profile.id === id ? { ...profile, name } : profile) : [...profiles, { id, name }];
      if (!saveProfileChanges(next, id)) error = 'Pannun tallentaminen ei onnistunut. Salli selaimen tallennustila ja yritä uudelleen.';
      else {
        $('boiler-dialog').close();
        if (editingProfile) { renderProfiles(); notify('Pannun nimi tallennettu.'); }
        else reloadProfile();
      }
    }
    $('boiler-name-error').textContent = error;
    $('boiler-name-error').hidden = !error;
  });
  $('boiler-select').addEventListener('change', event => {
    const id = event.target.value;
    if (exportController || $('boiler-select').disabled || !profiles.some(profile => profile.id === id) || id === activeProfile) { $('boiler-select').value = activeProfile; return; }
    if (saveProfileChanges(profiles, id)) reloadProfile();
    else { $('boiler-select').value = activeProfile; notify('Pannun vaihtaminen ei onnistunut. Salli selaimen tallennustila ja yritä uudelleen.', true); }
  });
  $('delete-boiler').addEventListener('click', () => {
    if (exportController || $('delete-boiler').disabled) return;
    const profile = profiles.find(item => item.id === activeProfile);
    $('delete-boiler-note').textContent = `Pannun ”${profile.name}” selaimeen tallennetut tiedot poistetaan.${ownBoiler ? '' : ' Kansioiden alkuperäiset tiedostot säilyvät.'}`;
    $('delete-boiler-dialog').showModal();
  });
  for (const id of ['close-delete-boiler', 'cancel-delete-boiler']) $(id).addEventListener('click', () => $('delete-boiler-dialog').close());
  $('confirm-delete-boiler').addEventListener('click', () => {
    if (exportController || $('delete-boiler').disabled) return;
    const next = profiles.filter(profile => profile.id !== activeProfile);
    if (!next.length) next.push({ id: newProfileId(), name: 'Pannu 1' });
    if (saveProfileChanges(next, next[0].id, activeProfile)) reloadProfile();
    else { $('delete-boiler-dialog').close(); notify('Pannun poistaminen ei onnistunut. Tiedot säilyvät nykyisessä näkymässä.', true); }
  });
  $('restore-model').addEventListener('click', () => {
    if (exportController || $('restore-model').disabled || profiles.some(profile => profile.id === 'source')) return;
    if (saveProfileChanges([{ id: 'source', name: 'Mallipannu' }, ...profiles], 'source')) reloadProfile();
    else notify('Mallipannun avaaminen ei onnistunut. Salli selaimen tallennustila ja yritä uudelleen.', true);
  });
  $('backup-export').addEventListener('click', openBackupExport);
  $('backup-fetch-prices').addEventListener('change', event => { $('backup-date-range').hidden = !event.target.checked; updatePriceCooldown(); });
  $('backup-download').addEventListener('click', exportBackup);
  $('backup-resume').addEventListener('click', () => {
    if (!pendingExport || exportController || priceCooldownUntil > Date.now()) return;
    $('backup-from').value = pendingExport.from;
    $('backup-to').value = pendingExport.to;
    $('backup-fetch-prices').checked = true;
    $('backup-date-range').hidden = false;
    return exportBackup();
  });
  $('backup-stop').addEventListener('click', () => exportController?.abort());
  $('close-backup').addEventListener('click', () => $('backup-dialog').close());
  $('backup-import').addEventListener('click', () => $('backup-input').click());
  $('backup-input').addEventListener('change', event => importBackup(event.target.files[0]));
  $('reset-imports').addEventListener('click', () => {
    try {
      localStorage.setItem(backupStorageKey, JSON.stringify(backupDocument({}, archivedPrices)));
      localStorage.removeItem(storageKey);
    } catch { notify('Tallennettuja tietoja ei voitu poistaa selaimesta.', true); return; }
    imported = {};
    mergeData();
    selectDay(validDay(selected) ? selected : todayKey());
    notify(ownBoiler ? 'Selaimeen tuodut mittaukset poistettiin.' : 'Selaimeen tuodut tiedot poistettiin. CSV-kansion lukemat säilyvät.');
  });
  $('export-button').addEventListener('click', () => {
    if (!selected) return;
    const csv = '\uFEFFPäivämäärä;Kellonaika;Alin lämpötila (°C);Ylin lämpötila (°C);Vaihteluväli (°C);Sähkönkulutus (Wh);Lämmitystapa;Polttimen tila;Pörssisähkö (snt/kWh)\r\n' + selectedRows().map(r => {
      const numeric = v => v === null ? '' : String(Number(v.toFixed(2))).replace('.', ',');
      const classification = mode(r.consumption);
      const price = priceDay?.hours[r.hour];
      return [selected, hourLabel(r.hour), numeric(r.min), numeric(r.max), numeric(r.min === null || r.max === null ? null : r.max - r.min), r.consumption === null ? '' : String(r.consumption).replace('.', ','), modes[classification].label, modes[classification].detail, price?.status === 'available' ? String(price.priceSntPerKwh).replace('.', ',') : ''].join(';');
    }).join('\r\n');
    download(csv, 'text/csv;charset=utf-8', `pannu-${selected}.csv`);
  });
  $('help-button').addEventListener('click', () => $('help-dialog').showModal());
  $('close-help').addEventListener('click', () => $('help-dialog').close());
  $('help-dialog').addEventListener('click', event => { if (event.target === $('help-dialog') && (event.clientX < event.target.getBoundingClientRect().left || event.clientX > event.target.getBoundingClientRect().right || event.clientY < event.target.getBoundingClientRect().top || event.clientY > event.target.getBoundingClientRect().bottom)) event.target.close(); });
  window.addEventListener('hashchange', () => { const date = location.hash.slice(1); if (validDay(date)) selectDay(date); });
  mergeData();
  selectDay(validDay(location.hash.slice(1)) ? location.hash.slice(1) : dates.at(-1) || todayKey());
  if (storageWarning) notify(storageWarning, true);
  if (window.PANNU_DATA_ERROR && !ownBoiler) notify(window.PANNU_DATA_ERROR, true);
})();
