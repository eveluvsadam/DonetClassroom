/**
 * DonetClassroom server.
 *
 * Responsibilities:
 *   • serve the frontend
 *   • proxy chat to Ollama (local) and OpenRouter (free cloud)
 *   • enforce zero-cost protection before any request leaves the machine
 *   • keep the API key server-side, never in the browser
 *   • persist conversations as plain JSON files under data/chats
 */
'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const express = require('express');

const config = require('./config');
const ollama = require('./providers/ollama');
const openrouter = require('./providers/openrouter');
const gemini = require('./providers/gemini');

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '32mb' }));

fs.mkdirSync(config.chatsDir, { recursive: true });

/* ------------------------------------------------------------------ utils */

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

function chatPath(id) {
  if (!ID_RE.test(String(id))) throw Object.assign(new Error('Invalid chat id'), { status: 400 });
  return path.join(config.chatsDir, `${id}.json`);
}

/** Rough token estimate. Deliberately crude — it only drives context trimming. */
function estimateTokens(message) {
  const content = message.content;
  if (typeof content === 'string') return Math.ceil(content.length / 4) + 4;
  if (!Array.isArray(content)) return 4;
  let total = 4;
  for (const part of content) {
    if (part.type === 'text') total += Math.ceil((part.text || '').length / 4);
    else if (part.type === 'image_url') total += 1200; // images are expensive; assume a lot
  }
  return total;
}

/** Strip anything we did not put there, and reject non-image data URLs. */
function sanitizeMessages(messages) {
  if (!Array.isArray(messages)) return [];
  const out = [];
  for (const raw of messages) {
    if (!raw || typeof raw !== 'object') continue;
    const role = ['system', 'user', 'assistant'].includes(raw.role) ? raw.role : null;
    if (!role) continue;

    if (typeof raw.content === 'string') {
      out.push({ role, content: raw.content });
      continue;
    }
    if (!Array.isArray(raw.content)) continue;

    const parts = [];
    for (const part of raw.content) {
      if (!part || typeof part !== 'object') continue;
      if (part.type === 'text' && typeof part.text === 'string') {
        parts.push({ type: 'text', text: part.text });
      } else if (part.type === 'image_url') {
        const url = part.image_url?.url;
        if (typeof url === 'string' && /^data:image\/(png|jpe?g|webp|gif);base64,/i.test(url)) {
          parts.push({ type: 'image_url', image_url: { url } });
        }
      }
    }
    if (parts.length) out.push({ role, content: parts });
  }
  return out;
}

function hasImages(messages) {
  return messages.some(
    (m) => Array.isArray(m.content) && m.content.some((p) => p.type === 'image_url')
  );
}

/**
 * Keep the conversation inside the model's context window: always keep the
 * system prompt and the newest turns, drop the oldest ones first.
 */
function trimContext(messages, { contextLimit, reserve = 1024 }) {
  const budget = Math.max(1500, (contextLimit || 8192) - reserve);
  const system = messages.filter((m) => m.role === 'system');
  const rest = messages.filter((m) => m.role !== 'system');

  let used = system.reduce((n, m) => n + estimateTokens(m), 0);
  const kept = [];
  for (let i = rest.length - 1; i >= 0; i--) {
    const cost = estimateTokens(rest[i]);
    if (used + cost > budget && kept.length >= 1) break;
    used += cost;
    kept.unshift(rest[i]);
  }
  return { messages: [...system, ...kept], trimmed: kept.length !== rest.length, estimatedTokens: used };
}

/* -------------------------------------------------------------- SSE plumbing */

function openStream(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();
  let closed = false;
  return {
    send(event, data) {
      if (closed) return;
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    },
    end() {
      if (closed) return;
      closed = true;
      res.end();
    },
  };
}

/** Read an OpenAI-style SSE body and forward normalised deltas to the client. */
async function pipeCompletion(providerRes, stream, meta, provider) {
  const reader = providerRes.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  let usage = null;
  let finish = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let nl;
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line || line.startsWith(':')) continue;
      if (!line.startsWith('data:')) continue;

      const payload = line.slice(5).trim();
      if (payload === '[DONE]') continue;

      let json;
      try {
        json = JSON.parse(payload);
      } catch {
        continue;
      }

      if (json.error) {
        stream.send('error', { message: json.error.message || 'Provider error', code: json.error.code });
        continue;
      }

      if (provider === 'gemini') {
        const cand = json.candidates?.[0];
        // A part can carry only a thoughtSignature with empty text - skip those.
        for (const part of cand?.content?.parts || []) {
          if (typeof part.text === 'string' && part.text) {
            text += part.text;
            stream.send('delta', { text: part.text });
          }
        }
        if (cand?.finishReason) finish = cand.finishReason;
        if (json.usageMetadata) usage = json.usageMetadata;
        if (json.modelVersion && !meta.resolvedModel) meta.resolvedModel = json.modelVersion;
        continue;
      }

      const choice = json.choices?.[0];
      const delta = choice?.delta || {};
      if (typeof delta.content === 'string' && delta.content) {
        text += delta.content;
        stream.send('delta', { text: delta.content });
      }
      if (typeof delta.reasoning === 'string' && delta.reasoning) {
        stream.send('reasoning', { text: delta.reasoning });
      }
      if (choice?.finish_reason) finish = choice.finish_reason;
      if (json.usage) usage = json.usage;
      if (json.model && !meta.resolvedModel) meta.resolvedModel = json.model;
    }
  }

  return { text, usage, finish };
}

/* ------------------------------------------------------------------ routes */

app.get('/api/config', (_req, res) => res.json(config.publicConfig()));

app.get('/api/status', async (_req, res) => {
  const [local, keyCheck, geminiCheck] = await Promise.all([
    ollama.status(),
    config.openrouterKey ? openrouter.testKey() : Promise.resolve({ ok: false, error: 'No API key configured.' }),
    config.geminiKey ? gemini.testKey() : Promise.resolve({ ok: false, error: 'No Gemini API key configured.' }),
  ]);
  res.json({
    ollama: local,
    openrouter: { configured: Boolean(config.openrouterKey), ...keyCheck },
    gemini: { configured: Boolean(config.geminiKey), ...geminiCheck },
    freeOnly: config.freeOnly,
  });
});

app.get('/api/models', async (req, res) => {
  const want = req.query.provider || 'all';
  const force = req.query.refresh === '1';
  const out = { ollama: [], openrouter: [], gemini: [], errors: {} };
  if (want === 'all' || want === 'gemini') {
    if (config.geminiKey) out.gemini = gemini.listModels();
    else out.errors.gemini = 'No Gemini API key configured';
  }

  const jobs = [];
  if (want === 'all' || want === 'ollama') {
    jobs.push(
      ollama
        .listModels()
        .then((m) => { out.ollama = m; })
        .catch(() => { out.errors.ollama = 'Local AI offline'; })
    );
  }
  if (want === 'all' || want === 'openrouter') {
    jobs.push(
      openrouter
        .listModels({ force })
        .then((m) => { out.openrouter = m; })
        .catch((e) => { out.errors.openrouter = e.message || 'Could not reach OpenRouter'; })
    );
  }
  await Promise.all(jobs);
  res.json(out);
});

app.post('/api/openrouter/test', async (req, res) => {
  // A key may be posted for a one-off check, but it is never persisted here.
  const result = await openrouter.testKey(req.body?.key);
  res.json(result);
});

/* -------------------------------------------------------------------- chat */

app.post('/api/chat', async (req, res) => {
  const body = req.body || {};
  const messages = sanitizeMessages(body.messages);
  if (!messages.length) return res.status(400).json({ error: 'No messages provided.' });

  const wantsVision = hasImages(messages);
  const requestedProvider = ['ollama', 'openrouter', 'gemini', 'auto'].includes(body.provider) ? body.provider : 'auto';
  const freeOnly = body.freeOnly === undefined ? config.freeOnly : Boolean(body.freeOnly);
  const allowPaid = Boolean(body.allowPaid) && !freeOnly;
  const temperature = body.temperature === undefined ? undefined : clamp(Number(body.temperature) || 0, 0, 2);
  const maxTokens = body.maxTokens ? clamp(Number(body.maxTokens), 16, 32000) : undefined;

  let provider = requestedProvider;
  let model = typeof body.model === 'string' && body.model !== 'auto' ? body.model : null;
  let modelInfo = null;
  let routeNote = null;

  try {
    /* ---- resolve provider + model ------------------------------------- */
    const localStatus = await ollama.status();

    if (provider === 'auto') {
      let localModels = [];
      if (localStatus.online) {
        localModels = await ollama.listModels().catch(() => []);
      }
      const localPick = wantsVision
        ? localModels.find((m) => m.vision)
        : localModels.find((m) => m.id === model) || localModels[0];

      if (localPick) {
        provider = 'ollama';
        model = localPick.id;
        modelInfo = localPick;
        routeNote = wantsVision ? 'Auto → local vision model' : 'Auto → local model';
      } else if (config.geminiKey) {
        provider = 'gemini';
        model = null;
        routeNote = localStatus.online
          ? wantsVision ? 'Auto → Gemini (no local vision model)' : 'Auto → Gemini (no local models)'
          : 'Auto → Gemini (local AI offline)';
      } else {
        provider = 'openrouter';
        model = null;
        routeNote = localStatus.online
          ? wantsVision
            ? 'Auto → cloud (no local vision model installed)'
            : 'Auto → cloud (no local models installed)'
          : 'Auto → cloud (local AI offline)';
      }
    }

    if (provider === 'ollama') {
      if (!localStatus.online) {
        return res.status(503).json({
          error: 'Local AI offline',
          detail: ollama.explainError({}),
          code: 'OLLAMA_OFFLINE',
        });
      }
      const localModels = await ollama.listModels().catch(() => []);
      if (!localModels.length) {
        return res.status(400).json({
          error: 'No local models found.',
          detail: 'Install a model with Ollama, then click Refresh.\n\nExample:  ollama pull qwen2.5:0.5b',
          code: 'NO_LOCAL_MODELS',
        });
      }
      modelInfo = localModels.find((m) => m.id === model) || null;
      if (!modelInfo) {
        modelInfo = wantsVision ? localModels.find((m) => m.vision) || localModels[0] : localModels[0];
        model = modelInfo.id;
      }
      if (wantsVision && !modelInfo.vision) {
        return res.status(400).json({
          error: "Selected model doesn't support image understanding. Choose a vision model.",
          code: 'MODEL_NO_VISION',
          model,
        });
      }
    }

    if (provider === 'openrouter') {
      if (!config.openrouterKey) {
        return res.status(400).json({
          error: 'No OpenRouter API key configured.',
          detail: 'Add OPENROUTER_API_KEY to your .env file, then restart DonetClassroom.',
          code: 'NO_API_KEY',
        });
      }

      const catalogue = await openrouter.listModels().catch(() => []);
      if (!model) {
        // Prefer a currently-free model; prefer a free vision model for images.
        const freeModels = catalogue.filter((m) => m.free && !m.router);
        const pick = wantsVision ? freeModels.find((m) => m.vision) : freeModels[0];
        model = pick ? pick.id : openrouter.FREE_ROUTER_ID;
      }
      modelInfo = catalogue.find((m) => m.id === model) || null;

      /* ---- zero-cost protection --------------------------------------- */
      if (freeOnly) {
        if (!modelInfo) {
          return res.status(400).json({
            error: 'Unknown model — refusing to send it while Free-only mode is on.',
            detail: `"${model}" is not in OpenRouter's live catalogue, so its price cannot be verified.`,
            code: 'MODEL_UNVERIFIED',
          });
        }
        if (!modelInfo.free) {
          return res.status(402).json({
            error: 'That model is not free right now — request blocked.',
            detail:
              `"${model}" currently charges ${modelInfo.pricing.prompt}/token in and ` +
              `${modelInfo.pricing.completion}/token out.\n\nPick a free model, or turn off ` +
              '"Only use free models" in Settings if you really want to pay for it.',
            code: 'PAID_MODEL_BLOCKED',
          });
        }
      } else if (modelInfo && !modelInfo.free && !allowPaid) {
        return res.status(402).json({
          error: 'Paid model requires explicit confirmation.',
          detail: 'Enable "Allow paid models" in Settings and confirm the prompt.',
          code: 'PAID_NEEDS_CONFIRM',
        });
      }

      if (wantsVision && modelInfo && !modelInfo.vision && !modelInfo.router) {
        return res.status(400).json({
          error: "Selected model doesn't support image understanding. Choose a vision model.",
          code: 'MODEL_NO_VISION',
          model,
        });
      }
    }

    if (provider === 'gemini') {
      if (!config.geminiKey) {
        return res.status(400).json({
          error: 'No Gemini API key configured.',
          detail: 'Add GEMINI_API_KEY to your .env file, then restart DonetClassroom.',
          code: 'NO_API_KEY',
        });
      }
      const list = gemini.listModels();
      modelInfo = list.find((m) => m.id === model) || list.find((m) => m.id === gemini.DEFAULT_MODEL);
      model = modelInfo.id;
    }

    /* ---- context management ------------------------------------------- */
    const contextLimit =
      body.contextLimit && body.contextLimit !== 'auto'
        ? clamp(Number(body.contextLimit), 1024, 200000)
        : modelInfo?.context || 8192;

    const trimmed = trimContext(messages, { contextLimit, reserve: maxTokens || 1024 });

    /* ---- call the provider -------------------------------------------- */
    const controller = new AbortController();
    req.on('close', () => controller.abort());

    const call = provider === 'ollama' ? ollama.chat : provider === 'gemini' ? gemini.chat : openrouter.chat;
    const providerRes = await call({
      model,
      messages: trimmed.messages,
      temperature,
      maxTokens,
      stream: true,
      signal: controller.signal,
    });

    if (!providerRes.ok) {
      let detail = '';
      try {
        const errBody = await providerRes.json();
        detail = errBody.error?.message || errBody.error || '';
      } catch {
        detail = await providerRes.text().catch(() => '');
      }
      const friendly =
        provider === 'ollama'
          ? `The local model "${model}" could not run.\n\n${detail || 'Ollama returned ' + providerRes.status}`
          : provider === 'gemini'
            ? gemini.explainError(providerRes.status)
            : openrouter.explainError(providerRes.status);
      return res.status(providerRes.status === 401 ? 401 : 502).json({
        error: provider === 'ollama' ? 'Local model error' : provider === 'gemini' ? 'Gemini request failed' : 'OpenRouter request failed',
        detail: `${friendly}${detail && provider !== 'ollama' ? `\n\nProvider said: ${detail}` : ''}`,
        code: 'PROVIDER_ERROR',
      });
    }

    /* ---- stream it back ------------------------------------------------ */
    const stream = openStream(res);
    const meta = { resolvedModel: null };
    stream.send('meta', {
      provider,
      model,
      vision: Boolean(modelInfo?.vision),
      free: provider === 'ollama' ? true : Boolean(modelInfo?.free),
      context: contextLimit,
      trimmed: trimmed.trimmed,
      estimatedPromptTokens: trimmed.estimatedTokens,
      note: routeNote,
    });

    try {
      const result = await pipeCompletion(providerRes, stream, meta, provider);
      stream.send('done', {
        provider,
        model: meta.resolvedModel || model,
        usage: result.usage,
        finishReason: result.finish,
        chars: result.text.length,
      });
    } catch (err) {
      if (err.name !== 'AbortError') {
        stream.send('error', { message: 'The response stream ended unexpectedly.' });
      }
    }
    stream.end();
  } catch (err) {
    if (err.code === 'NO_API_KEY') {
      const name = provider === 'gemini' ? 'Gemini' : 'OpenRouter';
      return res.status(400).json({ error: `No ${name} API key configured.`, code: 'NO_API_KEY' });
    }
    if (res.headersSent) return res.end();
    const isLocal = provider === 'ollama';
    res.status(502).json({
      error: isLocal ? "Couldn't connect to Ollama." : 'Request failed.',
      detail: isLocal ? ollama.explainError(err) : err.message || 'Unknown error',
      code: 'REQUEST_FAILED',
    });
  }
});

/* ------------------------------------------------------------------ chats */

async function readChat(id) {
  const raw = await fsp.readFile(chatPath(id), 'utf8');
  return JSON.parse(raw);
}

app.get('/api/chats', async (_req, res) => {
  try {
    const files = (await fsp.readdir(config.chatsDir)).filter((f) => f.endsWith('.json'));
    const chats = [];
    for (const file of files) {
      try {
        const chat = JSON.parse(await fsp.readFile(path.join(config.chatsDir, file), 'utf8'));
        chats.push({
          id: chat.id,
          title: chat.title || 'New chat',
          createdAt: chat.createdAt || 0,
          updatedAt: chat.updatedAt || 0,
          messageCount: (chat.messages || []).length,
          preview: (chat.messages || []).find((m) => m.role === 'user')?.text?.slice(0, 120) || '',
        });
      } catch {
        /* skip unreadable file */
      }
    }
    chats.sort((a, b) => b.updatedAt - a.updatedAt);
    res.json({ chats });
  } catch (err) {
    res.status(500).json({ error: 'Could not read chat history.', detail: err.message });
  }
});

app.get('/api/chats/:id', async (req, res) => {
  try {
    res.json(await readChat(req.params.id));
  } catch (err) {
    res.status(err.status || 404).json({ error: 'Chat not found.' });
  }
});

app.put('/api/chats/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const body = req.body || {};
    const chat = {
      id,
      title: String(body.title || 'New chat').slice(0, 200),
      createdAt: Number(body.createdAt) || Date.now(),
      updatedAt: Date.now(),
      messages: Array.isArray(body.messages) ? body.messages : [],
    };
    await fsp.writeFile(chatPath(id), JSON.stringify(chat, null, 2), 'utf8');
    res.json({ ok: true, updatedAt: chat.updatedAt });
  } catch (err) {
    res.status(err.status || 500).json({ error: 'Could not save chat.', detail: err.message });
  }
});

app.delete('/api/chats/:id', async (req, res) => {
  try {
    await fsp.unlink(chatPath(req.params.id));
    res.json({ ok: true });
  } catch (err) {
    if (err.code === 'ENOENT') return res.json({ ok: true });
    res.status(err.status || 500).json({ error: 'Could not delete chat.' });
  }
});

app.delete('/api/chats', async (_req, res) => {
  try {
    const files = (await fsp.readdir(config.chatsDir)).filter((f) => f.endsWith('.json'));
    await Promise.all(files.map((f) => fsp.unlink(path.join(config.chatsDir, f)).catch(() => {})));
    res.json({ ok: true, deleted: files.length });
  } catch (err) {
    res.status(500).json({ error: 'Could not clear chats.', detail: err.message });
  }
});

app.post('/api/chats/import', async (req, res) => {
  const incoming = Array.isArray(req.body?.chats) ? req.body.chats : null;
  if (!incoming) return res.status(400).json({ error: 'Expected { chats: [...] }' });
  let imported = 0;
  for (const chat of incoming) {
    const id = ID_RE.test(String(chat?.id || '')) ? chat.id : `imp-${Math.random().toString(36).slice(2, 10)}`;
    try {
      await fsp.writeFile(
        chatPath(id),
        JSON.stringify(
          {
            id,
            title: String(chat.title || 'Imported chat').slice(0, 200),
            createdAt: Number(chat.createdAt) || Date.now(),
            updatedAt: Number(chat.updatedAt) || Date.now(),
            messages: Array.isArray(chat.messages) ? chat.messages : [],
          },
          null,
          2
        ),
        'utf8'
      );
      imported++;
    } catch {
      /* skip bad entry */
    }
  }
  res.json({ ok: true, imported });
});

/* ----------------------------------------------------------------- static */

app.use(express.static(config.frontendDir, { extensions: ['html'], maxAge: '0' }));
app.use('/public', express.static(config.publicDir, { maxAge: '1h' }));

app.get('/{*splat}', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Unknown endpoint' });
  res.sendFile(path.join(config.frontendDir, 'index.html'));
});

/* ------------------------------------------------------------------ start */

if (require.main === module) {
  const server = app.listen(config.port, config.host, async () => {
    const url = `http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.port}`;
    const local = await ollama.status();
    console.log('');
    console.log('  ▍DonetClassroom');
    console.log(`   ${url}`);
    console.log(`   local AI   ${local.online ? `● online (${local.modelCount} model${local.modelCount === 1 ? '' : 's'})` : '○ offline — start Ollama with: ollama serve'}`);
    console.log(`   gemini     ${config.geminiKey ? '● Gemini key loaded' : '○ no Gemini key'}`);
    console.log(`   openrouter ${config.openrouterKey ? '● OpenRouter key loaded' : '○ no OpenRouter key'}`);
    console.log(`   free-only  ${config.freeOnly ? 'ON — paid models are blocked' : 'OFF — paid models need confirmation'}`);
    console.log('');
  });
  server.headersTimeout = 0;
  server.requestTimeout = 0;
  process.on('SIGINT', () => { server.close(); process.exit(0); });
}

module.exports = app;
