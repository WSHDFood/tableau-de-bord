// LinkedIn : pages d'entreprise dont le titulaire du jeton est administrateur.
// Nécessite une application LinkedIn approuvée pour la « Community Management API ».
import { request } from '../lib/http.js';
import { addDays, chunkRange, parseISO, toISO, DAY } from '../lib/dates.js';
import { dailyToMap, mapToDaily, mergeInto, put, lastDateWith } from '../lib/series.js';

const API = 'https://api.linkedin.com/rest';
const METRICS = ['views', 'reach', 'interactions', 'newFollowers', 'followers', 'clicks', 'likes', 'comments', 'shares'];
const urn = (id) => `urn:li:organization:${id}`;
const enc = encodeURIComponent;

// LinkedIn publie une version d'API par mois et retire les anciennes au bout d'un an.
// On essaie donc les versions récentes, de la plus neuve à la plus ancienne.
function candidateVersions(today, forced) {
  if (forced) return [String(forced)];
  const out = [];
  const [y, m] = [+today.slice(0, 4), +today.slice(5, 7)];
  for (let back = 1; back <= 8; back++) {
    const d = new Date(Date.UTC(y, m - 1 - back, 1));
    out.push(`${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

const isVersionError = (e) => e.status === 426 || (e.status === 400 && /version/i.test(e.message || ''));

async function freshAccessToken({ accessToken, refreshToken, clientId, clientSecret }) {
  if (refreshToken && clientId && clientSecret) {
    const res = await request('https://www.linkedin.com/oauth/v2/accessToken', {
      method: 'POST',
      form: { grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId, client_secret: clientSecret },
    });
    return {
      token: res.access_token,
      // Le jeton de renouvellement lui-même expire (un an) : c'est cette date qui compte.
      expiresAt: res.refresh_token_expires_in ? toISO(Date.now() + res.refresh_token_expires_in * 1000) : null,
    };
  }
  let expiresAt = null;
  if (clientId && clientSecret) {
    try {
      const res = await request('https://www.linkedin.com/oauth/v2/introspectToken', {
        method: 'POST', form: { client_id: clientId, client_secret: clientSecret, token: accessToken },
      });
      if (res.expires_at) expiresAt = toISO(res.expires_at * 1000);
    } catch { /* date d'expiration inconnue : sans gravité */ }
  }
  return { token: accessToken, expiresAt };
}

export async function collectLinkedIn({ credentials, config, existing, today, log }) {
  const { token, expiresAt } = await freshAccessToken(credentials);
  const exclude = new Set(config.exclude || []);
  const labels = config.labels || {};
  const versions = candidateVersions(today, config.apiVersion);
  let version = versions[0];

  const call = (path) =>
    request(`${API}/${path}`, {
      headers: { Authorization: `Bearer ${token}`, 'LinkedIn-Version': version, 'X-Restli-Protocol-Version': '2.0.0' },
    });

  // 1. Pages administrées (et recherche d'une version d'API active).
  let acls;
  for (const v of versions) {
    version = v;
    try {
      acls = await call('organizationAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED&count=100');
      break;
    } catch (e) {
      if (!isVersionError(e) || v === versions[versions.length - 1]) throw e;
    }
  }
  const ids = [...new Set((acls.elements || [])
    .map((el) => String(el.organization || el.organizationTarget || '').split(':').pop())
    .filter(Boolean))];
  log(`LinkedIn : ${ids.length} page(s) administrée(s) (API ${version}).`);

  const accounts = [];
  for (const orgId of ids) {
    const id = `li:${orgId}`;
    if (exclude.has(id)) continue;
    const previous = existing.get(id);
    const map = dailyToMap(previous && previous.daily);
    const account = {
      id, network: 'linkedin', label: labels[id] || (previous && previous.label) || `Page ${orgId}`,
      url: (previous && previous.url) || `https://www.linkedin.com/company/${orgId}/`,
      followers: previous ? previous.followers : null,
      status: { ok: true, message: '', lastDate: null },
      posts: [],
    };
    try {
      try {
        const org = await call(`organizations/${orgId}`);
        if (!labels[id] && org.localizedName) account.label = org.localizedName;
        if (org.vanityName) account.url = `https://www.linkedin.com/company/${org.vanityName}/`;
      } catch { /* le nom reste celui déjà connu */ }

      for (const edge of ['COMPANY_FOLLOWED_BY_MEMBER', 'CompanyFollowedByMember']) {
        try {
          const size = await call(`networkSizes/${enc(urn(orgId))}?edgeType=${edge}`);
          if (typeof size.firstDegreeSize === 'number') { account.followers = size.firstDegreeSize; break; }
        } catch { /* on essaie l'ancienne écriture du paramètre */ }
      }

      const last = lastDateWith(map, 'views');
      const start = last ? addDays(last, -5) : addDays(today, -364);
      const fresh = new Map();
      const interval = (from, to) =>
        `timeIntervals=(timeRange:(start:${parseISO(from)},end:${parseISO(to) + DAY}),timeGranularityType:DAY)`;

      for (const [from, to] of chunkRange(start, today, 90)) {
        const shares = await call(
          `organizationalEntityShareStatistics?q=organizationalEntity&organizationalEntity=${enc(urn(orgId))}&${interval(from, to)}`,
        );
        for (const el of shares.elements || []) {
          const s = el.totalShareStatistics;
          if (!s || !el.timeRange) continue;
          put(fresh, toISO(el.timeRange.start), {
            views: s.impressionCount,
            reach: s.uniqueImpressionsCount ?? s.uniqueImpressionsCounts,
            clicks: s.clickCount, likes: s.likeCount, comments: s.commentCount, shares: s.shareCount,
            interactions: (s.clickCount || 0) + (s.likeCount || 0) + (s.commentCount || 0) + (s.shareCount || 0),
          });
        }
        const followers = await call(
          `organizationalEntityFollowerStatistics?q=organizationalEntity&organizationalEntity=${enc(urn(orgId))}&${interval(from, to)}`,
        );
        for (const el of followers.elements || []) {
          const g = el.followerGains;
          if (!g || !el.timeRange) continue;
          put(fresh, toISO(el.timeRange.start), { newFollowers: (g.organicFollowerGain || 0) + (g.paidFollowerGain || 0) });
        }
      }
      mergeInto(map, fresh);

      // Historique du nombre d'abonnés : on part du total actuel et on remonte avec les gains quotidiens.
      const lastGain = lastDateWith(map, 'newFollowers');
      if (account.followers !== null && lastGain) {
        let total = account.followers;
        for (let d = lastGain; map.has(d) && map.get(d).newFollowers !== undefined; d = addDays(d, -1)) {
          put(map, d, { followers: total });
          total -= map.get(d).newFollowers;
        }
      }
    } catch (e) {
      account.status.ok = false;
      account.status.message = e.message;
      log(`  ! LinkedIn ${account.label} : ${e.message}`);
    }
    account.daily = mapToDaily(map, METRICS);
    account.status.lastDate = lastDateWith(map, 'views');
    accounts.push(account);
  }

  return { entities: accounts, source: { connected: true, ok: true, message: '', expiresAt } };
}
