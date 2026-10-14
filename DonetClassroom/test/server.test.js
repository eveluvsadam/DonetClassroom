'use strict';
// Runs with Node's built-in test runner: `npm test`. No network access needed:
// Ollama points at a closed port and Gemini at a local fake server.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const chatsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'donet-chats-'));
let gemini, server, base;
const geminiRequests = [];

before(async () => {
  // Fake Gemini: checks the key travels as a header, streams two chunks back.
  gemini = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      if (req.headers['x-goog-api-key'] !== 'test-key' || req.url.includes('key=')) {
        res.writeHead(403);
        return res.end('{}');
      }
      if (req.url.endsWith('/models')) {
        res.writeHead(200);
        return res.end('{"models":[]}');
      }
      geminiRequests.push(JSON.parse(body));
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('data: {"candidates":[{"content":{"parts":[{"text":"Hello "},{"thoughtSignature":"x","text":""}]}}]}\n\n');
      res.end('data: {"candidates":[{"content":{"parts":[{"text":"world"}]},"finishReason":"STOP"}],"modelVersion":"gemini-test"}\n\n');
    });
  });
  await new Promise((r) => gemini.listen(0, '127.0.0.1', r));

  Object.assign(process.env, {
    CHATS_DIR: chatsDir,
    GEMINI_URL: `http://127.0.0.1:${gemini.address().port}`,
    GEMINI_API_KEY: 'test-key',
    OPENROUTER_API_KEY: '',
    OLLAMA_URL: 'http://127.0.0.1:1',
  });
  const app = require('../backend/server');
  server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server?.close();
  gemini?.close();
  fs.rmSync(chatsDir, { recursive: true, force: true });
});

const json = (url, opts = {}) =>
  fetch(base + url, { headers: { 'content-type': 'application/json' }, ...opts });

test('public config never contains API keys', async () => {
  const text = await (await json('/api/config')).text();
  assert.ok(!text.includes('test-key'));
  assert.equal(JSON.parse(text).hasGeminiKey, true);
});

test('status reports Gemini as connected', async () => {
  const data = await (await json('/api/status')).json();
  assert.equal(data.gemini.ok, true);
  assert.equal(data.ollama.online, false);
});

test('chat rejects an empty conversation', async () => {
  const res = await json('/api/chat', { method: 'POST', body: '{}' });
  assert.equal(res.status, 400);
});

test('auto mode falls back to Gemini and streams its reply', async () => {
  const res = await json('/api/chat', {
    method: 'POST',
    body: JSON.stringify({
      provider: 'auto',
      temperature: 0.5,
      messages: [
        { role: 'system', content: 'Be brief' },
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'yo' },
        { role: 'user', content: 'again' },
      ],
    }),
  });
  const text = await res.text();
  assert.match(text, /"provider":"gemini"/);
  assert.match(text, /"text":"Hello "/);
  assert.match(text, /"text":"world"/);
  assert.match(text, /event: done/);

  const sent = geminiRequests.at(-1);
  assert.equal(sent.systemInstruction.parts[0].text, 'Be brief');
  assert.deepEqual(sent.contents.map((c) => c.role), ['user', 'model', 'user']);
  assert.equal(sent.generationConfig.temperature, 0.5);
});

test('chats can be saved, listed, read and deleted', async () => {
  const chat = { title: 'Test chat', messages: [{ role: 'user', content: 'hello' }] };
  assert.equal((await json('/api/chats/abc_123', { method: 'PUT', body: JSON.stringify(chat) })).status, 200);
  const list = await (await json('/api/chats')).json();
  assert.ok(list.chats.some((c) => c.id === 'abc_123'));
  assert.equal((await (await json('/api/chats/abc_123')).json()).title, 'Test chat');
  assert.equal((await json('/api/chats/abc_123', { method: 'DELETE' })).status, 200);
  assert.equal((await json('/api/chats/abc_123')).status, 404);
});

test('chat ids cannot escape the chats folder', async () => {
  const res = await json('/api/chats/..%2F..%2Fpackage', { method: 'PUT', body: '{"messages":[]}' });
  assert.equal(res.status, 400);
});
