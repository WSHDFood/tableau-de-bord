// Séries quotidiennes. Format stocké, compact :
//   { start: 'AAAA-MM-JJ', clicks: [12, 15, null, …], impressions: […] }
// Pendant la collecte on manipule une Map date -> { métrique: valeur }.
import { addDays, diffDays } from './dates.js';

export function dailyToMap(daily) {
  const map = new Map();
  if (!daily || !daily.start) return map;
  const metrics = Object.keys(daily).filter((k) => k !== 'start' && Array.isArray(daily[k]));
  const len = Math.max(0, ...metrics.map((m) => daily[m].length));
  for (let i = 0; i < len; i++) {
    const row = {};
    for (const m of metrics) {
      const v = daily[m][i];
      if (v !== null && v !== undefined) row[m] = v;
    }
    if (Object.keys(row).length) map.set(addDays(daily.start, i), row);
  }
  return map;
}

export function mapToDaily(map, metrics) {
  const dates = [...map.keys()].sort();
  const out = { start: dates[0] || null };
  const n = dates.length ? diffDays(dates[0], dates[dates.length - 1]) + 1 : 0;
  for (const m of metrics) out[m] = new Array(n).fill(null);
  for (const [date, row] of map) {
    const i = diffDays(out.start, date);
    for (const m of metrics) {
      const v = row[m];
      if (typeof v === 'number' && Number.isFinite(v)) out[m][i] = v;
    }
  }
  return out;
}

// Les valeurs fraîches remplacent les anciennes, jour par jour et métrique par métrique.
export function mergeInto(base, fresh) {
  for (const [date, row] of fresh) base.set(date, { ...(base.get(date) || {}), ...row });
  return base;
}

export function put(map, date, values) {
  const clean = {};
  for (const [k, v] of Object.entries(values)) if (typeof v === 'number' && Number.isFinite(v)) clean[k] = v;
  if (Object.keys(clean).length) map.set(date, { ...(map.get(date) || {}), ...clean });
}

export function lastDateWith(map, metric) {
  let last = null;
  for (const [date, row] of map) if (row[metric] !== undefined && (last === null || date > last)) last = date;
  return last;
}
