#!/usr/bin/env node
// Collecte quotidienne : interroge chaque source branchée, fusionne avec l'historique
// déjà enregistré, puis écrit le fichier chiffré que lit le tableau de bord.
//
//   node collect/index.js          collecte réelle (selon les clés présentes)
//   node collect/index.js --demo   données de démonstration
//   node collect/index.js --reset  repart de zéro (efface l'historique enregistré)
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encryptJSON, decryptJSON } from './lib/crypto.js';
import { todayISO } from './lib/dates.js';
import { collectSearchConsole } from './sources/searchconsole.js';
import { collectMeta } from './sources/meta.js';
import { collectLinkedIn } from './sources/linkedin.js';
import { buildDemo } from './sources/demo.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.env.DASHBOARD_DATA_FILE || path.join(ROOT, 'site', 'data.enc.json');
const NETWORK_ORDER = { instagram: 0, facebook: 1, linkedin: 2 };
const log = (...a) => console.log(...a);

class Stop extends Error {}

// Lit un éventuel fichier .env (usage sur son ordinateur ; en ligne, ce sont les « secrets » GitHub).
function loadDotEnv() {
  const file = path.join(ROOT, '.env');
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

async function readJSON(file, fallback) {
  if (!existsSync(file)) return fallback;
  try { return JSON.parse(await readFile(file, 'utf8')); } catch (e) { throw new Stop(`Fichier illisible : ${path.relative(ROOT, file)} (${e.message})`); }
}

function googleCredentials(env) {
  // Accès sans clé : un jeton temporaire fourni par GitHub Actions (fédération d'identité Google).
  const accessToken = (env.GOOGLE_ACCESS_TOKEN || '').trim();
  if (accessToken) return { access_token: accessToken, client_email: (env.GOOGLE_SERVICE_ACCOUNT || '').trim() };
  let raw = env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw && env.GOOGLE_SERVICE_ACCOUNT_FILE) raw = readFileSync(path.resolve(ROOT, env.GOOGLE_SERVICE_ACCOUNT_FILE), 'utf8');
  if (!raw || !raw.trim()) return null;
  let sa;
  try { sa = JSON.parse(raw); } catch { throw new Stop('GOOGLE_SERVICE_ACCOUNT_JSON n’est pas un JSON valide : collez le contenu complet du fichier de clé.'); }
  if (!sa.client_email || !sa.private_key) throw new Stop('La clé Google ne contient pas client_email / private_key : ce n’est pas une clé de compte de service.');
  return sa;
}

// Total d'une métrique sur les `days` derniers jours d'une série.
function recent(daily, metric, days) {
  const values = (daily && daily[metric]) || [];
  return values.slice(-days).reduce((s, v) => s + (v || 0), 0);
}

async function main() {
  loadDotEnv();
  const args = new Set(process.argv.slice(2));
  const env = process.env;
  const today = todayISO();
  const config = await readJSON(path.join(ROOT, 'config.json'), {});
  const envelope = await readJSON(OUT, null);

  const creds = {
    google: googleCredentials(env),
    meta: (env.META_ACCESS_TOKEN || '').trim() || null,
    linkedin: {
      accessToken: (env.LINKEDIN_ACCESS_TOKEN || '').trim() || null,
      refreshToken: (env.LINKEDIN_REFRESH_TOKEN || '').trim() || null,
      clientId: (env.LINKEDIN_CLIENT_ID || '').trim() || null,
      clientSecret: (env.LINKEDIN_CLIENT_SECRET || '').trim() || null,
    },
  };
  const hasLinkedIn = !!(creds.linkedin.accessToken || creds.linkedin.refreshToken);
  const anyCredential = !!(creds.google || creds.meta || hasLinkedIn);
  const password = env.DASHBOARD_PASSWORD || '';

  // --- Démonstration : demandée, ou rien n'est encore configuré. ---
  const nothingConfigured = !anyCredential && !password && (!envelope || envelope.demo);
  if (args.has('--demo') || nothingConfigured) {
    const demoPassword = password || 'demo';
    await writeFile(OUT, JSON.stringify(await encryptJSON(buildDemo(today), demoPassword, { demo: true })));
    log(`Données de démonstration écrites. Mot de passe du tableau de bord : ${password ? '(celui de DASHBOARD_PASSWORD)' : 'demo'}`);
    if (nothingConfigured && !args.has('--demo')) log('Aucune clé ni mot de passe configuré pour l’instant : voir GUIDE-MISE-EN-SERVICE.md.');
    return;
  }

  if (!password) throw new Stop('DASHBOARD_PASSWORD est absent. Choisissez le mot de passe du tableau de bord et ajoutez-le aux secrets.');
  if (password.length < 12) log('Attention : mot de passe court. Le fichier chiffré est téléchargeable par quiconque connaît l’adresse du site ; préférez une phrase d’au moins 4 mots.');

  // --- Historique déjà enregistré. ---
  let existing = null;
  let salt;
  if (envelope && !envelope.demo && !args.has('--reset')) {
    for (const candidate of [password, env.DASHBOARD_PASSWORD_PREVIOUS]) {
      if (!candidate) continue;
      try {
        existing = await decryptJSON(envelope, candidate);
        if (candidate === password) salt = envelope.salt;
        break;
      } catch { /* mauvais mot de passe : on essaie le suivant */ }
    }
    if (!existing) {
      throw new Stop(
        'Le mot de passe ne permet pas de relire l’historique déjà enregistré. Rien n’a été modifié.\n' +
        '  - Mot de passe changé volontairement : ajoutez l’ancien dans DASHBOARD_PASSWORD_PREVIOUS le temps d’une mise à jour.\n' +
        '  - Ancien mot de passe perdu : relancez avec --reset (l’historique accumulé sera effacé).',
      );
    }
  }
  const index = (list) => new Map((list || []).map((e) => [e.id, e]));
  const oldSites = index(existing && existing.sites);
  const oldAccounts = index(existing && existing.accounts);
  const byNetwork = (network) => new Map([...oldAccounts].filter(([, a]) => a.network === network));

  // --- Sources. ---
  const jobs = [
    {
      key: 'searchConsole', name: 'Google Search Console', enabled: !!creds.google,
      run: () => collectSearchConsole({ credentials: creds.google, config: config.searchConsole || {}, existing: oldSites, today, log }),
      previous: () => [...oldSites.values()], kind: 'sites',
    },
    {
      key: 'meta', name: 'Meta (Instagram et Facebook)', enabled: !!creds.meta,
      run: () => collectMeta({ token: creds.meta, config: config.meta || {}, existing: oldAccounts, today, log }),
      previous: () => [...byNetwork('instagram').values(), ...byNetwork('facebook').values()], kind: 'accounts',
    },
    {
      key: 'linkedin', name: 'LinkedIn', enabled: hasLinkedIn,
      run: () => collectLinkedIn({ credentials: creds.linkedin, config: config.linkedin || {}, existing: oldAccounts, today, log }),
      previous: () => [...byNetwork('linkedin').values()], kind: 'accounts',
    },
  ];

  const data = { version: 1, generatedAt: new Date().toISOString(), demo: false, sites: [], accounts: [], sources: {} };
  for (const job of jobs) {
    const excluded = new Set((config[job.key] && config[job.key].exclude) || []);
    const kept = job.previous().filter((e) => !excluded.has(e.id));
    if (!job.enabled) {
      // Source non branchée : on conserve ce qui avait déjà été collecté.
      data.sources[job.key] = { connected: false, ok: false, message: '' };
      data[job.kind].push(...kept);
      continue;
    }
    try {
      const { entities, source } = await job.run();
      data.sources[job.key] = source;
      const seen = new Set(entities.map((e) => e.id));
      data[job.kind].push(...entities);
      for (const old of kept) {
        if (seen.has(old.id)) continue;
        data[job.kind].push({ ...old, status: { ...old.status, ok: false, message: 'Ce compte n’est plus visible avec l’accès actuel.' } });
      }
    } catch (e) {
      // La source entière a échoué (clé refusée, service indisponible) : l'historique reste affiché.
      log(`! ${job.name} : ${e.message}`);
      data.sources[job.key] = { connected: true, ok: false, message: e.message };
      data[job.kind].push(...kept.map((old) => ({ ...old, status: { ...old.status, ok: false, message: e.message } })));
    }
  }

  data.sites.sort((a, b) => recent(b.daily, 'clicks', 28) - recent(a.daily, 'clicks', 28));
  data.accounts.sort((a, b) =>
    (NETWORK_ORDER[a.network] ?? 9) - (NETWORK_ORDER[b.network] ?? 9) || (b.followers || 0) - (a.followers || 0));

  // --- Écriture, puis relecture de contrôle. ---
  const next = await encryptJSON(data, password, { salt });
  await decryptJSON(next, password);
  await writeFile(OUT, JSON.stringify(next));

  log('');
  log(`Tableau de bord mis à jour : ${data.sites.length} site(s), ${data.accounts.length} compte(s).`);
  for (const job of jobs) {
    const s = data.sources[job.key];
    log(`  ${job.name} : ${!s.connected ? 'non branché' : s.ok ? 'OK' : `ERREUR - ${s.message}`}`);
  }
  const failing = [...data.sites, ...data.accounts].filter((e) => !e.status.ok);
  for (const e of failing) log(`  ! ${e.label} : ${e.status.message}`);
}

main().catch((e) => {
  console.error(e instanceof Stop ? `\nArrêt : ${e.message}\n` : e);
  process.exit(1);
});
