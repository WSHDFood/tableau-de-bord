// Google Search Console.
// Accès par compte de service : on ajoute son adresse e-mail comme utilisateur
// de chaque propriété, et toutes les propriétés visibles sont collectées automatiquement.
import { createSign } from 'node:crypto';
import { request, mapLimit } from '../lib/http.js';
import { addDays } from '../lib/dates.js';
import { dailyToMap, mapToDaily, mergeInto, put, lastDateWith } from '../lib/series.js';

const API = 'https://www.googleapis.com/webmasters/v3';
const SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
const METRICS = ['clicks', 'impressions', 'position'];
export const PERIODS = [7, 28, 90, 365];
const HISTORY_DAYS = 480; // Google conserve 16 mois
const TOP_ROWS = 50;

const b64url = (v) => Buffer.from(v).toString('base64url');

async function getAccessToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  const aud = sa.token_uri || 'https://oauth2.googleapis.com/token';
  const unsigned = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(
    JSON.stringify({ iss: sa.client_email, scope: SCOPE, aud, iat: now, exp: now + 3600 }),
  )}`;
  const signature = createSign('RSA-SHA256').update(unsigned).sign(sa.private_key).toString('base64url');
  const res = await request(aud, {
    method: 'POST',
    form: { grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${signature}` },
  });
  return res.access_token;
}

export function siteLabel(siteUrl) {
  if (siteUrl.startsWith('sc-domain:')) return siteUrl.slice(10);
  return siteUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

export function siteLink(siteUrl) {
  return siteUrl.startsWith('sc-domain:') ? `https://${siteUrl.slice(10)}/` : siteUrl;
}

const round = (v, d) => Math.round(v * 10 ** d) / 10 ** d;

export async function collectSearchConsole({ credentials, config, existing, today, log }) {
  const token = await getAccessToken(credentials);
  const headers = { Authorization: `Bearer ${token}` };
  const query = (siteUrl, body) =>
    request(`${API}/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`, { method: 'POST', headers, body });

  const list = await request(`${API}/sites`, { headers });
  const exclude = new Set(config.exclude || []);
  const entries = (list.siteEntry || []).filter(
    (s) => s.permissionLevel !== 'siteUnverifiedUser' && !exclude.has(s.siteUrl),
  );
  log(`Search Console : ${entries.length} propriété(s) accessible(s).`);

  const sites = await mapLimit(entries, 3, async (entry) => {
    const id = entry.siteUrl;
    const previous = existing.get(id);
    const site = {
      id,
      label: (config.labels && config.labels[id]) || siteLabel(id),
      url: siteLink(id),
      status: { ok: true, message: '', lastDate: null },
      daily: previous ? previous.daily : mapToDaily(new Map(), METRICS),
      top: previous ? previous.top : {},
    };
    try {
      // 1. Courbe quotidienne sur toute la période conservée par Google.
      const res = await query(id, {
        startDate: addDays(today, -HISTORY_DAYS), endDate: today, dimensions: ['date'], rowLimit: 25000,
      });
      const fresh = new Map();
      for (const row of res.rows || []) {
        put(fresh, row.keys[0], {
          clicks: row.clicks, impressions: row.impressions, position: round(row.position, 2),
        });
      }
      const merged = mergeInto(dailyToMap(site.daily), fresh);
      site.daily = mapToDaily(merged, METRICS);
      const lastDate = lastDateWith(merged, 'impressions');
      site.status.lastDate = lastDate;
      if (!lastDate) {
        site.status.message = 'Aucune donnée pour cette propriété.';
        return site;
      }

      // 2. Requêtes et pages les plus cliquées, pour chaque période proposée dans le tableau de bord.
      const top = {};
      for (const days of PERIODS) {
        const cur = [addDays(lastDate, -(days - 1)), lastDate];
        const prev = [addDays(lastDate, -(2 * days - 1)), addDays(lastDate, -days)];
        const comparable = 2 * days <= HISTORY_DAYS;
        top[days] = {};
        for (const [name, dimension] of [['queries', 'query'], ['pages', 'page']]) {
          const [now, before] = await Promise.all([
            query(id, { startDate: cur[0], endDate: cur[1], dimensions: [dimension], rowLimit: 250 }),
            comparable
              ? query(id, { startDate: prev[0], endDate: prev[1], dimensions: [dimension], rowLimit: 2000 })
              : { rows: [] },
          ]);
          const past = new Map((before.rows || []).map((r) => [r.keys[0], r]));
          top[days][name] = (now.rows || [])
            .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions)
            .slice(0, TOP_ROWS)
            .map((r) => {
              const p = past.get(r.keys[0]);
              return {
                k: r.keys[0], c: r.clicks, i: r.impressions, p: round(r.position, 1),
                pc: comparable ? (p ? p.clicks : 0) : null,
                pp: p ? round(p.position, 1) : null,
              };
            });
        }
      }
      site.top = top;
    } catch (e) {
      site.status.ok = false;
      site.status.message = e.message;
      site.status.lastDate = lastDateWith(dailyToMap(site.daily), 'impressions');
      log(`  ! ${site.label} : ${e.message}`);
    }
    return site;
  });

  return { entities: sites, source: { connected: true, ok: true, message: '', account: credentials.client_email } };
}
