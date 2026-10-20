# VER-DÉ 2.0 — AI Cinema for Fire TV

**Tell VER-DÉ what the moment calls for. It finds the independent film.**

VER-DÉ is an independent-film distribution platform from Nabua, Camarines Sur, Philippines. VER-DÉ 2.0 is its AI Cinema Engine: instead of browsing posters and genres, a viewer says how they feel — *"something hopeful," "about the land," "I don't know what to watch"* — and VER-DÉ interprets the intent, searches the catalog, and answers with up to three films and a one-line reason for each.

This repository contains the engine and its **Fire TV app**, built for the *Build, Ship, Shape: Amazon Developer Hackathon* (Fire TV track).

> Deep intelligence. Simple answers.

---

## What it does on a TV

1. **Who's watching?** Choose *Just me*, *With family*, or *With someone*.
2. **What does the moment call for?** Pick a mood with the remote — no typing, no menus.
3. **VER-DÉ understands.** The request is interpreted (concepts, moods, runtime, language) and shown back as tags, so the viewer sees what VER-DÉ heard.
4. **Three films, three reasons.** Each card says why it fits, grounded only in published catalog facts.
5. **Refine.** *Another one · Something shorter · Why this one? · Change the mood.*
6. **Watch.** Free films play full screen. Founding Access films show a QR code to unlock on a phone.
7. **The next night starts closer.** Each household's choices are remembered on the TV. VER-DÉ greets them with what they watched last, offers *"Something like it,"* and re-ranks recommendations toward what that household gravitates to, preferring films they haven't seen.

## How it works

```
Fire TV remote
   │  D-pad / OK / Back
   ▼
firetv/  — Fire OS app (Java, Android WebView)
   │  full-screen, Back-key bridge, autoplay, home-screen banner
   ▼
tv.html · tv.css · tv.js  — 10-foot interface
   │  spatial D-pad navigation, household memory (on-device),
   │  ranking, refinement, playback / Founding Access QR
   ▼
catalog.js  — 17 catalogued VER-DÉ works (structured metadata)
ai-client.js → /api/chat  — Vercel serverless function
   ▼
api/providers/gemini.js  — Gemini: intent understanding + grounded reasons
```

- **One engine, two surfaces.** The web experience (`index.html`, `app.js`) and the TV experience (`tv.html`, `tv.js`) share the same catalog, the same `/api/chat` endpoint, and the same intent vocabulary.
- **Grounded AI.** Gemini classifies intent and extracts structured fields (concepts, moods, minutes, language, format, access). Film selection is deterministic against the catalog; Gemini then writes reasons using only catalog fields. It is instructed never to invent runtimes, awards, or facts.
- **Keeps working offline from the AI.** If the AI layer is unreachable or slow (12-second limit), every path falls back to the keyword engine, so discovery still returns films.
- **The API key never leaves the server.** `GEMINI_API_KEY` is a Vercel environment variable; the app and the browser only call `/api/chat`.

## Repository layout

| Path | What it is |
|---|---|
| `tv.html`, `tv.css`, `tv.js` | Fire TV 10-foot interface |
| `firetv/` | Fire OS app (Android, Java) that hosts the TV interface |
| `.github/workflows/firetv-apk.yml` | Builds the APK on every push and publishes it to the `firetv-latest` release |
| `index.html`, `app.js`, `styles.css` | Web experience of the same engine |
| `catalog.js` | The VER-DÉ catalog |
| `ai-client.js` | Browser client for `/api/chat` |
| `api/chat.js`, `api/providers/gemini.js` | Serverless AI endpoint (Gemini) |
| `vendor/qrcode.js` | QR code generator (MIT, Kazuhiko Arase) |

## Install on Fire TV

1. On the Fire TV: **Settings → My Fire TV → About**, click the device name **7 times** to unlock Developer Options.
2. **Settings → My Fire TV → Developer Options**: turn on **ADB debugging** and **Apps from Unknown Sources**.
3. Note the device's IP address: **Settings → My Fire TV → About → Network**.
4. Download `verde-firetv.apk` from this repository's **Releases → firetv-latest**.
5. On a computer with Android platform-tools installed (and on the same Wi-Fi):

   ```sh
   adb connect <FIRE-TV-IP>:5555
   adb install -r verde-firetv.apk
   ```

   Accept the debugging prompt on the TV the first time.
6. Open **VER-DÉ** from **Your Apps & Channels** on the Fire TV home screen.

The app loads `https://engine.ver-de.com/tv.html`, so the Fire TV needs an internet connection.

## Build the app yourself

The APK is built automatically by GitHub Actions. To build locally you need JDK 17, the Android SDK (API 34), and Gradle 8.7:

```sh
gradle -p firetv assembleDebug
# → firetv/app/build/outputs/apk/debug/app-debug.apk
```

## Run the TV interface in a browser

Open **https://engine.ver-de.com/tv.html** and use the arrow keys, **Enter** (OK) and **Esc** (Back).

Locally, serve the folder with any static server:

```sh
python -m http.server 8080
# open http://localhost:8080/tv.html
```

A plain static server has no `/api/chat`, so local runs use the keyword fallback. For the full Gemini path, run `vercel dev` with `GEMINI_API_KEY` set. Add `?reset=1` to the URL to clear household memory.

## Deploy

The site is a static Vercel project with one serverless function. Set `GEMINI_API_KEY` in **Vercel → Project → Settings → Environment Variables**. Pushing to `main` deploys.

## Honest scope

- The catalog is the 17 published VER-DÉ works. Most have no published runtime yet, so runtime filters only consider films with a confirmed runtime.
- Household memory is stored on the device (`localStorage`) and is never uploaded. There are no accounts. Requests the viewer makes (and who is watching) are sent to `/api/chat` so Gemini can interpret them.
- Founding Access films are not played in the app. They show a QR code to the existing offer at ver-de.com.
- Voice input is not supported on TV in this version: the Fire TV remote's microphone belongs to Alexa. Discovery is designed around the D-pad instead.

## License

Code: MIT (see `LICENSE`). Films, music, artwork, synopses, and the VER-DÉ name and marks: © Ralph Anthony Sales, all rights reserved.

*A VER-DÉ Film · Music by Green Ralph · Directed by Ralph Anthony Sales · Nabua, Camarines Sur*
