// Chiffrement du fichier de données : AES-256-GCM, clé dérivée du mot de passe (PBKDF2-SHA256).
// Le site déchiffre dans le navigateur avec exactement les mêmes paramètres (site/app.js).
import { webcrypto } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';

const { subtle } = webcrypto;
export const ITERATIONS = 600000;

const b64 = (bytes) => Buffer.from(bytes).toString('base64');
const unb64 = (s) => new Uint8Array(Buffer.from(s, 'base64'));

async function deriveKey(password, salt, iterations) {
  const base = await subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
  );
}

// `salt` : réutiliser celui du fichier précédent tant que le mot de passe ne change pas,
// pour que l'option « se souvenir de moi » du site reste valable d'un jour à l'autre.
export async function encryptJSON(data, password, { salt, demo = false } = {}) {
  const saltBytes = salt ? unb64(salt) : webcrypto.getRandomValues(new Uint8Array(16));
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, saltBytes, ITERATIONS);
  const plain = gzipSync(Buffer.from(JSON.stringify(data)));
  const cipher = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, key, plain));
  const envelope = {
    v: 1, kdf: 'PBKDF2-SHA256', iter: ITERATIONS, cipher: 'AES-256-GCM', enc: 'gzip',
    salt: b64(saltBytes), iv: b64(iv), data: b64(cipher),
  };
  if (demo) envelope.demo = true;
  return envelope;
}

// Renvoie les données, ou lève une erreur si le mot de passe ne convient pas.
export async function decryptJSON(envelope, password) {
  const key = await deriveKey(password, unb64(envelope.salt), envelope.iter);
  const plain = await subtle.decrypt({ name: 'AES-GCM', iv: unb64(envelope.iv) }, key, unb64(envelope.data));
  return JSON.parse(gunzipSync(Buffer.from(plain)).toString('utf8'));
}
