// Outils de dates. Toutes les dates sont des chaînes « AAAA-MM-JJ » en UTC.
export const DAY = 86400000;

export const toISO = (ms) => new Date(ms).toISOString().slice(0, 10);
export const parseISO = (s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
export const addDays = (s, n) => toISO(parseISO(s) + n * DAY);
export const diffDays = (a, b) => Math.round((parseISO(b) - parseISO(a)) / DAY);
export const todayISO = () => toISO(Date.now());
export const minDate = (a, b) => (a < b ? a : b);
export const maxDate = (a, b) => (a > b ? a : b);

export function dateRange(start, end) {
  const out = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}

// Découpe [start, end] en tranches d'au plus `size` jours.
export function chunkRange(start, end, size) {
  const out = [];
  for (let s = start; s <= end; s = addDays(s, size)) out.push([s, minDate(addDays(s, size - 1), end)]);
  return out;
}

// Instant (ms) où commence la journée `dateStr` dans le fuseau donné.
// Meta découpe ses journées à minuit, heure du Pacifique.
export function zonedMidnight(dateStr, timeZone) {
  const guess = parseISO(dateStr);
  const offsetAt = (ms) => {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: 'numeric', second: 'numeric',
    }).formatToParts(new Date(ms));
    const p = Object.fromEntries(parts.map((x) => [x.type, +x.value]));
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - ms;
  };
  let t = guess - offsetAt(guess);
  t = guess - offsetAt(t);
  return t;
}
