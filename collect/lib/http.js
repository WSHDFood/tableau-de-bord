// Requêtes HTTP avec reprises automatiques. Aucune dépendance externe.
export class HttpError extends Error {
  constructor(message, { status, body } = {}) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.body = body;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Extrait le message d'erreur lisible, quel que soit le fournisseur.
function describe(json, status) {
  if (!json || typeof json !== 'object') return `HTTP ${status}`;
  const e = json.error;
  if (e && typeof e === 'object') return e.message || e.status || `HTTP ${status}`;
  if (typeof e === 'string') return json.error_description ? `${e} : ${json.error_description}` : e;
  return json.message || `HTTP ${status}`;
}

export async function request(url, { method = 'GET', headers = {}, body, form, retries = 3, timeout = 30000 } = {}) {
  const h = { Accept: 'application/json', ...headers };
  let payload;
  if (form) {
    payload = new URLSearchParams(form).toString();
    h['Content-Type'] = 'application/x-www-form-urlencoded';
  } else if (body !== undefined) {
    payload = typeof body === 'string' ? body : JSON.stringify(body);
    h['Content-Type'] = 'application/json';
  }

  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(Math.min(8000, 600 * 2 ** (attempt - 1)));
    let res;
    try {
      res = await fetch(url, { method, headers: h, body: payload, signal: AbortSignal.timeout(timeout) });
    } catch (e) {
      lastError = new HttpError(`Connexion impossible (${e.name === 'TimeoutError' ? 'délai dépassé' : e.message})`);
      continue;
    }
    const text = await res.text();
    let json;
    try { json = text ? JSON.parse(text) : {}; } catch { json = { message: text.slice(0, 300) }; }
    if (res.ok) return json;
    lastError = new HttpError(describe(json, res.status), { status: res.status, body: json });
    if (res.status !== 429 && res.status < 500) break;
  }
  throw lastError;
}

// Exécute `fn` sur chaque élément avec au plus `limit` appels en parallèle.
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
