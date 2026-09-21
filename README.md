# VER-DÉ 2.0 — The AI Cinema Engine

A small, dependency-free interactive prototype: describe what you want to watch in natural language and VER-DÉ returns up to three fitting works from the current 17-item VER-DÉ catalog.

## Run locally

No installation is required. From `E:\VERDE-2`, start any simple static web server. For example, if Python is installed:

```powershell
python -m http.server 8080
```

Then visit [http://localhost:8080](http://localhost:8080).

Alternatively, open `index.html` directly in a modern browser.

## What is included

- A structured 17-item VER-DÉ production catalog in `catalog.js`; metadata not present in the supplied production source remains empty
- Conversational prompt UI with example prompts
- Lightweight keyword and runtime-aware matching in `app.js`
- Up to three recommendations, each with concise fit reasoning
- Free-film playback in the existing YouTube no-cookie style; Founding Access recommendations link to the existing production offer

## Deliberate scope

This is a front-end demonstration only. It has no accounts, payments, analytics, database, external film sources, playback integration, or production recommendation infrastructure.
