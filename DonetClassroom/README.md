# DonetClassroom

A fast, lightweight, OLED-black AI assistant that runs on **your Mac** with local Ollama models and free cloud models from Google Gemini and OpenRouter.

## What's new in 2.0

- **Google Gemini everywhere.** Gemini now works in the full (server) version too, not only the one-file build. Set `GEMINI_API_KEY` in `.env`.
- **Smarter Auto mode.** Local Ollama first, then Gemini, then OpenRouter.
- **Safer keys.** The Gemini key travels in a request header, never in the URL, and is only kept in the browser when "Remember API key" is on.
- **One source of truth.** The one-file build is generated from `frontend/` again, so the two versions can't drift apart.
- **Express 5**, zero known vulnerabilities.

**$0 by default.** Local when it can be. Free when it can't.

## Two versions

### Full Version (`DonetClassroom/`)
A Node.js + Express server. Run it on your Mac, access from any browser on your network.

**Best for:**
- Keeping API keys on a server (not in browser storage)
- Multiple users on the same machine
- More control over model selection and settings
- Production or shared deployments

### One-File Version (`DonetClassroom-OneFile/`)
A single HTML file. Open it in a browser. No installation, no build, no server.

**Best for:**
- Quick start
- Privacy (everything stays in your browser)
- Sharing with others (one file to copy)
- Running without Node.js

---

## Quick Start

### Full Version

```bash
cd DonetClassroom
npm install
npm start
```

Opens at `http://localhost:5173`.

To start with a single command on macOS:

```bash
cd DonetClassroom
./start.sh
```

### One-File Version

1. **Double-click** `DonetClassroom-OneFile/DonetClassroom.html`
2. If the browser blocks certain features (screen capture, Ollama access), use the tiny server:
   ```bash
   cd DonetClassroom-OneFile
   ./serve.command
   ```
   Then open `http://localhost:8777/DonetClassroom.html`.

---

## Using Local AI (Free, Private, Offline)

### 1. Install Ollama

macOS:
```bash
brew install ollama
```

Or download from [ollama.com/download](https://ollama.com/download).

### 2. Start Ollama

```bash
ollama serve
```

Runs on `http://localhost:11434` by default.

### 3. Install a Model

For older hardware (e.g., 2014 Mac mini):

```bash
ollama pull qwen2.5:0.5b    # ~400 MB, instant replies
```

For better reasoning:

```bash
ollama pull llama3.2:3b      # ~2 GB, needs 8 GB RAM
```

For image understanding:

```bash
ollama pull moondream        # ~1.7 GB, smallest vision model
```

Full list in Settings → Local AI → Recommended local models.

### 4. If Ollama is Still Unreachable

Ollama may refuse requests from browsers that appear to come from a "null" origin (file:// pages, or certain network setups). Restart it with:

```bash
OLLAMA_ORIGINS="*" ollama serve
```

---

## Using Free Cloud AI

### Google Gemini (recommended)

1. Create a free key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey).
2. **Full version:** add `GEMINI_API_KEY=...` to `.env` and restart.
   **One-file version:** Settings → Cloud → Google Gemini → paste the key.

### OpenRouter

### 1. Create an OpenRouter API Key

Visit [openrouter.ai/keys](https://openrouter.ai/keys) (free account, takes 1 minute).

### 2. Add the Key

**Full Version:**
- Copy the key to your `.env` file:
  ```
  OPENROUTER_API_KEY=sk-or-v1-...
  ```
- Restart the server.

**One-File Version:**
- Settings → Cloud → paste your key.
- Optionally check "Remember API key" (stores in localStorage for this browser only).

### 3. That's It

DonetClassroom automatically discovers currently free models and filters them in the model picker. Free-model availability can change; prices are checked before every request.

---

## Architecture

### Backend (Full Version Only)

**`backend/server.js`** — Express server.

- **`/api/config`** — Public config (ollama endpoint, recommended models).
- **`/api/status`** — Provider health (is Ollama running? is the API key valid?).
- **`/api/models`** — Live model discovery from Ollama and OpenRouter.
- **`/api/chat`** — Streaming chat completions (OpenAI-compatible format).
- **`/api/chats/*`** — Chat persistence (CRUD operations on `data/chats/*.json`).

**`backend/providers/ollama.js`** — Ollama adapter.
- Detects model capabilities (vision, context size).
- Talks to Ollama's OpenAI-compatible endpoint.
- Handles errors gracefully.

**`backend/providers/gemini.js`** — Google Gemini adapter.
- Converts chat messages (including images) to Gemini's format.
- Streams replies and sends the key as a header, never in the URL.

**`backend/providers/openrouter.js`** — OpenRouter adapter.
- Checks live pricing; blocks non-free models when `FREE_ONLY=true`.
- Discovers available models and their features.
- Never hard-codes model lists.

### Frontend

**`frontend/index.html`** — Semantic HTML shell.

**`frontend/styles.css`** — OLED-black design system.
- Pure `#000` background, subtle surfaces.
- Responsive (mobile, tablet, desktop).
- Reduced-motion support.

**`frontend/app.js`** — Vanilla JavaScript (~3100 lines).
- Chat UI (messages, streaming, regenerate, stop).
- Image handling (upload, resize, screenshot).
- Settings, shortcuts, prompt library.
- Markdown rendering with XSS protection.
- Local storage for chats and settings.
- Server-mode and standalone-mode logic.

### Standalone Mode

The one-file version sets `window.DONET_STANDALONE = true`, which:
- Makes the app talk directly to Ollama and OpenRouter (instead of via a server).
- Stores chats in browser `localStorage` (instead of server files).
- Keeps the API key in `localStorage` only if the user opts in.

---

## Configuration

### Full Version (.env)

```bash
# Server
PORT=5173
HOST=127.0.0.1

# Local AI
OLLAMA_URL=http://localhost:11434

# Cloud AI (optional)
GEMINI_API_KEY=...
OPENROUTER_API_KEY=sk-or-v1-...

# Zero-cost protection (default: true)
FREE_ONLY=true

# Timeouts (milliseconds)
REQUEST_TIMEOUT_MS=120000
```

Copy `.env.example` to `.env` and edit. The server never leaks the API key to the frontend.

### One-File Version

No `.env` file. Settings are accessed through the UI:
- Settings → Local AI → Ollama endpoint URL.
- Settings → Cloud → OpenRouter API key (optional, stored in `localStorage`).

---

## Features

### Core
- ✅ Streaming responses (token by token).
- ✅ Markdown rendering (headings, lists, tables, code blocks, links).
- ✅ Code block syntax highlighting.
- ✅ Image upload (PNG, JPG, WEBP, GIF).
- ✅ Image auto-resize (configurable quality: auto, high, balanced, low).
- ✅ Screenshot capture (via browser's screen capture API).
- ✅ Vision model detection and guarding.
- ✅ Stop generation mid-stream.
- ✅ Regenerate responses.
- ✅ Edit and resend messages.
- ✅ Rate responses (👍 👎 — local only, never sent anywhere).

### Chat Management
- ✅ Chat history (sidebar with date grouping).
- ✅ Search chats (Cmd/Ctrl+K).
- ✅ Auto-generated titles from first message.
- ✅ Rename, duplicate, delete chats.
- ✅ Export to JSON, Markdown, plain text.
- ✅ Import chats from JSON.

### Settings
- ✅ Provider selection (Auto, Local, Cloud).
- ✅ Model picker with live filtering (free, vision, reasoning, fast).
- ✅ Temperature, max tokens, streaming, context length.
- ✅ System prompt customization.
- ✅ "Only use free models" protection (default: ON).
- ✅ "Allow paid models" confirmation (default: OFF).
- ✅ Theme selection (OLED Black, Pure Black, Dim Black).
- ✅ Keyboard shortcuts and documentation.

### Shortcuts
- ✅ Up to 4 quick links (editable, draggable, with favicons).
- ✅ Mark links as "AI reference" (mentioned to the model).
- ✅ Enable/disable individual shortcuts.

### Prompt Library
- ✅ Predefined prompts (Explain Like I'm 10, Fix My Code, Summarize, etc.).
- ✅ Save custom prompts.
- ✅ Insert prompt + user text with one click.

### Keyboard Shortcuts
- `Cmd/Ctrl+K` — Search chats.
- `Cmd/Ctrl+N` — New chat.
- `Cmd/Ctrl+/` — Focus composer.
- `Cmd/Ctrl+B` — Toggle sidebar (desktop) / menu (mobile).
- `Cmd/Ctrl+Shift+S` — Take screenshot.
- `Cmd/Ctrl+Shift+U` — Upload image.
- `Escape` — Stop generation / close modals.
- `Enter` — Send (when "Enter to send" is enabled).
- `Shift+Enter` — New line (when "Enter to send" is enabled).

### Zero-Cost Protection
- ✅ "Only use free models" blocks any model with non-zero pricing.
- ✅ Prices checked live from OpenRouter before every request.
- ✅ Unknown/unverifiable models rejected when `FREE_ONLY=true`.
- ✅ Paid models require explicit "Allow paid models" toggle + confirmation.
- ✅ API key never exposed to the client (full version only).
- ✅ User never silently charged.

### Accessibility
- ✅ Keyboard navigation throughout.
- ✅ ARIA labels and roles.
- ✅ High contrast text.
- ✅ Reduced motion support.
- ✅ Screen reader friendly.

---

## Known Limitations

### One-File Version
- **Ollama CORS:** File:// pages may not reach Ollama. Solution: use `OLLAMA_ORIGINS="*" ollama serve` or the included tiny server.
- **Screen capture:** May be blocked on file:// pages in some browsers. Solution: serve over HTTP.
- **API key in browser:** Kept in `localStorage` only if the user opts in. For production/shared setups, use the full version.
- **Storage quota:** Limited by browser storage (usually 5–10 MB). Chats with many images may fill it up. Solution: export and clear.

### Full Version
- **No web search:** The UI has a disabled web search button. Web search can be added by connecting a real search provider.
- **No streaming for some providers:** Only works with providers that support OpenAI-compatible streaming (Ollama and OpenRouter do).

### General
- **Model availability:** Free models on OpenRouter can appear/disappear or change pricing at any time.
- **Rate limits:** OpenRouter's free tier has shared rate limits; if many users hit it, requests may be rate-limited.
- **Local model download:** DonetClassroom never auto-downloads models. Users must manually install them with Ollama.

---

## Architecture Decisions

### Why Vanilla JavaScript?
- No build step needed (one-file version works immediately).
- Tiny bundle (~191 KB for the entire app, including HTML, CSS, JS).
- Fast startup on older hardware.
- No dependency tree to maintain.

### Why Ollama + OpenRouter?
- **Ollama:** Free, runs locally, fully private, no rate limits or bills.
- **OpenRouter:** Aggregates many free models, simple API, transparent pricing.
- Together they cover both offline and online use cases.

### Why Streaming?
- Better UX — users see text appear in real time.
- Lower perceived latency even on slow responses.
- Easier to stop if the user gets what they need early.

### Why OLED Black?
- Reduces power consumption on OLED/AMOLED screens.
- Easier on the eyes in dark environments.
- Fits the "private, minimal" aesthetic.

---

## Tested Features

### Chat & Streaming
- ✅ Send text messages.
- ✅ Receive streaming responses from Ollama.
- ✅ Stop generation mid-stream.
- ✅ Regenerate (drop last turn, re-run).
- ✅ Edit and resend messages.
- ✅ Persist chats and reload them.
- ✅ Auto-generate titles from first message.

### Images
- ✅ Upload PNG, JPG, WEBP, GIF.
- ✅ Auto-resize large images (3000×2000 → 1280×853 JPEG, 132 KB → 11 KB).
- ✅ Vision guard blocks image sends to text-only models.
- ✅ Drag-and-drop support.
- ✅ Paste from clipboard.
- ✅ Screenshot capture (when available).

### Model Selection
- ✅ Live model discovery from Ollama and OpenRouter.
- ✅ Filtering (free, vision, reasoning, fast).
- ✅ Pricing checks before every request.
- ✅ Auto-routing (prefers local, falls back to cloud).

### Zero-Cost Protection
- ✅ Blocks paid models before they leave the machine.
- ✅ Rejects unverifiable models.
- ✅ Never silently incurs charges.
- ✅ API key never sent to untrusted clients.

### Security & Safety
- ✅ XSS protection (all user input escaped).
- ✅ No `eval()` or `Function()` execution.
- ✅ JavaScript URLs rejected.
- ✅ Path traversal blocked on chat IDs.
- ✅ Image data URLs validated (only image/* types).

### Mobile
- ✅ Responsive layout (mobile, tablet, desktop).
- ✅ Shortcuts button in composer on small screens.
- ✅ Touch-friendly buttons and spacing.
- ✅ Safe area support (notch, home bar).

---

## Development

### Run the Full Version Locally

```bash
cd DonetClassroom
npm install
npm start
```

Then edit `frontend/app.js` or `frontend/styles.css` and reload in the browser.

### Build the One-File Version

```bash
cd DonetClassroom
node tools/build-onefile.js
```

This inlines HTML, CSS, and JS into a single file and outputs it to `../DonetClassroom-OneFile/DonetClassroom.html`.

### File Structure

```
DonetClassroom/
├── frontend/
│   ├── index.html          # HTML shell
│   ├── styles.css          # OLED-black design
│   └── app.js              # Main application (~3100 lines)
├── backend/
│   ├── server.js           # Express server
│   ├── config.js           # Environment and defaults
│   └── providers/
│       ├── gemini.js       # Google Gemini adapter
│       ├── ollama.js       # Local model adapter
│       └── openrouter.js   # Cloud model adapter
├── data/
│   └── chats/              # Persistent chat storage (JSON files)
├── public/
│   └── icon.svg            # App icon
├── package.json            # Node dependencies
├── .env.example            # Environment template
├── .gitignore
├── start.sh                # macOS launcher
├── README.md               # This file
└── tools/
    └── build-onefile.js    # Builds the one-file version

DonetClassroom-OneFile/
├── DonetClassroom.html     # Self-contained app (~191 KB)
├── serve.command           # Tiny Python HTTP server (macOS)
└── README.txt              # Quick start
```

---

## License

MIT. Use, modify, and share freely.

---

## Support

Found a bug? Have an idea? DonetClassroom is designed to be simple and easy to modify. Edit the source code, add features, and share improvements.

For questions or tips:
- Check the in-app settings and keyboard shortcuts (they're documented there).
- Read the code — it's meant to be understandable.
- Experiment with different models and settings.

---

**DonetClassroom: Private by default. Local when it can be. Free when it can't.**
