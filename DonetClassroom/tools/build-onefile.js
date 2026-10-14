#!/usr/bin/env node
/**
 * Builds DonetClassroom-OneFile/DonetClassroom.html.
 *
 * The single-file build is a *committed artifact* — nobody needs this script to
 * use it. It exists so the one-file version cannot drift away from the full
 * version: the same HTML, CSS and JS are inlined, with a flag that switches the
 * app into standalone mode (browser talks to providers directly, chats live in
 * localStorage).
 *
 *   node tools/build-onefile.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.resolve(ROOT, '..', 'DonetClassroom-OneFile');
const OUT_FILE = path.join(OUT_DIR, 'DonetClassroom.html');

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let html = read('frontend/index.html');
const css = read('frontend/styles.css');
const js = read('frontend/app.js');
const iconSvg = read('public/icon.svg');

// Gemini support was added straight into the one-file build and has not been
// ported back to frontend/app.js yet. Rebuilding now would silently delete it.
if (
  !process.argv.includes('--force') &&
  fs.existsSync(OUT_FILE) &&
  fs.readFileSync(OUT_FILE, 'utf8').includes('geminiCatalogue') &&
  !js.includes('geminiCatalogue')
) {
  console.error(
    '✗ DonetClassroom.html has Gemini support that frontend/app.js lacks.\n' +
    '  Port it into frontend/app.js first, or re-run with --force to overwrite it.'
  );
  process.exit(1);
}
const iconDataUri = 'data:image/svg+xml;base64,' + Buffer.from(iconSvg, 'utf8').toString('base64');

// 1. inline the favicon so it works from file://
html = html.replace(/<link rel="icon"[^>]*>/, `<link rel="icon" href="${iconDataUri}" type="image/svg+xml" />`);
html = html.replace(/<link rel="apple-touch-icon"[^>]*>/, `<link rel="apple-touch-icon" href="${iconDataUri}" />`);

// 2. inline the stylesheet
html = html.replace(
  '<link rel="stylesheet" href="/styles.css" />',
  '<style>\n' + css + '\n</style>'
);

// 3. inline the app, switched into standalone mode
html = html.replace(
  '<script src="/app.js" defer></script>',
  '<script>\n' +
  '/* Standalone mode: this page talks to Ollama and OpenRouter directly and\n' +
  '   keeps chats in this browser. No server, no build step. */\n' +
  'window.DONET_STANDALONE = true;\n' +
  '</script>\n<script>\n' + js + '\n</script>'
);

// 4. a banner comment at the very top
html = html.replace(
  '<!DOCTYPE html>',
  '<!DOCTYPE html>\n<!--\n  DonetClassroom — single-file build (generated from the full version).\n' +
  '  Open this file in a browser. Nothing to install.\n' +
  `  Built: ${new Date().toISOString()}\n-->`
);

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT_FILE, html, 'utf8');

const kb = (fs.statSync(OUT_FILE).size / 1024).toFixed(1);
console.log(`✓ ${path.relative(process.cwd(), OUT_FILE)}  (${kb} KB, self-contained)`);
