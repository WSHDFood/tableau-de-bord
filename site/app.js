/* Tableau de bord : lit le fichier de données (chiffré), le déchiffre dans le navigateur
   avec le mot de passe, puis dessine tout. Aucune bibliothèque externe. */
(() => {
  'use strict';

  const DAY = 86400000;
  const PERIODS = [
    { days: 7, label: '7 jours' }, { days: 28, label: '28 jours' },
    { days: 90, label: '3 mois' }, { days: 365, label: '12 mois' },
  ];
  const NETWORKS = {
    instagram: { label: 'Instagram', color: 'var(--ig)' },
    facebook: { label: 'Facebook', color: 'var(--fb)' },
    linkedin: { label: 'LinkedIn', color: 'var(--li)' },
  };
  const SITE_METRICS = {
    clicks: { label: 'Clics', fmt: (v) => compact(v), full: (v) => int(v) },
    impressions: { label: 'Impressions', fmt: (v) => compact(v), full: (v) => int(v) },
    ctr: { label: 'Taux de clic', fmt: (v) => pct(v), full: (v) => pct(v) },
    position: { label: 'Position moyenne', fmt: (v) => dec(v), full: (v) => dec(v), invert: true },
  };
  const ACCOUNT_METRICS = {
    views: { label: 'Vues', agg: 'sum' },
    reach: { label: 'Couverture', agg: 'mean' },
    interactions: { label: 'Interactions', agg: 'sum' },
    followers: { label: 'Abonnés', agg: 'last' },
  };

  const state = { data: null, period: 28, route: 'apercu', siteMetric: 'clicks', accountMetric: 'views', sort: {}, expanded: {} };
  const root = document.getElementById('app');

  /* ---------- Dates et nombres ---------- */
  const parseISO = (s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
  const toISO = (ms) => new Date(ms).toISOString().slice(0, 10);
  const addDays = (s, n) => toISO(parseISO(s) + n * DAY);
  const diffDays = (a, b) => Math.round((parseISO(b) - parseISO(a)) / DAY);
  const dShort = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const dLong = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  const dStamp = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
  const day = (s) => dShort.format(parseISO(s));
  const dayLong = (s) => dLong.format(parseISO(s));

  const nf0 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
  const nf1 = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const nfAuto = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
  const NONE = '—';
  const int = (v) => (v == null ? NONE : nf0.format(v));
  const dec = (v) => (v == null ? NONE : nf1.format(v));
  const pct = (v) => (v == null ? NONE : `${nf1.format(v * 100)} %`);
  function compact(v) {
    if (v == null) return NONE;
    const a = Math.abs(v);
    if (a >= 1e6) return `${nfAuto.format(v / 1e6)} M`;
    if (a >= 1e4) return `${nfAuto.format(v / 1e3)} k`;
    return a < 10 && !Number.isInteger(v) ? nfAuto.format(v) : nf0.format(v);
  }
  const signed = (v, f) => (v > 0 ? `+${f(v)}` : v < 0 ? `−${f(-v)}` : f(0));

  /* ---------- Petits outils d'affichage ---------- */
  function el(tag, attrs, ...kids) {
    const node = document.createElement(tag);
    apply(node, attrs, kids);
    return node;
  }
  function svg(tag, attrs, ...kids) {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    apply(node, attrs, kids);
    return node;
  }
  function apply(node, attrs, kids) {
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else if (k === 'hidden') node.hidden = !!v;
      else node.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) {
      if (kid == null || kid === false) continue;
      node.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
  }
  // Les libellés viennent des API : on n'accepte en lien que des adresses web ordinaires.
  const safeUrl = (u) => (typeof u === 'string' && /^https?:\/\//i.test(u) ? u : null);

  /* ---------- Calculs sur les séries ---------- */
  function windowOf(daily, metric, end, days) {
    const out = new Array(days).fill(null);
    const values = daily && daily[metric];
    if (!values || !daily.start || !end) return out;
    const first = diffDays(daily.start, end) - days + 1;
    for (let k = 0; k < days; k++) {
      const v = values[first + k];
      if (v != null) out[k] = v;
    }
    return out;
  }
  const count = (a) => a.reduce((n, v) => n + (v != null ? 1 : 0), 0);
  const sum = (a) => (count(a) ? a.reduce((s, v) => s + (v || 0), 0) : null);
  const mean = (a) => (count(a) ? sum(a) / count(a) : null);
  const last = (a) => { for (let i = a.length - 1; i >= 0; i--) if (a[i] != null) return a[i]; return null; };
  const first = (a) => { for (let i = 0; i < a.length; i++) if (a[i] != null) return a[i]; return null; };
  const AGG = { sum, mean, last };
  const covered = (a) => count(a) >= a.length * 0.9;
  function addUp(list, days) {
    const out = new Array(days).fill(null);
    for (const a of list) for (let k = 0; k < days; k++) if (a[k] != null) out[k] = (out[k] || 0) + a[k];
    return out;
  }
  function weighted(values, weights) {
    let w = 0; let total = 0;
    for (let k = 0; k < values.length; k++) if (values[k] != null && weights[k]) { total += values[k] * weights[k]; w += weights[k]; }
    return w ? total / w : null;
  }

  // Un point par jour jusqu'à 3 mois, un point par semaine sur 12 mois.
  const bucketSize = (days) => (days > 120 ? 7 : 1);
  function buckets(days) {
    const size = bucketSize(days);
    const n = Math.floor(days / size);
    return { size, n, used: n * size };
  }
  const chunk = (a, size) => { const out = []; for (let i = 0; i + size <= a.length; i += size) out.push(a.slice(i, i + size)); return out; };

  function sitePoints(sites, metric, end, days) {
    const { size, used } = buckets(days);
    const c = addUp(sites.map((s) => windowOf(s.daily, 'clicks', end, used)), used);
    const i = addUp(sites.map((s) => windowOf(s.daily, 'impressions', end, used)), used);
    const p = sites.length === 1 ? windowOf(sites[0].daily, 'position', end, used) : null;
    const cc = chunk(c, size); const ii = chunk(i, size); const pp = p ? chunk(p, size) : null;
    return cc.map((_, k) => {
      if (metric === 'clicks') return sum(cc[k]);
      if (metric === 'impressions') return sum(ii[k]);
      if (metric === 'ctr') return sum(ii[k]) ? sum(cc[k]) / sum(ii[k]) : null;
      return pp ? weighted(pp[k], ii[k]) : null;
    });
  }
  function siteTotals(sites, end, days) {
    const c = addUp(sites.map((s) => windowOf(s.daily, 'clicks', end, days)), days);
    const i = addUp(sites.map((s) => windowOf(s.daily, 'impressions', end, days)), days);
    const p = sites.length === 1 ? windowOf(sites[0].daily, 'position', end, days) : null;
    const clicks = sum(c); const impressions = sum(i);
    return { clicks, impressions, ctr: impressions ? clicks / impressions : null, position: p ? weighted(p, i) : null, covered: covered(i) };
  }
  function accountPoints(accounts, metric, end, days) {
    const { size, used } = buckets(days);
    const values = addUp(accounts.map((a) => windowOf(a.daily, metric, end, used)), used);
    return chunk(values, size).map(AGG[ACCOUNT_METRICS[metric].agg]);
  }
  function accountTotals(account, end, days) {
    if (!end) return { followers: account.followers == null ? null : account.followers, followersChange: null, views: null, viewsBefore: null, reach: null, reachBefore: null, interactions: null, interactionsBefore: null, clicks: null };
    const w = (m, e = end) => windowOf(account.daily, m, e, days);
    const before = addDays(end, -days);
    const followers = w('followers');
    const followersBefore = last(windowOf(account.daily, 'followers', before, 3));
    const now = last(followers) != null ? last(followers) : account.followers;
    return {
      followers: now,
      followersChange: now != null && followersBefore != null ? now - followersBefore : null,
      views: sum(w('views')), viewsBefore: covered(w('views', before)) ? sum(w('views', before)) : null,
      reach: mean(w('reach')), reachBefore: covered(w('reach', before)) ? mean(w('reach', before)) : null,
      interactions: sum(w('interactions')), interactionsBefore: covered(w('interactions', before)) ? sum(w('interactions', before)) : null,
      clicks: sum(w('clicks')),
    };
  }
  function axisLabels(end, days) {
    const { size, n, used } = buckets(days);
    const start = addDays(end, -(used - 1));
    const short = []; const long = [];
    for (let k = 0; k < n; k++) {
      const d = addDays(start, k * size);
      short.push(day(d));
      long.push(size === 1 ? dayLong(d) : `Semaine du ${day(d)} au ${day(addDays(d, size - 1))}`);
    }
    return { short, long };
  }
  const maxDate = (list) => list.reduce((m, d) => (d && (!m || d > m) ? d : m), null);
  const seoEnd = (sites) => maxDate(sites.map((s) => s.status && s.status.lastDate));
  // Pour additionner plusieurs comptes, on s'arrête au dernier jour connu de tous
  // (LinkedIn publie avec deux jours de décalage), sans attendre un compte en panne.
  function socialEnd(accounts) {
    const dates = accounts.map((a) => a.status && a.status.lastDate).filter(Boolean);
    const newest = maxDate(dates);
    if (!newest) return null;
    const floor = addDays(newest, -5);
    return dates.filter((d) => d >= floor).reduce((m, d) => (d < m ? d : m), newest);
  }

  /* ---------- Évolutions ---------- */
  // kind : 'pct' (variation relative), 'abs' (écart en nombre), 'pts' (points de taux), 'rank' (places gagnées).
  function change(kind, value) {
    if (value == null || !Number.isFinite(value)) return el('span', { class: 'chg none' }, NONE);
    const text = { pct: (v) => `${nf1.format(v * 100)} %`, abs: (v) => compact(v), pts: (v) => `${nf1.format(v * 100)} pt`, rank: (v) => nf1.format(v) }[kind];
    const tiny = kind === 'abs' ? Math.abs(value) < 0.5 : kind === 'rank' ? Math.abs(value) < 0.05 : Math.abs(value) < 0.0005;
    if (tiny) return el('span', { class: 'chg flat', title: 'Stable' }, '=');
    const up = value > 0;
    const label = kind === 'rank' ? text(Math.abs(value)) : signed(value, text);
    return el('span', { class: `chg ${up ? 'up' : 'down'}`, title: up ? 'En hausse' : 'En baisse' }, el('i', { 'aria-hidden': 'true' }, up ? '▲' : '▼'), label);
  }
  const rel = (now, before) => (now == null || before == null || before === 0 ? null : (now - before) / before);

  /* ---------- Graphique en courbes ---------- */
  function niceScale(lo, hi, target) {
    const span = hi - lo || 1;
    const raw = span / target;
    const mag = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw);
    const min = Math.floor(lo / step + 1e-9) * step;
    const max = Math.ceil(hi / step - 1e-9) * step;
    const ticks = [];
    for (let v = min; v <= max + step / 2; v += step) ticks.push(Math.round(v / step) * step);
    return { min, max: ticks[ticks.length - 1], ticks };
  }

  // cfg : { labels, longLabels, series: [{ name, color, values, muted }], fmt, full, invert, area, endLabels }
  function lineChart(host, cfg) {
    const tip = el('div', { class: 'tip', hidden: true });
    let geo = null; let cursor = null; let active = -1;

    function draw() {
      const W = Math.floor(host.clientWidth);
      if (W < 60) return;
      const H = W < 520 ? 200 : 236;
      const all = cfg.series.flatMap((s) => s.values.filter((v) => v != null));
      host.replaceChildren();
      if (!all.length) { host.append(el('p', { class: 'empty' }, 'Pas encore de données sur cette période.')); geo = null; return; }
      let lo = Math.min(...all); let hi = Math.max(...all);
      if (!cfg.invert && !cfg.tight) lo = Math.min(0, lo);
      if (cfg.invert) lo = Math.max(1, Math.floor(lo));
      if (hi <= lo) hi = lo + 1;
      const scale = niceScale(lo, hi, 4);
      if (cfg.invert && scale.min < 1) { scale.min = 1; scale.ticks = scale.ticks.filter((t) => t >= 1); if (scale.ticks[0] !== 1) scale.ticks.unshift(1); }
      const tickText = scale.ticks.map(cfg.fmt);
      const n = cfg.labels.length;
      const main = cfg.series.filter((s) => !s.muted);

      // Libellés en bout de courbe : seulement s'ils ne se chevauchent pas.
      const top = 10; const bottom = 24;
      const ph = H - top - bottom;
      const y = (v) => top + (cfg.invert ? (v - scale.min) / (scale.max - scale.min) : 1 - (v - scale.min) / (scale.max - scale.min)) * ph;
      let ends = [];
      if (cfg.endLabels && W >= 620 && main.length > 1) {
        ends = main.map((s) => ({ s, y: last(s.values) == null ? null : y(last(s.values)) })).filter((e) => e.y != null).sort((a, b) => a.y - b.y);
        if (ends.some((e, k) => k > 0 && e.y - ends[k - 1].y < 14)) ends = [];
      }
      const left = Math.max(...tickText.map((t) => t.length)) * 6.4 + 12;
      const right = ends.length ? Math.max(...ends.map((e) => e.s.name.length)) * 6.2 + 16 : 12;
      const pw = W - left - right;
      const x = (i) => left + (n <= 1 ? pw / 2 : (i * pw) / (n - 1));

      const g = svg('svg', { viewBox: `0 0 ${W} ${H}`, height: H, role: 'img', tabindex: '0', 'aria-label': cfg.title, style: 'touch-action:pan-y' });
      scale.ticks.forEach((t, k) => {
        const baseline = cfg.invert ? t === scale.max : t === scale.min;
        g.append(
          svg('line', { x1: left, x2: left + pw, y1: y(t), y2: y(t), stroke: baseline ? 'var(--axis)' : 'var(--grid)', 'stroke-width': 1 }),
          svg('text', { class: 'tick', x: left - 8, y: y(t) + 3.5, 'text-anchor': 'end' }, tickText[k]),
        );
      });
      const wanted = W < 520 ? 3 : 5;
      const marks = n <= wanted ? [...Array(n).keys()] : [...new Set(Array.from({ length: wanted }, (_, k) => Math.round((k * (n - 1)) / (wanted - 1))))];
      marks.forEach((i, k) => {
        g.append(svg('text', { class: 'tick', x: x(i), y: H - 6, 'text-anchor': n === 1 ? 'middle' : k === 0 ? 'start' : k === marks.length - 1 ? 'end' : 'middle' }, cfg.labels[i]));
      });

      const path = (values) => {
        let d = ''; let pen = false;
        values.forEach((v, i) => {
          if (v == null) { pen = false; return; }
          d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`;
          pen = true;
        });
        return d;
      };
      // Les courbes de contexte (période précédente) passent dessous.
      for (const s of [...cfg.series].sort((a, b) => (b.muted ? 1 : 0) - (a.muted ? 1 : 0))) {
        if (cfg.area && !s.muted && main.length === 1) {
          const pts = s.values.map((v, i) => [i, v]).filter(([, v]) => v != null);
          if (pts.length > 1) {
            const base = y(cfg.invert ? scale.max : scale.min);
            const d = `M${x(pts[0][0]).toFixed(1)} ${base}` + pts.map(([i, v]) => `L${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join('') + `L${x(pts[pts.length - 1][0]).toFixed(1)} ${base}Z`;
            g.append(svg('path', { d, fill: s.color, 'fill-opacity': 0.1, stroke: 'none' }));
          }
        }
        g.append(svg('path', { d: path(s.values), fill: 'none', stroke: s.color, 'stroke-width': s.muted ? 1.5 : 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
      }
      for (const s of main) {
        let i = s.values.length - 1;
        while (i >= 0 && s.values[i] == null) i--;
        if (i >= 0) g.append(svg('circle', { cx: x(i), cy: y(s.values[i]), r: 4, fill: s.color, stroke: 'var(--surface)', 'stroke-width': 2 }));
      }
      for (const e of ends) g.append(svg('text', { class: 'end', x: left + pw + 10, y: e.y + 4 }, e.s.name));

      cursor = svg('g', { hidden: true });
      g.append(cursor);
      const hit = svg('rect', { x: left, y: top, width: Math.max(0, pw), height: ph, fill: 'transparent' });
      g.append(hit);
      host.append(g, tip);
      geo = { x, y, left, pw, n, W, top, base: top + ph };

      const pick = (ev) => {
        const box = g.getBoundingClientRect();
        const px = ((ev.clientX - box.left) / box.width) * W;
        show(Math.max(0, Math.min(n - 1, Math.round(((px - left) / (pw || 1)) * (n - 1)))));
      };
      hit.addEventListener('pointermove', pick);
      hit.addEventListener('pointerdown', pick);
      hit.addEventListener('pointerleave', hide);
      g.addEventListener('focus', () => show(active >= 0 ? active : n - 1));
      g.addEventListener('blur', hide);
      g.addEventListener('keydown', (ev) => {
        if (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight') return;
        ev.preventDefault();
        show(Math.max(0, Math.min(n - 1, (active < 0 ? n - 1 : active) + (ev.key === 'ArrowLeft' ? -1 : 1))));
      });
    }

    function show(i) {
      if (!geo) return;
      active = i;
      cursor.replaceChildren(svg('line', { x1: geo.x(i), x2: geo.x(i), y1: geo.top, y2: geo.base, stroke: 'var(--axis)', 'stroke-width': 1 }));
      tip.replaceChildren(el('div', { class: 'when' }, cfg.longLabels[i]));
      for (const s of cfg.series) {
        const v = s.values[i];
        if (v != null) cursor.append(svg('circle', { cx: geo.x(i), cy: geo.y(v), r: 4, fill: s.color, stroke: 'var(--surface)', 'stroke-width': 2 }));
        tip.append(el('div', { class: 'row' },
          el('span', { class: 'key', style: `border-color:${s.color}` }), el('b', {}, (cfg.full || cfg.fmt)(v)), el('span', {}, s.name)));
      }
      cursor.removeAttribute('hidden');
      tip.hidden = false;
      const px = (geo.x(i) / geo.W) * host.clientWidth;
      const w = tip.offsetWidth;
      tip.style.left = `${px + 14 + w > host.clientWidth ? Math.max(0, px - 14 - w) : px + 14}px`;
    }
    function hide() {
      active = -1;
      if (cursor) cursor.setAttribute('hidden', '');
      tip.hidden = true;
    }

    draw();
    let width = host.clientWidth;
    if (typeof ResizeObserver === 'function') {
      new ResizeObserver(() => { if (Math.abs(host.clientWidth - width) > 1) { width = host.clientWidth; draw(); } }).observe(host);
    }
  }

  // Bloc graphique complet : titre, légende, courbes et bascule vers le tableau des mêmes valeurs.
  function figure(cfg, tools) {
    const host = el('div', { class: 'chart' });
    const full = cfg.full || cfg.fmt;
    const table = el('div', { class: 'scroll tall', hidden: true },
      el('table', {},
        el('thead', {}, el('tr', {}, el('th', {}, 'Date'), cfg.series.map((s) => el('th', { class: 'num' }, s.name)))),
        el('tbody', {}, cfg.labels.map((_, i) => el('tr', {}, el('td', {}, cfg.longLabels[i]), cfg.series.map((s) => el('td', { class: 'num' }, full(s.values[i]))))))));
    const toggle = el('button', { class: 'link', type: 'button', 'aria-pressed': 'false', onclick: () => {
      const on = table.hidden;
      table.hidden = !on; host.hidden = on;
      toggle.setAttribute('aria-pressed', String(on));
      toggle.textContent = on ? 'Voir le graphique' : 'Voir les valeurs';
    } }, 'Voir les valeurs');
    const node = el('figure', { class: 'figure' },
      el('header', {}, el('h3', {}, cfg.title), el('div', { class: 'tools' }, tools, toggle)),
      cfg.series.length > 1 && el('ul', { class: 'legend' }, cfg.series.map((s) => el('li', {}, el('span', { class: 'key', style: `border-color:${s.color}` }), s.name))),
      host, table);
    // Le graphique se mesure une fois placé dans la page.
    requestAnimationFrame(() => lineChart(host, cfg));
    return node;
  }

  function sparkline(values, color) {
    const w = 92; const h = 26;
    const pts = values.map((v, i) => [i, v]).filter(([, v]) => v != null);
    if (pts.length < 2) return el('span', { class: 'chg none' }, NONE);
    const lo = Math.min(0, ...pts.map((p) => p[1])); const hi = Math.max(...pts.map((p) => p[1])) || 1;
    const x = (i) => 2 + (i * (w - 8)) / (values.length - 1);
    const y = (v) => 3 + (1 - (v - lo) / (hi - lo || 1)) * (h - 6);
    const d = pts.map(([i, v], k) => `${k ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join('');
    const end = pts[pts.length - 1];
    return svg('svg', { class: 'spark', width: w, height: h, viewBox: `0 0 ${w} ${h}`, 'aria-hidden': 'true' },
      svg('path', { d: `${d}L${x(end[0]).toFixed(1)} ${h - 2}L${x(pts[0][0]).toFixed(1)} ${h - 2}Z`, fill: color, 'fill-opacity': 0.1 }),
      svg('path', { d, fill: 'none', stroke: color, 'stroke-width': 1.5, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }),
      svg('circle', { cx: x(end[0]), cy: y(end[1]), r: 2.6, fill: color }));
  }
  // Courbe de tendance : au plus ~30 points pour rester lisible.
  function trend(values) {
    const size = Math.max(1, Math.ceil(values.length / 30));
    return size === 1 ? values : chunk(values.slice(values.length % size), size).map(sum);
  }

  /* ---------- Tableau triable ---------- */
  function dataTable(id, columns, rows, { limit, defaultSort } = {}) {
    const sort = state.sort[id] || defaultSort || null;
    let sorted = rows;
    if (sort) {
      const col = columns.find((c) => c.key === sort.key);
      if (col && col.value) {
        sorted = [...rows].sort((a, b) => {
          const va = col.value(a); const vb = col.value(b);
          if (va == null && vb == null) return 0;
          if (va == null) return 1;
          if (vb == null) return -1;
          return (typeof va === 'string' ? va.localeCompare(vb, 'fr') : va - vb) * sort.dir;
        });
      }
    }
    const open = state.expanded[id];
    const shown = limit && !open ? sorted.slice(0, limit) : sorted;
    const head = columns.map((c) => {
      const on = sort && sort.key === c.key;
      const th = el('th', { class: c.num ? 'num' : null, 'aria-sort': on ? (sort.dir > 0 ? 'ascending' : 'descending') : null });
      if (c.value) {
        th.append(el('button', { type: 'button', 'data-fk': `tri-${id}-${c.key}`, onclick: () => {
          state.sort[id] = { key: c.key, dir: on ? -sort.dir : (c.first || -1) };
          render();
        } }, c.label, el('span', { class: 'dir', 'aria-hidden': 'true' }, on ? (sort.dir > 0 ? ' ▲' : ' ▼') : '')));
      } else th.append(c.label);
      return th;
    });
    const node = el('div', {},
      el('div', { class: 'scroll' }, el('table', {},
        el('thead', {}, el('tr', {}, head)),
        el('tbody', {}, shown.map((r) => el('tr', {}, columns.map((c) => el('td', { class: c.num ? 'num' : c.cls || null }, c.cell(r)))))))));
    if (limit && rows.length > limit) {
      node.append(el('button', { class: 'link more', type: 'button', 'data-fk': `plus-${id}`, onclick: () => { state.expanded[id] = !open; render(); } },
        open ? 'Réduire la liste' : `Afficher les ${rows.length} lignes`));
    }
    return node;
  }

  const stat = (label, value, cmp) => el('div', { class: 'stat' }, el('div', { class: 'label' }, label), el('div', { class: 'value' }, value), cmp && el('div', { class: 'cmp' }, cmp));
  const flag = (entity) => (entity.status && entity.status.ok === false ? el('a', { class: 'flag', href: '#sources', title: entity.status.message || '' }, 'à vérifier') : null);
  const periodLabel = () => PERIODS.find((p) => p.days === state.period).label;
  const versus = () => `par rapport aux ${periodLabel()} précédents`;

  /* ---------- Vue d'ensemble ---------- */
  function overview() {
    const { sites, accounts } = state.data;
    const days = state.period;
    if (!sites.length && !accounts.length) {
      return el('section', { class: 'panel' }, el('h2', {}, 'Rien n’est encore branché'),
        el('p', { class: 'lead' }, 'Dès qu’une source sera connectée, ses chiffres apparaîtront ici à la mise à jour suivante. La page ', el('a', { href: '#sources' }, 'Sources'), ' indique où en est chaque connexion.'));
    }
    const blocks = [];

    if (sites.length && seoEnd(sites)) {
      const end = seoEnd(sites);
      const now = siteTotals(sites, end, days);
      const before = siteTotals(sites, addDays(end, -days), days);
      const ok = before.covered;
      const labels = axisLabels(end, days);
      const used = buckets(days).used;
      blocks.push(el('section', { class: 'panel' },
        el('header', {}, el('h2', {}, 'Référencement sur Google'),
          el('p', { class: 'meta' }, `${sites.length} site${sites.length > 1 ? 's' : ''} · données jusqu’au ${day(end)}`)),
        el('div', { class: 'stats' },
          stat('Clics', compact(now.clicks), change('pct', ok ? rel(now.clicks, before.clicks) : null)),
          stat('Impressions', compact(now.impressions), change('pct', ok ? rel(now.impressions, before.impressions) : null)),
          stat('Taux de clic', pct(now.ctr), change('pts', ok && now.ctr != null && before.ctr != null ? now.ctr - before.ctr : null))),
        figure({
          title: `Clics par ${bucketSize(days) === 7 ? 'semaine' : 'jour'}, tous sites confondus`,
          labels: labels.short, longLabels: labels.long, fmt: compact, full: int, area: true,
          series: [
            { name: `Derniers ${periodLabel()}`, color: 'var(--seo)', values: sitePoints(sites, 'clicks', end, days) },
            { name: `${periodLabel()} précédents`, color: 'var(--prev)', muted: true, values: sitePoints(sites, 'clicks', addDays(end, -used), days) },
          ],
        })));
    }

    if (accounts.length && socialEnd(accounts)) {
      const end = socialEnd(accounts);
      const totals = accounts.map((a) => accountTotals(a, end, days));
      const add = (key) => { const v = totals.map((t) => t[key]).filter((x) => x != null); return v.length ? v.reduce((s, x) => s + x, 0) : null; };
      const every = (key) => totals.every((t) => t[key] != null);
      const labels = axisLabels(end, days);
      const nets = Object.keys(NETWORKS).filter((n) => accounts.some((a) => a.network === n));
      blocks.push(el('section', { class: 'panel' },
        el('header', {}, el('h2', {}, 'Réseaux sociaux'),
          el('p', { class: 'meta' }, `${accounts.length} compte${accounts.length > 1 ? 's' : ''} · données jusqu’au ${day(end)}`)),
        el('div', { class: 'stats' },
          stat('Abonnés', compact(add('followers')), change('abs', every('followersChange') ? add('followersChange') : null)),
          stat('Vues', compact(add('views')), change('pct', every('viewsBefore') ? rel(add('views'), add('viewsBefore')) : null)),
          stat('Interactions', compact(add('interactions')), change('pct', every('interactionsBefore') ? rel(add('interactions'), add('interactionsBefore')) : null))),
        figure({
          title: `Vues par ${bucketSize(days) === 7 ? 'semaine' : 'jour'}, par réseau`,
          labels: labels.short, longLabels: labels.long, fmt: compact, full: int, endLabels: true,
          series: nets.map((n) => ({ name: NETWORKS[n].label, color: NETWORKS[n].color, values: accountPoints(accounts.filter((a) => a.network === n), 'views', end, days) })),
        })));
    }

    const tables = [];
    if (sites.length) {
      const rows = sites.map((s, index) => {
        const end = s.status.lastDate;
        const now = siteTotals([s], end, days);
        const before = end ? siteTotals([s], addDays(end, -days), days) : {};
        return { s, index, now, clicksChange: before.covered ? rel(now.clicks, before.clicks) : null,
          rankChange: before.covered && now.position != null && before.position != null ? before.position - now.position : null,
          trend: trend(windowOf(s.daily, 'clicks', end, days)) };
      });
      tables.push(el('section', { class: 'panel' },
        el('header', {}, el('h2', {}, 'Sites'), el('p', { class: 'meta' }, `Évolutions ${versus()}`)),
        dataTable('sites', [
          { key: 'name', label: 'Site', first: 1, value: (r) => r.s.label, cell: (r) => el('div', { class: 'name' }, el('span', { class: 'net', style: 'background:var(--seo)' }), el('a', { href: `#site-${r.index}` }, r.s.label), flag(r.s)) },
          { key: 'clicks', label: 'Clics', num: true, value: (r) => r.now.clicks, cell: (r) => int(r.now.clicks) },
          { key: 'chg', label: 'Évolution', num: true, value: (r) => r.clicksChange, cell: (r) => change('pct', r.clicksChange) },
          { key: 'imp', label: 'Impressions', num: true, value: (r) => r.now.impressions, cell: (r) => int(r.now.impressions) },
          { key: 'ctr', label: 'Taux de clic', num: true, value: (r) => r.now.ctr, cell: (r) => pct(r.now.ctr) },
          { key: 'pos', label: 'Position', num: true, first: 1, value: (r) => r.now.position, cell: (r) => dec(r.now.position) },
          { key: 'rank', label: 'Places', num: true, value: (r) => r.rankChange, cell: (r) => change('rank', r.rankChange) },
          { key: 'trend', label: 'Clics sur la période', cell: (r) => sparkline(r.trend, 'var(--seo)') },
        ], rows, { defaultSort: { key: 'clicks', dir: -1 } })));
    }
    if (accounts.length) {
      const rows = accounts.map((a, index) => {
        const end = a.status.lastDate;
        const t = accountTotals(a, end, days);
        return { a, index, t, viewsChange: rel(t.views, t.viewsBefore), trend: trend(windowOf(a.daily, 'views', end, days)) };
      });
      tables.push(el('section', { class: 'panel' },
        el('header', {}, el('h2', {}, 'Comptes'), el('p', { class: 'meta' }, `Évolutions ${versus()}`)),
        dataTable('accounts', [
          { key: 'name', label: 'Compte', first: 1, value: (r) => r.a.label, cell: (r) => el('div', { class: 'name' }, el('span', { class: 'net', style: `background:${NETWORKS[r.a.network].color}` }), el('a', { href: `#compte-${r.index}` }, r.a.label), el('small', {}, NETWORKS[r.a.network].label), flag(r.a)) },
          { key: 'fol', label: 'Abonnés', num: true, value: (r) => r.t.followers, cell: (r) => int(r.t.followers) },
          { key: 'folc', label: 'Évolution', num: true, value: (r) => r.t.followersChange, cell: (r) => change('abs', r.t.followersChange) },
          { key: 'views', label: 'Vues', num: true, value: (r) => r.t.views, cell: (r) => int(r.t.views) },
          { key: 'viewsc', label: 'Évolution', num: true, value: (r) => r.viewsChange, cell: (r) => change('pct', r.viewsChange) },
          { key: 'int', label: 'Interactions', num: true, value: (r) => r.t.interactions, cell: (r) => int(r.t.interactions) },
          { key: 'trend', label: 'Vues sur la période', cell: (r) => sparkline(r.trend, NETWORKS[r.a.network].color) },
        ], rows)));
    }
    return el('div', { class: 'stack' }, el('div', { class: 'cols' }, blocks), tables);
  }

  /* ---------- Fiche d'un site ---------- */
  function switcher(current) {
    const { sites, accounts } = state.data;
    const select = el('select', { id: 'switcher', 'aria-label': 'Changer de site ou de compte', onchange: (e) => go(e.target.value) },
      sites.length && el('optgroup', { label: 'Sites' }, sites.map((s, i) => el('option', { value: `site-${i}`, selected: current === `site-${i}` }, s.label))),
      accounts.length && el('optgroup', { label: 'Comptes' }, accounts.map((a, i) => el('option', { value: `compte-${i}`, selected: current === `compte-${i}` }, `${a.label} (${NETWORKS[a.network].label})`))));
    return el('div', { class: 'crumb' }, el('a', { href: '#apercu' }, '← Vue d’ensemble'), select);
  }
  const metricPicker = (metrics, current, onPick) => el('div', { class: 'seg', role: 'group', 'aria-label': 'Indicateur affiché' },
    Object.entries(metrics).map(([key, m]) => el('button', { type: 'button', 'data-fk': `indic-${key}`, 'aria-pressed': String(key === current), onclick: () => onPick(key) }, m.label)));

  function siteView(index) {
    const site = state.data.sites[index];
    if (!site) return overview();
    const days = state.period;
    const end = site.status.lastDate;
    const now = siteTotals([site], end, days);
    const before = end ? siteTotals([site], addDays(end, -days), days) : {};
    const ok = before.covered;
    const m = SITE_METRICS[state.siteMetric];
    const labels = end ? axisLabels(end, days) : { short: [], long: [] };
    const used = buckets(days).used;
    const top = (site.top && site.top[days]) || { queries: [], pages: [] };
    const link = safeUrl(site.url);

    const columns = (first, cell) => [
      { key: 'k', label: first, first: 1, cls: 'kw', value: (r) => r.k, cell },
      { key: 'c', label: 'Clics', num: true, value: (r) => r.c, cell: (r) => int(r.c) },
      { key: 'dc', label: 'Évolution', num: true, value: (r) => (r.pc == null ? null : r.c - r.pc), cell: (r) => (r.pc === 0 && r.c > 0 ? el('span', { class: 'chg up' }, 'nouveau') : change('abs', r.pc == null ? null : r.c - r.pc)) },
      { key: 'i', label: 'Impressions', num: true, value: (r) => r.i, cell: (r) => int(r.i) },
      { key: 'ctr', label: 'Taux de clic', num: true, value: (r) => (r.i ? r.c / r.i : null), cell: (r) => pct(r.i ? r.c / r.i : null) },
      { key: 'p', label: 'Position', num: true, first: 1, value: (r) => r.p, cell: (r) => dec(r.p) },
      { key: 'dp', label: 'Places', num: true, value: (r) => (r.pp == null ? null : r.pp - r.p), cell: (r) => change('rank', r.pp == null ? null : r.pp - r.p) },
    ];
    const pagePath = (u) => { try { const p = new URL(u); return p.pathname + p.search || '/'; } catch { return u; } };

    return el('div', { class: 'stack' },
      el('section', { class: 'panel' },
        el('header', {},
          el('div', { class: 'title' }, el('h2', {}, site.label), link && el('a', { class: 'meta', href: link, target: '_blank', rel: 'noopener' }, 'Ouvrir le site'), flag(site)),
          el('p', { class: 'meta' }, end ? `Google Search Console · données jusqu’au ${day(end)}` : 'Google Search Console')),
        el('div', { class: 'stats' },
          stat('Clics', compact(now.clicks), change('pct', ok ? rel(now.clicks, before.clicks) : null)),
          stat('Impressions', compact(now.impressions), change('pct', ok ? rel(now.impressions, before.impressions) : null)),
          stat('Taux de clic', pct(now.ctr), change('pts', ok && now.ctr != null && before.ctr != null ? now.ctr - before.ctr : null)),
          stat('Position moyenne', dec(now.position), change('rank', ok && now.position != null && before.position != null ? before.position - now.position : null))),
        end && figure({
          title: `${m.label} par ${bucketSize(days) === 7 ? 'semaine' : 'jour'}${m.invert ? ' (la 1re position est en haut)' : ''}`,
          labels: labels.short, longLabels: labels.long, fmt: m.fmt, full: m.full, invert: m.invert, area: !m.invert,
          series: [
            { name: `Derniers ${periodLabel()}`, color: 'var(--seo)', values: sitePoints([site], state.siteMetric, end, days) },
            { name: `${periodLabel()} précédents`, color: 'var(--prev)', muted: true, values: sitePoints([site], state.siteMetric, addDays(end, -used), days) },
          ],
        }, metricPicker(SITE_METRICS, state.siteMetric, (k) => { state.siteMetric = k; render(); }))),
      el('section', { class: 'panel' },
        el('header', {}, el('h2', {}, 'Requêtes'), el('p', { class: 'meta' }, `Les plus cliquées · évolutions ${versus()}`)),
        top.queries.length ? dataTable(`q-${index}`, columns('Requête', (r) => r.k), top.queries, { limit: 10 }) : el('p', { class: 'empty' }, 'Aucune requête sur cette période.')),
      el('section', { class: 'panel' },
        el('header', {}, el('h2', {}, 'Pages'), el('p', { class: 'meta' }, `Les plus cliquées · évolutions ${versus()}`)),
        top.pages.length ? dataTable(`p-${index}`, columns('Page', (r) => (safeUrl(r.k) ? el('a', { href: r.k, target: '_blank', rel: 'noopener', title: r.k }, pagePath(r.k)) : r.k)), top.pages, { limit: 10 }) : el('p', { class: 'empty' }, 'Aucune page sur cette période.')));
  }

  /* ---------- Fiche d'un compte ---------- */
  function accountView(index) {
    const account = state.data.accounts[index];
    if (!account) return overview();
    const days = state.period;
    const net = NETWORKS[account.network];
    const end = account.status.lastDate;
    const t = accountTotals(account, end, days);
    const key = state.accountMetric;
    const m = ACCOUNT_METRICS[key];
    const labels = end ? axisLabels(end, days) : { short: [], long: [] };
    const used = buckets(days).used;
    const link = safeUrl(account.url);
    const posts = account.posts || [];
    const followerScale = key === 'followers';

    return el('div', { class: 'stack' },
      el('section', { class: 'panel' },
        el('header', {},
          el('div', { class: 'title' }, el('h2', {}, account.label), link && el('a', { class: 'meta', href: link, target: '_blank', rel: 'noopener' }, 'Ouvrir le compte'), flag(account)),
          el('p', { class: 'meta' }, end ? `${net.label} · données jusqu’au ${day(end)}` : net.label)),
        el('div', { class: 'stats' },
          stat('Abonnés', compact(t.followers), change('abs', t.followersChange)),
          stat('Vues', compact(t.views), change('pct', rel(t.views, t.viewsBefore))),
          stat('Couverture par jour', compact(t.reach == null ? null : Math.round(t.reach)), change('pct', rel(t.reach, t.reachBefore))),
          stat('Interactions', compact(t.interactions), change('pct', rel(t.interactions, t.interactionsBefore))),
          account.network === 'linkedin' && stat('Clics', compact(t.clicks))),
        end && figure({
          title: key === 'followers' ? 'Nombre d’abonnés' : key === 'reach' ? `Couverture moyenne par jour${bucketSize(days) === 7 ? ', semaine par semaine' : ''}` : `${m.label} par ${bucketSize(days) === 7 ? 'semaine' : 'jour'}`,
          labels: labels.short, longLabels: labels.long, fmt: compact, full: (v) => int(v == null ? null : Math.round(v)), area: !followerScale, invert: false, tight: followerScale,
          series: followerScale
            ? [{ name: 'Abonnés', color: net.color, values: accountPoints([account], key, end, days) }]
            : [
              { name: `Derniers ${periodLabel()}`, color: net.color, values: accountPoints([account], key, end, days) },
              { name: `${periodLabel()} précédents`, color: 'var(--prev)', muted: true, values: accountPoints([account], key, addDays(end, -used), days) },
            ],
        }, metricPicker(ACCOUNT_METRICS, key, (k) => { state.accountMetric = k; render(); }))),
      posts.length > 0 && el('section', { class: 'panel' },
        el('header', {}, el('h2', {}, 'Dernières publications'), el('p', { class: 'meta' }, 'Résultats cumulés depuis la mise en ligne')),
        dataTable(`posts-${index}`, [
          { key: 'date', label: 'Date', value: (r) => r.date, cell: (r) => (r.date ? day(r.date) : NONE) },
          { key: 'type', label: 'Format', first: 1, value: (r) => r.type, cell: (r) => r.type },
          { key: 'text', label: 'Publication', cls: 'kw', cell: (r) => (safeUrl(r.url) ? el('a', { href: r.url, target: '_blank', rel: 'noopener' }, r.text || 'Voir la publication') : r.text || NONE) },
          { key: 'views', label: 'Vues', num: true, value: (r) => r.views, cell: (r) => int(r.views) },
          { key: 'reach', label: 'Couverture', num: true, value: (r) => r.reach, cell: (r) => int(r.reach) },
          { key: 'int', label: 'Interactions', num: true, value: (r) => r.interactions, cell: (r) => int(r.interactions) },
        ], posts, { limit: 8 })));
  }

  /* ---------- Sources ---------- */
  function problems() {
    const { sites, accounts, sources } = state.data;
    const list = [];
    for (const [key, name] of [['searchConsole', 'Google Search Console'], ['meta', 'Meta'], ['linkedin', 'LinkedIn']]) {
      const s = sources && sources[key];
      if (s && s.connected && !s.ok) list.push(`${name} n’a pas répondu à la dernière mise à jour`);
    }
    const failing = [...sites, ...accounts].filter((e) => e.status && e.status.ok === false).length;
    if (failing && !list.length) list.push(`${failing} ${failing > 1 ? 'éléments n’ont' : 'élément n’a'} pas pu être mis à jour`);
    const li = sources && sources.linkedin;
    if (li && li.expiresAt) {
      const left = diffDays(toISO(Date.now()), li.expiresAt);
      if (left <= 14) list.push(left < 0 ? 'l’accès LinkedIn a expiré' : `l’accès LinkedIn expire dans ${left} jour${left > 1 ? 's' : ''}`);
    }
    return list;
  }

  function sourcesView() {
    const { sites, accounts, sources = {} } = state.data;
    const card = (key, title, how, entities, extra) => {
      const s = sources[key] || { connected: false };
      const pill = !s.connected ? el('span', { class: 'pill' }, 'Pas encore branché')
        : s.ok ? el('span', { class: 'pill ok' }, '✓ Connecté') : el('span', { class: 'pill bad' }, '! À vérifier');
      return el('section', { class: 'panel' },
        el('header', {}, el('h2', {}, title), pill),
        el('p', { class: 'lead' }, !s.connected ? how : s.ok ? `${entities.length} ${entities.length > 1 ? 'éléments suivis' : 'élément suivi'}.` : `Dernière erreur : ${s.message}`),
        extra,
        entities.length > 0 && el('ul', { class: 'src-list' }, entities.map((e) => el('li', {},
          el('span', {}, e.label, e.network ? ` · ${NETWORKS[e.network].label}` : ''),
          el('span', { class: 'meta' }, e.status && e.status.lastDate ? `jusqu’au ${day(e.status.lastDate)}` : 'pas encore de données'),
          e.status && e.status.message ? el('span', { class: 'why' }, e.status.message) : null))));
    };
    const li = sources.linkedin || {};
    return el('div', { class: 'stack' },
      card('searchConsole', 'Google Search Console', 'Ajoutez l’adresse du compte de service comme utilisateur de chaque propriété : elles apparaîtront toutes seules.', sites),
      card('meta', 'Instagram et Facebook', 'Un jeton Meta Business donne accès aux pages Facebook et aux comptes Instagram professionnels qui lui sont attribués.', accounts.filter((a) => a.network !== 'linkedin')),
      card('linkedin', 'LinkedIn', 'Demande une application LinkedIn approuvée pour les statistiques de page.', accounts.filter((a) => a.network === 'linkedin'),
        li.expiresAt && el('p', { class: 'meta' }, `Accès valable jusqu’au ${day(li.expiresAt)} : LinkedIn impose de le renouveler à la main.`)),
      el('section', { class: 'panel' },
        el('header', {}, el('h2', {}, 'Comment lire ces chiffres')),
        el('dl', { class: 'defs' },
          el('div', {}, el('dt', {}, 'Clics, impressions, position'), el('dd', {}, 'Chiffres de Google Search Console, publiés avec deux à trois jours de décalage. La position moyenne est pondérée par les impressions ; les « places » indiquent le gain ou la perte de rang.')),
          el('div', {}, el('dt', {}, 'Vues'), el('dd', {}, 'Nombre d’affichages des contenus. Instagram et Facebook parlent de vues, LinkedIn d’impressions : c’est la même idée.')),
          el('div', {}, el('dt', {}, 'Couverture'), el('dd', {}, 'Nombre de personnes différentes touchées chaque jour. Elle ne s’additionne pas d’un jour à l’autre : le tableau de bord affiche donc une moyenne quotidienne.')),
          el('div', {}, el('dt', {}, 'Interactions'), el('dd', {}, 'Instagram : mentions J’aime, commentaires, partages, enregistrements. Facebook : réactions, commentaires, partages et clics. LinkedIn : réactions, commentaires, partages et clics.')),
          el('div', {}, el('dt', {}, 'Évolutions'), el('dd', {}, 'Chaque période est comparée à la période de même durée qui la précède. Un tiret signifie que l’historique ne remonte pas assez loin.')))));
  }

  /* ---------- Assemblage ---------- */
  function render() {
    const data = state.data;
    const [kind, arg] = state.route.split('-');
    const detail = kind === 'site' || kind === 'compte';
    const view = kind === 'sources' ? sourcesView() : kind === 'site' ? siteView(+arg) : kind === 'compte' ? accountView(+arg) : overview();
    const issues = problems();
    const stamp = data.generatedAt ? `Mis à jour le ${dStamp.format(new Date(data.generatedAt))}` : '';
    const scroll = window.scrollY;
    const focused = document.activeElement && document.activeElement.getAttribute ? document.activeElement.getAttribute('data-fk') : null;
    root.replaceChildren(el('div', { class: 'wrap' },
      el('header', { class: 'top' }, el('h1', {}, 'Audience ', el('span', {}, '· référencement et réseaux sociaux')), el('p', { class: 'stamp' }, stamp)),
      el('div', { class: 'bar' },
        el('nav', { class: 'nav', 'aria-label': 'Pages' },
          el('a', { href: '#apercu', 'aria-current': kind !== 'sources' && !detail ? 'page' : null }, 'Vue d’ensemble'),
          el('a', { href: '#sources', 'aria-current': kind === 'sources' ? 'page' : null }, 'Sources')),
        kind !== 'sources' && el('div', { class: 'seg', role: 'group', 'aria-label': 'Période' },
          PERIODS.map((p) => el('button', { type: 'button', 'data-fk': `periode-${p.days}`, 'aria-pressed': String(p.days === state.period), onclick: () => setPeriod(p.days) }, p.label)))),
      data.demo && el('p', { class: 'note demo' }, el('b', {}, 'Démonstration.'), ' Ces sites et ces comptes sont fictifs : ils montrent ce que vous verrez une fois vos sources branchées.'),
      issues.length > 0 && kind !== 'sources' && el('p', { class: 'note warn' }, el('b', {}, '! À vérifier :'), ` ${issues.join(' ; ')}. `, el('a', { href: '#sources' }, 'Voir les sources')),
      detail && switcher(state.route),
      el('main', {}, view)));
    window.scrollTo(0, scroll);
    // Après un clic sur un réglage, le clavier reste sur le même bouton.
    const again = focused && root.querySelector(`[data-fk="${focused}"]`);
    if (again) again.focus({ preventScroll: true });
  }

  function setPeriod(days) {
    state.period = days;
    try { localStorage.setItem('tdb.periode', String(days)); } catch { /* préférence non mémorisée */ }
    render();
  }
  function go(route) {
    try { history.replaceState(null, '', `#${route}`); } catch { /* le cadre refuse : on navigue quand même */ }
    setRoute(route, true);
  }
  function setRoute(route, top) {
    state.route = /^(apercu|sources|site-\d+|compte-\d+)$/.test(route) ? route : 'apercu';
    render();
    if (top) window.scrollTo(0, 0);
  }

  function start(data) {
    state.data = { sites: [], accounts: [], sources: {}, ...data };
    try { const saved = +localStorage.getItem('tdb.periode'); if (PERIODS.some((p) => p.days === saved)) state.period = saved; } catch { /* valeur par défaut */ }
    window.addEventListener('hashchange', () => setRoute(location.hash.slice(1), true));
    // Les liens internes fonctionnent même si le cadre d'affichage ne transmet pas le changement d'adresse.
    root.addEventListener('click', (ev) => {
      const a = ev.target.closest && ev.target.closest('a[href^="#"]');
      if (!a) return;
      ev.preventDefault();
      go(a.getAttribute('href').slice(1));
    });
    setRoute(location.hash.slice(1));
  }

  /* ---------- Déchiffrement ---------- */
  const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const b64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
  async function keyFromPassword(envelope, password) {
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: unb64(envelope.salt), iterations: envelope.iter },
      base, { name: 'AES-GCM', length: 256 }, true, ['decrypt']);
  }
  async function unlock(envelope, key) {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(envelope.iv) }, key, unb64(envelope.data));
    const stream = new Blob([plain]).stream().pipeThrough(new DecompressionStream('gzip'));
    return JSON.parse(await new Response(stream).text());
  }

  function gate(envelope) {
    const err = el('div', { class: 'err', role: 'alert' });
    const input = el('input', { id: 'mot-de-passe', type: 'password', autocomplete: 'current-password', required: true });
    const remember = el('input', { id: 'se-souvenir', type: 'checkbox' });
    const button = el('button', { type: 'submit' }, 'Ouvrir');
    const form = el('form', { onsubmit: async (ev) => {
      ev.preventDefault();
      button.disabled = true; err.textContent = '';
      try {
        const key = await keyFromPassword(envelope, input.value);
        const data = await unlock(envelope, key);
        if (remember.checked) {
          try { localStorage.setItem('tdb.cle', JSON.stringify({ salt: envelope.salt, key: b64(await crypto.subtle.exportKey('raw', key)) })); } catch { /* non mémorisé */ }
        }
        start(data);
      } catch {
        err.textContent = 'Mot de passe incorrect.';
        button.disabled = false;
        input.select();
      }
    } },
      el('h1', {}, 'Audience'),
      el('p', {}, envelope.demo ? 'Version de démonstration : le mot de passe est « demo ».' : 'Ce tableau de bord est protégé.'),
      el('label', { for: 'mot-de-passe' }, 'Mot de passe', input),
      el('label', { class: 'check', for: 'se-souvenir' }, remember, 'Se souvenir de moi sur cet appareil'),
      button, err);
    root.replaceChildren(el('div', { class: 'gate' }, form));
    input.focus();
  }

  async function boot() {
    if (window.__DATA__) return start(window.__DATA__);
    let envelope;
    try {
      const res = await fetch(`data.enc.json?t=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(String(res.status));
      envelope = await res.json();
    } catch {
      root.replaceChildren(el('div', { class: 'gate' }, el('p', {}, 'Les données ne sont pas encore disponibles. Lancez une première mise à jour, puis rechargez la page.')));
      return;
    }
    try {
      const saved = JSON.parse(localStorage.getItem('tdb.cle') || 'null');
      if (saved && saved.salt === envelope.salt) {
        const key = await crypto.subtle.importKey('raw', unb64(saved.key), { name: 'AES-GCM' }, true, ['decrypt']);
        return start(await unlock(envelope, key));
      }
    } catch { /* clé mémorisée périmée : on redemande le mot de passe */ }
    gate(envelope);
  }

  boot();
})();
