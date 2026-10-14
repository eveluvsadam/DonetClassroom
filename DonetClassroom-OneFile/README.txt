DonetClassroom — one-file build
===============================

DonetClassroom.html is the entire application: interface, chat, settings,
provider and model selection, image upload, screenshots, shortcuts, keyboard
shortcuts, local storage and chat history. There is no build step and nothing
to install.

QUICK START
  Double-click DonetClassroom.html.

IF SOMETHING IS BLOCKED
  Browsers restrict certain features on file:// pages. In particular Ollama
  refuses requests coming from a "null" origin, and some browsers disable
  screen capture. If that happens, serve the file over http instead:

      ./serve.command              (double-click it in Finder)

  then open  http://localhost:8777/DonetClassroom.html

USING LOCAL AI (free, private, offline)
  1. Install Ollama       — brew install ollama   (or ollama.com/download)
  2. Start it             — ollama serve
  3. Install a model      — ollama pull qwen2.5:0.5b
  4. If the page still cannot reach it, allow this page's origin:
         OLLAMA_ORIGINS="*" ollama serve

USING FREE CLOUD AI
  1. Create a free key at https://openrouter.ai/keys
  2. Settings -> Cloud -> paste the key
  3. "Remember API key" is OFF by default. A key kept in a browser can be read
     by anyone with access to this browser or its storage — fine for personal
     use, not for anything public. For a shared or public setup, use the full
     version, which keeps the key on a server.

COST
  "Only use free models" is ON by default. Local models are always free, and
  cloud models are checked against OpenRouter's live pricing before every
  request. Free-model availability and rate limits are set by the provider and
  can change at any time.

WHERE YOUR DATA LIVES
  Chats, settings and shortcuts are stored in this browser only (localStorage).
  Clearing site data deletes them. Use Settings -> Data -> Export to keep a copy.
