#!/usr/bin/env node
// Fabrique une page autonome (un seul fichier, sans mot de passe) à partir de données en clair.
//   node scripts/build-preview.js <donnees.json> <sortie.html>
// Sert aux aperçus et aux captures ; le site en ligne, lui, ne contient que des données chiffrées.
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'site');
const [dataFile, outFile] = process.argv.slice(2);
const [css, js, data] = await Promise.all([
  readFile(path.join(SITE, 'styles.css'), 'utf8'), readFile(path.join(SITE, 'app.js'), 'utf8'), readFile(dataFile, 'utf8'),
]);
const inline = JSON.stringify(JSON.parse(data)).replace(/</g, '\\u003c');
await writeFile(outFile, `<title>Tableau de bord audience</title>
<style>
${css}</style>
<div id="app"></div>
<script>window.__DATA__ = ${inline};</script>
<script>
${js}</script>
`);
console.log(`Aperçu écrit : ${outFile}`);
