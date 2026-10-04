function parseCSV(text, name = 'CSV') {
  const readings = new Map();
  let section = null;
  let ignoredSectionSeen = false;
  for (const raw of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (/^Alin\s+l/i.test(line)) { section = 'min'; continue; }
    if (/^Ylin\s+l/i.test(line)) { section = 'max'; continue; }
    if (/^(?:Kulutus(?:\s+yhteensä)?|Consumption)$/i.test(line)) { section = 'consumption'; continue; }
    if (/^\(?Palautettu\s+yhteensä\)?$/i.test(line)) { section = 'ignored'; ignoredSectionSeen = true; continue; }
    // Returned energy is deliberately excluded, including its headers and rows.
    if (section === 'ignored') continue;
    if (/^Aika\s*[,;]/i.test(line)) continue;
    const match = line.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})\s*[,;]\s*(-?\d+(?:[.,]\d+)?)\s*$/);
    if (!match || !section) throw new Error(`${name}: tunnistamaton rivi: ${line}`);
    const [, dd, mm, yyyy, hh, minutes, rawValue] = match;
    const date = `${yyyy}-${mm}-${dd}`;
    const hour = Number(hh);
    const parsed = new Date(`${date}T12:00:00Z`);
    if (Number(mm) < 1 || Number(mm) > 12 || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date || hour > 23 || minutes !== '00') {
      throw new Error(`${name}: virheellinen päivämäärä tai tunti: ${line}`);
    }
    const key = `${date}T${hh}`;
    const row = readings.get(key) || { date, hour, min: null, max: null, consumption: null };
    const value = Number(rawValue.replace(',', '.'));
    if (!Number.isFinite(value) || (section === 'consumption' && value < 0)) throw new Error(`${name}: virheellinen kulutus tai lukema: ${line}`);
    if (row[section] !== null && row[section] !== value) throw new Error(`${name}: ristiriitaiset lukemat: ${key}`);
    row[section] = value;
    readings.set(key, row);
  }
  if (!readings.size && !ignoredSectionSeen) throw new Error(`${name}: ei lämpötila- tai kulutuslukemia.`);
  for (const row of readings.values()) {
    if (row.min !== null && row.max !== null && row.min > row.max) throw new Error(`${name}: alin lukema ylittää ylimmän (${row.date} klo ${row.hour}).`);
  }
  return [...readings.values()].sort((a, b) => a.date.localeCompare(b.date) || a.hour - b.hour);
}

function heatingMode(value) {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'missing';
  if (value < 1) return 'oil';
  if (value > 1) return 'electric';
  return 'boundary';
}
parseCSV.heatingMode = heatingMode;

if (typeof module !== "undefined" && module.exports) module.exports = parseCSV;
else window.parsePannuCSV = parseCSV;
