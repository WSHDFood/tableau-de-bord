// Tests de la collecte, sans aucun accès réel : les API sont simulées (test/mock-apis.js).
//   npm test
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { decryptJSON } from '../collect/lib/crypto.js';
import { addDays, todayISO, zonedMidnight, chunkRange } from '../collect/lib/dates.js';
import { dailyToMap, mapToDaily } from '../collect/lib/series.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = mkdtempSync(path.join(tmpdir(), 'tdb-'));
const today = todayISO();
const yesterday = addDays(today, -1);
let passed = 0;

function run(name, { args = [], env = {}, scenario = 'ok', file = 'data.enc.json' } = {}) {
  const callLog = path.join(dir, `calls-${name}.json`);
  const res = spawnSync(process.execPath, ['--import', path.join(ROOT, 'test', 'mock-apis.js'), path.join(ROOT, 'collect', 'index.js'), ...args], {
    cwd: dir, encoding: 'utf8',
    env: {
      PATH: process.env.PATH, MOCK_SCENARIO: scenario, MOCK_CALL_LOG: callLog,
      MOCK_PUBLIC_KEY: path.join(dir, 'sa.pub'), DASHBOARD_DATA_FILE: path.join(dir, file), ...env,
    },
  });
  return { ...res, calls: existsSync(callLog) ? JSON.parse(readFileSync(callLog, 'utf8')) : [] };
}
const read = async (password, file = 'data.enc.json') => decryptJSON(JSON.parse(readFileSync(path.join(dir, file), 'utf8')), password);
const at = (daily, metric, date) => dailyToMap(daily).get(date)?.[metric];
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok  ${name}`); } catch (e) { console.error(`  ÉCHEC  ${name}\n${e.stack}`); process.exitCode = 1; }
}

const ALL = {
  DASHBOARD_PASSWORD: 'quatre mots bien choisis',
  GOOGLE_SERVICE_ACCOUNT_FILE: path.join(dir, 'sa.json'),
  META_ACCESS_TOKEN: 'meta-token',
  LINKEDIN_REFRESH_TOKEN: 'li-refresh', LINKEDIN_CLIENT_ID: 'id', LINKEDIN_CLIENT_SECRET: 'secret',
};

console.log('Outils');
await test('minuit heure du Pacifique, été et hiver', () => {
  assert.equal(new Date(zonedMidnight('2026-07-01', 'America/Los_Angeles')).toISOString(), '2026-07-01T07:00:00.000Z');
  assert.equal(new Date(zonedMidnight('2026-01-15', 'America/Los_Angeles')).toISOString(), '2026-01-15T08:00:00.000Z');
});
await test('découpage en tranches et séries compactes', () => {
  assert.deepEqual(chunkRange('2026-01-01', '2026-01-10', 4), [['2026-01-01', '2026-01-04'], ['2026-01-05', '2026-01-08'], ['2026-01-09', '2026-01-10']]);
  const daily = mapToDaily(new Map([['2026-01-03', { a: 1 }], ['2026-01-01', { a: 5, b: 0 }]]), ['a', 'b']);
  assert.deepEqual(daily, { start: '2026-01-01', a: [5, null, 1], b: [0, null, null] });
  assert.deepEqual([...dailyToMap(daily)], [['2026-01-01', { a: 5, b: 0 }], ['2026-01-03', { a: 1 }]]);
});

console.log('Démonstration');
await test('sans aucune clé, le site reçoit des données de démonstration (mot de passe « demo »)', async () => {
  const r = run('demo', { file: 'demo.enc.json' });
  assert.equal(r.status, 0, r.stderr);
  const data = await read('demo', 'demo.enc.json');
  assert.equal(data.demo, true);
  assert.equal(data.sites.length, 4);
  assert.equal(data.accounts.length, 5);
  assert.equal(r.calls.length, 0);
});

console.log('Première collecte (les trois sources)');
let first;
await test('la collecte se termine et le fichier se relit avec le mot de passe', async () => {
  const r = run('first', { env: ALL });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  first = { data: await read(ALL.DASHBOARD_PASSWORD), calls: r.calls, out: r.stdout };
  assert.equal(first.data.demo, false);
  assert.deepEqual(Object.values(first.data.sources).map((s) => s.ok), [true, true, true]);
});
await test('Search Console : propriétés, courbe quotidienne, requêtes comparées', () => {
  const { sites } = first.data;
  assert.deepEqual(sites.map((s) => s.id).sort(), ['https://www.beta.example/', 'sc-domain:alpha.example']);
  const alpha = sites.find((s) => s.id === 'sc-domain:alpha.example');
  assert.equal(alpha.label, 'alpha.example');
  assert.equal(alpha.url, 'https://alpha.example/');
  assert.equal(alpha.status.lastDate, addDays(today, -3));
  assert.equal(alpha.daily.clicks.length, 40);
  assert.equal(at(alpha.daily, 'position', addDays(today, -3)), 8.46);
  const [q1, , q3] = alpha.top[7].queries;
  assert.deepEqual(q1, { k: 'alpha traiteur', c: 21, i: 280, p: 3.2, pc: 14, pp: 4.2 });
  assert.deepEqual([q3.k, q3.pc, q3.pp], ['nouveau mot', 0, null]);
  assert.equal(alpha.top[365].queries[0].pc, null, 'pas de comparaison possible sur 12 mois');
  assert.equal(alpha.top[28].pages.length, 2);
});
await test('Facebook : un an d’historique, abonnés nets, date du jour mesuré', () => {
  const fb = first.data.accounts.find((a) => a.id === 'fb:111');
  assert.equal(fb.label, 'Page Alpha');
  assert.equal(fb.status.lastDate, yesterday);
  assert.equal(fb.daily.start, addDays(today, -365));
  assert.deepEqual(['views', 'reach', 'interactions', 'newFollowers', 'followers'].map((m) => at(fb.daily, m, yesterday)), [300, 180, 25, 3, 1500]);
});
await test('Instagram : 90 jours, nouveaux abonnés, publications', () => {
  const ig = first.data.accounts.find((a) => a.id === 'ig:999');
  assert.equal(ig.label, '@alpha.insta');
  assert.equal(ig.followers, 4321);
  assert.equal(ig.daily.start, addDays(today, -90));
  assert.equal(ig.status.lastDate, yesterday);
  assert.deepEqual(['views', 'reach', 'interactions', 'saves', 'newFollowers', 'followers'].map((m) => at(ig.daily, m, yesterday)), [900, 500, 60, 7, 7, 4321]);
  assert.equal(at(ig.daily, 'newFollowers', addDays(today, -60)), undefined);
  assert.deepEqual(ig.posts.map((p) => [p.type, p.text, p.views, p.interactions]), [['Reel', 'Un reel de test', 5000, 210], ['Carrousel', 'Carrousel', null, 62]]);
});
await test('LinkedIn : version d’API trouvée seule, statistiques, historique des abonnés', () => {
  const li = first.data.accounts.find((a) => a.id === 'li:5555');
  const last = addDays(today, -2);
  assert.equal(li.label, 'Alpha SAS');
  assert.equal(li.url, 'https://www.linkedin.com/company/alpha-sas/');
  assert.equal(li.status.lastDate, last);
  assert.deepEqual(['views', 'reach', 'interactions', 'clicks', 'newFollowers', 'followers'].map((m) => at(li.daily, m, last)), [240, 150, 12, 6, 2, 800]);
  assert.equal(at(li.daily, 'followers', addDays(last, -10)), 780);
  assert.equal(li.daily.start, addDays(today, -364));
  assert.ok(first.data.sources.linkedin.expiresAt > today);
});
await test('aucun jeton ne passe dans une adresse', () => {
  assert.ok(!/ERREUR|TEST :/.test(first.out), first.out);
});

console.log('Mises à jour suivantes');
await test('la deuxième collecte ne relit que les derniers jours et garde l’historique', async () => {
  const r = run('second', { env: ALL });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const data = await read(ALL.DASHBOARD_PASSWORD);
  const count = (calls, part) => calls.filter((c) => c.includes(part)).length;
  assert.ok(count(first.calls, '/999/insights') > 85);
  assert.ok(count(r.calls, '/999/insights') <= 6, `${count(r.calls, '/999/insights')} appels Instagram`);
  assert.equal(data.accounts.find((a) => a.id === 'ig:999').daily.start, addDays(today, -90));
  assert.equal(data.accounts.find((a) => a.id === 'fb:111').daily.start, addDays(today, -365));
  const before = JSON.parse(readFileSync(path.join(dir, 'data.enc.json'), 'utf8'));
  assert.ok(before.salt, 'le sel reste stable tant que le mot de passe ne change pas');
});
await test('un mauvais mot de passe arrête tout sans toucher au fichier', () => {
  const before = readFileSync(path.join(dir, 'data.enc.json'), 'utf8');
  const r = run('badpw', { env: { ...ALL, DASHBOARD_PASSWORD: 'un autre mot de passe' } });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Rien n’a été modifié/);
  assert.equal(readFileSync(path.join(dir, 'data.enc.json'), 'utf8'), before);
});
await test('changement de mot de passe avec l’ancien fourni : l’historique suit', async () => {
  const r = run('rotate', { env: { ...ALL, DASHBOARD_PASSWORD: 'nouvelle phrase secrète', DASHBOARD_PASSWORD_PREVIOUS: ALL.DASHBOARD_PASSWORD } });
  assert.equal(r.status, 0, r.stderr);
  const data = await read('nouvelle phrase secrète');
  assert.equal(data.accounts.find((a) => a.id === 'ig:999').daily.start, addDays(today, -90));
  await assert.rejects(read(ALL.DASHBOARD_PASSWORD));
});
await test('jeton Meta refusé : le reste est mis à jour, les comptes restent affichés avec l’erreur', async () => {
  const r = run('metadown', { env: { ...ALL, DASHBOARD_PASSWORD: 'nouvelle phrase secrète', META_ACCESS_TOKEN: 'expiré' } });
  assert.equal(r.status, 0, r.stderr);
  const data = await read('nouvelle phrase secrète');
  assert.equal(data.sources.meta.ok, false);
  assert.match(data.sources.meta.message, /Session has expired/);
  const ig = data.accounts.find((a) => a.id === 'ig:999');
  assert.equal(ig.status.ok, false);
  assert.equal(at(ig.daily, 'views', yesterday), 900);
  assert.equal(data.sources.searchConsole.ok, true);
});
await test('source débranchée : ce qui avait été collecté est conservé', async () => {
  const { LINKEDIN_REFRESH_TOKEN, ...rest } = ALL;
  const r = run('nolinkedin', { env: { ...rest, DASHBOARD_PASSWORD: 'nouvelle phrase secrète' } });
  assert.equal(r.status, 0, r.stderr);
  const data = await read('nouvelle phrase secrète');
  assert.equal(data.sources.linkedin.connected, false);
  assert.ok(data.accounts.some((a) => a.id === 'li:5555'));
});

console.log('Cas dégradés');
await test('un indicateur Facebook retiré par Meta n’empêche pas les autres', async () => {
  const r = run('fbretired', { env: ALL, scenario: 'fb-retired', file: 'fb.enc.json' });
  assert.equal(r.status, 0, r.stderr);
  const fb = (await read(ALL.DASHBOARD_PASSWORD, 'fb.enc.json')).accounts.find((a) => a.id === 'fb:111');
  assert.equal(fb.status.ok, true);
  assert.match(fb.status.message, /page_post_engagements/);
  assert.deepEqual([at(fb.daily, 'views', yesterday), at(fb.daily, 'interactions', yesterday)], [300, undefined]);
});
await test('un indicateur Instagram retiré par Meta n’empêche pas les autres', async () => {
  const r = run('igretired', { env: ALL, scenario: 'ig-retired', file: 'ig.enc.json' });
  assert.equal(r.status, 0, r.stderr);
  const ig = (await read(ALL.DASHBOARD_PASSWORD, 'ig.enc.json')).accounts.find((a) => a.id === 'ig:999');
  assert.match(ig.status.message, /saves/);
  assert.deepEqual([at(ig.daily, 'views', addDays(today, -40)), at(ig.daily, 'saves', yesterday)], [900, undefined]);
});
await test('une propriété Search Console en erreur n’empêche pas les autres', async () => {
  const r = run('siteerror', { env: ALL, scenario: 'site-error', file: 'site.enc.json' });
  assert.equal(r.status, 0, r.stderr);
  const { sites } = await read(ALL.DASHBOARD_PASSWORD, 'site.enc.json');
  const beta = sites.find((s) => s.id === 'https://www.beta.example/');
  assert.equal(beta.status.ok, false);
  assert.match(beta.status.message, /sufficient permission/);
  assert.equal(sites.find((s) => s.id === 'sc-domain:alpha.example').status.ok, true);
});
await test('Google sans clé : un jeton temporaire fourni par GitHub suffit', async () => {
  const r = run('keyless', { env: { DASHBOARD_PASSWORD: ALL.DASHBOARD_PASSWORD, GOOGLE_ACCESS_TOKEN: 'google-token', GOOGLE_SERVICE_ACCOUNT: 'robot@projet.iam.gserviceaccount.com' }, file: 'keyless.enc.json' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const data = await read(ALL.DASHBOARD_PASSWORD, 'keyless.enc.json');
  assert.equal(data.sites.length, 2);
  assert.equal(data.sources.searchConsole.account, 'robot@projet.iam.gserviceaccount.com');
  assert.ok(!r.calls.some((c) => c.includes('oauth2.googleapis.com')), 'aucun échange de clé');
});
await test('clés présentes mais mot de passe absent : arrêt avec une consigne claire', () => {
  const { DASHBOARD_PASSWORD, ...rest } = ALL;
  const r = run('nopw', { env: rest, file: 'nopw.enc.json' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /DASHBOARD_PASSWORD est absent/);
});

console.log(process.exitCode ? '\nDes tests ont échoué.' : `\n${passed} tests réussis.`);
