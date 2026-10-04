(() => {
'use strict';
const SOURCE = 'https://sahkonhinta-api.azurewebsites.net/api/GetPrice';
function validDate(date) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(`${date}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}
function parsePrice(payload, date, hour) {
  if (!payload || payload.date !== date || !/^(?:[01]?\d|2[0-3])$/.test(String(payload.hour)) || Number(payload.hour) !== hour) throw new Error('API:n vastauksen päivä tai tunti ei vastaa pyyntöä.');
  const price = payload.average_price_snt_per_kwh;
  if (price === null) return null;
  if (typeof price !== 'number' || !Number.isFinite(price)) throw new Error('API ei palauttanut kelvollista average_price_snt_per_kwh-arvoa.');
  return price;
}

function pause(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason); return; }
    const cancel = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', cancel); resolve(); }, milliseconds);
    signal?.addEventListener('abort', cancel, { once: true });
  });
}
function createPriceService({ fetchImpl = fetch, readCache, writeCache, readCooldown = () => 0, onRateLimit = () => {}, onCacheError = error => console.warn('Hintavälimuisti ei ole käytettävissä:', error.message), now = Date.now, timeoutMs = 12000, defaultRetryMs = 60000, minimumRetryMs = 60000, requestIntervalMs = 250, batchIntervalMs = 1000, sleep = pause } = {}) {
  const memory = new Map();
  const running = new Map();
  const queue = [];
  let active = 0;
  let blockedUntil = 0;
  let nextRequestAt = 0;
  let admission = Promise.resolve();
  let fallbackRetryMs = defaultRetryMs;
  function admit(batch, signal) {
    const permit = admission.then(async () => {
      signal?.throwIfAborted();
      const savedCooldown = readCooldown();
      if (Number.isFinite(savedCooldown)) blockedUntil = Math.max(blockedUntil, savedCooldown);
      if (now() < blockedUntil) return false;
      const delay = nextRequestAt - now();
      if (delay > 0) await sleep(delay, signal);
      signal?.throwIfAborted();
      if (now() < blockedUntil) return false;
      nextRequestAt = now() + (batch ? batchIntervalMs : requestIntervalMs);
      return true;
    });
    admission = permit.catch(() => {});
    return permit;
  }
  const rateLimited = hour => ({ hour, priceSntPerKwh: null, status: 'error', error: 'Hintapalvelun kutsuraja saavutettu', reason: 'rate_limit' });
  function limited(task, signal) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) { reject(signal.reason); return; }
      queue.push({ task, resolve, reject, signal }); drain();
    });
  }
  function drain() {
    while (active < 4 && queue.length) {
      const item = queue.shift(); active++;
      Promise.resolve().then(item.task).then(item.resolve, item.reject).finally(() => { active--; drain(); });
    }
  }
  function usableCache(cache, date) {
    if (!cache || !Number.isFinite(cache.savedAt) || cache.savedAt > now() || cache.data?.date !== date || !Array.isArray(cache.data.hours) || cache.data.hours.length !== 24) return false;
    if (!cache.data.hours.every((r, hour) => r.hour === hour && ['available', 'missing', 'error'].includes(r.status) && (r.status === 'available' ? typeof r.priceSntPerKwh === 'number' && Number.isFinite(r.priceSntPerKwh) : r.priceSntPerKwh === null))) return false;
    return true;
  }
  function validCache(cache, date) {
    if (!usableCache(cache, date)) return false;
    const ttl = cache.data.hours.every(r => r.status === 'available') ? 24 * 60 * 60 * 1000 : 60 * 1000;
    return now() - cache.savedAt < ttl;
  }
  async function fetchHour(date, hour, batch, signal) {
    return limited(async () => {
      if (!await admit(batch, signal)) return rateLimited(hour);
      const url = new URL(SOURCE);
      url.searchParams.set('date', date);
      url.searchParams.set('hour', String(hour).padStart(2, '0'));
      try {
        const timeout = AbortSignal.timeout(timeoutMs);
        const response = await fetchImpl(url, { signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
        if (response.status === 429) {
          const retry = response.headers?.get('retry-after');
          const milliseconds = retry && /^\d+(?:\.\d+)?$/.test(retry) ? Number(retry) * 1000 : retry ? Date.parse(retry) - now() : fallbackRetryMs;
          blockedUntil = Math.max(blockedUntil, now() + Math.max(1000, minimumRetryMs, Number.isFinite(milliseconds) ? milliseconds : fallbackRetryMs));
          if (!retry) fallbackRetryMs = Math.min(900000, fallbackRetryMs * 2);
          onRateLimit(blockedUntil);
          return rateLimited(hour);
        }
        if (response.status === 404) return { hour, priceSntPerKwh: null, status: 'missing' };
        if (!response.ok) throw new Error(`API HTTP ${response.status}`);
        const price = parsePrice(await response.json(), date, hour);
        return { hour, priceSntPerKwh: price, status: price === null ? 'missing' : 'available' };
      } catch (error) {
        if (signal?.aborted) throw signal.reason;
        return { hour, priceSntPerKwh: null, status: 'error', error: error.name === 'TimeoutError' ? 'Haun aikakatkaisu' : 'Hinnan haku epäonnistui' };
      }
    }, signal);
  }
  async function load(date, refresh, batch, requestedHours, signal) {
    signal?.throwIfAborted();
    let cached = memory.get(date);
    if (!cached && readCache) {
      try { cached = await readCache(date); } catch (error) { onCacheError(error); }
    }
    signal?.throwIfAborted();
    if (!refresh && validCache(cached, date) && (!batch || requestedHours.every(hour => cached.data.hours[hour].status !== 'error'))) { memory.set(date, cached); return { ...cached.data, fromCache: true }; }
    const previous = usableCache(cached, date) ? cached.data.hours : null;
    const wanted = new Set(requestedHours);
    const cancelQueued = () => {
      for (let index = queue.length - 1; index >= 0; index--) {
        if (queue[index].signal !== signal) continue;
        queue.splice(index, 1)[0].reject(signal.reason);
      }
    };
    signal?.addEventListener('abort', cancelQueued, { once: true });
    let hours;
    try {
      hours = await Promise.all(Array.from({ length: 24 }, async (_, hour) => {
        if (batch && previous?.[hour].status === 'available') return previous[hour];
        if (batch && !wanted.has(hour)) return previous?.[hour] || { hour, priceSntPerKwh: null, status: 'missing' };
        return fetchHour(date, hour, batch, signal);
      }));
    } finally { signal?.removeEventListener('abort', cancelQueued); }
    signal?.throwIfAborted();
    const savedAt = now();
    const data = { date, hours, fetchedAt: new Date(savedAt).toISOString(), source: SOURCE, fromCache: false };
    if (hours.some(r => r.reason === 'rate_limit')) data.retryAfterSeconds = Math.max(1, Math.ceil((blockedUntil - now()) / 1000));
    // Do not preserve a completely failed request as a successful cache entry.
    if (hours.some(r => r.status !== 'error')) {
      const cached = { savedAt, data };
      memory.set(date, cached);
      if (writeCache) {
        try { await writeCache(date, cached); } catch (error) { onCacheError(error); }
      }
    }
    return data;
  }
  function getDay(date, { refresh = false, batch = false, hours = Array.from({ length: 24 }, (_, hour) => hour), signal } = {}) {
    if (!validDate(date)) return Promise.reject(new Error('Virheellinen päivämäärä.'));
    if (!Array.isArray(hours) || !hours.length || hours.length > 24 || !hours.every(hour => Number.isInteger(hour) && hour >= 0 && hour < 24) || new Set(hours).size !== hours.length) return Promise.reject(new Error('Virheellinen tuntivalinta.'));
    if (signal) return load(date, refresh, batch, hours, signal);
    const key = batch ? `${date}:batch:${[...hours].sort((a, b) => a - b).join(',')}` : date;
    if (running.has(key)) return running.get(key);
    const task = load(date, refresh, batch, hours).finally(() => running.delete(key));
    running.set(key, task);
    return task;
  }
  return { getDay };
}

const api = { createPriceService, parsePrice, validDate, SOURCE };
if (typeof module === 'object' && module.exports) module.exports = api;
else window.PannuPrices = api;
})();
