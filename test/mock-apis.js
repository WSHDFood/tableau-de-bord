// Faux serveurs Google, Meta et LinkedIn pour les tests : les réponses reprennent la forme
// décrite dans la documentation officielle de chaque API. Chargé avec `node --import`.
import { createVerify, generateKeyPairSync } from 'node:crypto';
import { writeFileSync, existsSync, readFileSync } from 'node:fs';

const DAY = 86400000;
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
const today = iso(Date.now());
const addDays = (s, n) => iso(Date.parse(`${s}T00:00:00Z`) + n * DAY);
const scenario = process.env.MOCK_SCENARIO || 'ok';
const calls = [];

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function google(url, init) {
  if (url.pathname === '/token') {
    const assertion = new URLSearchParams(init.body).get('assertion');
    const [h, c, s] = assertion.split('.');
    const pub = readFileSync(process.env.MOCK_PUBLIC_KEY, 'utf8');
    const ok = createVerify('RSA-SHA256').update(`${h}.${c}`).verify(pub, Buffer.from(s, 'base64url'));
    const claim = JSON.parse(Buffer.from(c, 'base64url'));
    if (!ok || !claim.scope.includes('webmasters.readonly')) return json(401, { error: 'invalid_grant', error_description: 'Invalid JWT Signature.' });
    return json(200, { access_token: 'google-token', expires_in: 3600 });
  }
  if (init.headers.Authorization !== 'Bearer google-token') return json(401, { error: { message: 'Invalid Credentials', status: 'UNAUTHENTICATED' } });
  if (url.pathname === '/webmasters/v3/sites') {
    return json(200, { siteEntry: [
      { siteUrl: 'sc-domain:alpha.example', permissionLevel: 'siteFullUser' },
      { siteUrl: 'https://www.beta.example/', permissionLevel: 'siteRestrictedUser' },
      { siteUrl: 'https://www.inconnu.example/', permissionLevel: 'siteUnverifiedUser' },
    ] });
  }
  const m = url.pathname.match(/^\/webmasters\/v3\/sites\/(.+)\/searchAnalytics\/query$/);
  if (m) {
    const site = decodeURIComponent(m[1]);
    const body = JSON.parse(init.body);
    if (site === 'https://www.beta.example/' && scenario === 'site-error') {
      return json(403, { error: { code: 403, message: "User does not have sufficient permission for site 'https://www.beta.example/'.", status: 'PERMISSION_DENIED' } });
    }
    const dim = body.dimensions[0];
    const last = addDays(today, -3);
    if (dim === 'date') {
      const rows = [];
      for (let d = body.startDate < addDays(last, -39) ? addDays(last, -39) : body.startDate; d <= last && d <= body.endDate; d = addDays(d, 1)) {
        rows.push({ keys: [d], clicks: 10, impressions: 200, ctr: 0.05, position: 8.456 });
      }
      return json(200, { rows, responseAggregationType: 'byProperty' });
    }
    const span = (Date.parse(body.endDate) - Date.parse(body.startDate)) / DAY + 1;
    const isPrev = body.endDate < last;
    const keys = dim === 'query' ? ['alpha traiteur', 'alpha avis', 'nouveau mot'] : ['https://alpha.example/', 'https://alpha.example/contact/'];
    const rows = keys
      .filter((k) => !(isPrev && k === 'nouveau mot'))
      .map((k, i) => ({ keys: [k], clicks: (isPrev ? 2 : 3) * span - i, impressions: 40 * span, ctr: 0.07, position: 3.21 + i + (isPrev ? 1 : 0) }));
    return json(200, { rows });
  }
  return json(404, { error: { message: 'Not Found' } });
}

function meta(url, init) {
  const auth = init.headers.Authorization;
  if (auth !== 'Bearer meta-token' && auth !== 'Bearer page-token') {
    return json(400, { error: { message: 'Error validating access token: Session has expired.', type: 'OAuthException', code: 190 } });
  }
  const path = url.pathname.replace(/^\/v[0-9.]+\//, '');
  const q = url.searchParams;
  if (path === 'me/accounts') {
    return json(200, { data: [{
      id: '111', name: 'Page Alpha', link: 'https://www.facebook.com/pagealpha', followers_count: 1500, fan_count: 1400, access_token: 'page-token',
      instagram_business_account: { id: '999', username: 'alpha.insta', name: 'Alpha', followers_count: 4321, media_count: 80 },
    }], paging: { cursors: { before: 'a', after: 'b' } } });
  }
  if (path === '111/insights') {
    const metrics = q.get('metric').split(',');
    if (scenario === 'fb-retired' && metrics.includes('page_post_engagements')) {
      return json(400, { error: { message: '(#100) The value must be a valid insights metric', type: 'OAuthException', code: 100 } });
    }
    const since = q.get('since'); const until = q.get('until');
    const data = metrics.map((name) => {
      const values = [];
      // Meta date chaque valeur par la fin de journée, à minuit heure du Pacifique (07:00 ou 08:00 UTC).
      for (let d = since; d < until; d = addDays(d, 1)) {
        const base = { page_media_view: 300, page_total_media_view_unique: 180, page_post_engagements: 25, page_daily_follows_unique: 4, page_daily_unfollows_unique: 1, page_follows: 1500 }[name];
        values.push({ value: base, end_time: `${addDays(d, 1)}T07:00:00+0000` });
      }
      return { name, period: 'day', values, title: name, description: '', id: `111/insights/${name}/day` };
    });
    return json(200, { data, paging: {} });
  }
  if (path === '999/insights') {
    const metrics = q.get('metric').split(',');
    if (metrics.includes('follower_count')) {
      const values = [];
      for (let i = 29; i >= 1; i--) values.push({ value: 7, end_time: `${addDays(today, -i + 1)}T07:00:00+0000` });
      return json(200, { data: [{ name: 'follower_count', period: 'day', values }] });
    }
    if (q.get('metric_type') !== 'total_value' || q.get('period') !== 'day') return json(400, { error: { message: 'bad params', code: 100 } });
    const span = +q.get('until') - +q.get('since');
    if (span < 82800 || span > 90000) return json(400, { error: { message: 'range', code: 100 } });
    if (scenario === 'ig-retired' && metrics.includes('saves')) {
      return json(400, { error: { message: '(#100) metric[6] must be one of the following values: …', type: 'OAuthException', code: 100 } });
    }
    const base = { views: 900, reach: 500, total_interactions: 60, likes: 40, comments: 5, shares: 8, saves: 7 };
    return json(200, { data: metrics.map((name) => ({ name, period: 'day', title: name, total_value: { value: base[name] }, id: `999/insights/${name}/day` })) });
  }
  if (path === '999/media') {
    return json(200, { data: [
      { id: 'm1', caption: 'Un   reel\nde test', media_type: 'VIDEO', media_product_type: 'REELS', permalink: 'https://www.instagram.com/reel/abc/', timestamp: `${addDays(today, -2)}T10:00:00+0000`, like_count: 120, comments_count: 9 },
      { id: 'm2', caption: 'Carrousel', media_type: 'CAROUSEL_ALBUM', media_product_type: 'FEED', permalink: 'https://www.instagram.com/p/def/', timestamp: `${addDays(today, -5)}T10:00:00+0000`, like_count: 60, comments_count: 2 },
    ] });
  }
  if (path === 'm1/insights') return json(200, { data: [{ name: 'views', values: [{ value: 5000 }] }, { name: 'reach', values: [{ value: 3100 }] }, { name: 'total_interactions', values: [{ value: 210 }] }] });
  if (path === 'm2/insights') return json(400, { error: { message: '(#100) unsupported', code: 100 } });
  return json(404, { error: { message: `Unknown path ${path}`, code: 803 } });
}

function linkedin(url, init) {
  if (url.hostname === 'www.linkedin.com') {
    const form = new URLSearchParams(init.body);
    if (url.pathname === '/oauth/v2/accessToken') {
      if (form.get('refresh_token') !== 'li-refresh') return json(400, { error: 'invalid_request', error_description: 'The provided authorization grant or refresh token is invalid, expired or revoked' });
      return json(200, { access_token: 'li-token', expires_in: 5184000, refresh_token: 'li-refresh', refresh_token_expires_in: 200 * 86400 });
    }
    if (url.pathname === '/oauth/v2/introspectToken') return json(200, { active: true, expires_at: Math.floor(Date.now() / 1000) + 30 * 86400 });
  }
  if (init.headers.Authorization !== 'Bearer li-token') return json(401, { status: 401, serviceErrorCode: 65601, message: 'The token used in the request has been revoked by the user' });
  if (init.headers['X-Restli-Protocol-Version'] !== '2.0.0') return json(400, { status: 400, message: 'restli' });
  // Seule la version d'il y a trois mois est « active » : la collecte doit la trouver seule.
  const now = new Date();
  const active = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 3, 1));
  const activeVersion = `${active.getUTCFullYear()}${String(active.getUTCMonth() + 1).padStart(2, '0')}`;
  if (init.headers['LinkedIn-Version'] !== activeVersion) return json(426, { status: 426, code: 'NONEXISTENT_VERSION', message: `Requested version ${init.headers['LinkedIn-Version']} is not active` });

  const path = url.pathname.replace('/rest/', '');
  const raw = url.search;
  if (path === 'organizationAcls') return json(200, { elements: [{ role: 'ADMINISTRATOR', organization: 'urn:li:organization:5555', roleAssignee: 'urn:li:person:x', state: 'APPROVED' }], paging: { count: 100, start: 0 } });
  if (path === 'organizations/5555') return json(200, { id: 5555, localizedName: 'Alpha SAS', vanityName: 'alpha-sas' });
  if (path.startsWith('networkSizes/')) {
    if (!raw.includes('edgeType=COMPANY_FOLLOWED_BY_MEMBER')) return json(400, { status: 400, message: 'edgeType' });
    return json(200, { firstDegreeSize: 800 });
  }
  const m = raw.match(/timeIntervals=\(timeRange:\(start:(\d+),end:(\d+)\),timeGranularityType:DAY\)/);
  if (!m || !raw.includes('organizationalEntity=urn%3Ali%3Aorganization%3A5555')) return json(400, { status: 400, message: 'Invalid query parameters' });
  const elements = [];
  // LinkedIn s'arrête deux jours avant la date du jour.
  for (let t = +m[1]; t < +m[2] && t <= Date.parse(`${addDays(today, -2)}T00:00:00Z`); t += DAY) {
    const base = { timeRange: { start: t, end: t + DAY }, organizationalEntity: 'urn:li:organization:5555' };
    if (path === 'organizationalEntityShareStatistics') {
      elements.push({ ...base, totalShareStatistics: { clickCount: 6, commentCount: 1, engagement: 0.05, impressionCount: 240, likeCount: 4, shareCount: 1, uniqueImpressionsCount: 150 } });
    } else if (path === 'organizationalEntityFollowerStatistics') {
      elements.push({ ...base, followerGains: { organicFollowerGain: 2, paidFollowerGain: 0 } });
    }
  }
  return json(200, { paging: { count: 10, start: 0 }, elements });
}

globalThis.fetch = async (input, init = {}) => {
  const url = new URL(String(input));
  calls.push(`${init.method || 'GET'} ${url.hostname}${url.pathname}`);
  if (process.env.MOCK_CALL_LOG) writeFileSync(process.env.MOCK_CALL_LOG, JSON.stringify(calls));
  if (/access_token=|token=/.test(url.search)) return json(500, { error: { message: 'TEST : un jeton a été placé dans une adresse.' } });
  if (url.hostname === 'oauth2.googleapis.com' || url.hostname === 'www.googleapis.com') return google(url, init);
  if (url.hostname === 'graph.facebook.com') return meta(url, init);
  if (url.hostname.endsWith('linkedin.com')) return linkedin(url, init);
  return json(500, { error: { message: `Hôte inattendu : ${url.hostname}` } });
};

// Paire de clés pour signer le jeton Google de test.
if (process.env.MOCK_PUBLIC_KEY && !existsSync(process.env.MOCK_PUBLIC_KEY)) {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  writeFileSync(process.env.MOCK_PUBLIC_KEY, publicKey.export({ type: 'spki', format: 'pem' }));
  writeFileSync(process.env.MOCK_PUBLIC_KEY.replace('.pub', '.json'), JSON.stringify({
    type: 'service_account', client_email: 'lecteur@projet-test.iam.gserviceaccount.com',
    private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }), token_uri: 'https://oauth2.googleapis.com/token',
  }));
}
