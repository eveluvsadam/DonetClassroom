'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const built = fs.readFileSync(path.join(root, '..', 'DonetClassroom-OneFile', 'DonetClassroom.html'), 'utf8');

test('one-file build contains app.js and styles.css byte-for-byte', () => {
  // Guards against String.replace mangling "$$" / "$&" in the inlined code.
  assert.ok(built.includes(fs.readFileSync(path.join(root, 'frontend', 'app.js'), 'utf8')));
  assert.ok(built.includes(fs.readFileSync(path.join(root, 'frontend', 'styles.css'), 'utf8')));
});

test('one-file build has no API key embedded', () => {
  assert.doesNotMatch(built, /AIza[0-9A-Za-z_-]{30,}|AQ\.Ab8|sk-or-v1-[0-9a-f]{20,}/);
});
