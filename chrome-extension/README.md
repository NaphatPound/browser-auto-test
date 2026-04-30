# Auto-Test Recorder — Chrome Extension

A browser-native version of the Electron Auto-Test Browser, built as a Chrome
Manifest V3 extension. Records interactions on **any** website (no iframe/CSP
restrictions like a web app would have), captures console/network errors during
testing, and exports a markdown bug report you can hand to a developer or AI.

## Install (developer mode)

1. Open Chrome and go to `chrome://extensions`.
2. Toggle **Developer mode** (top right).
3. Click **Load unpacked** and select the `chrome-extension/` folder of this repo.
4. The **Auto-Test Recorder** icon appears in the toolbar — pin it for easy access.

## Usage

1. Open the website you want to test in any tab.
2. Click the extension icon → popup opens.
3. **● Record** — start capturing clicks, fills, navigations, etc. on the active tab.
4. Interact normally with the page; every step appears in the popup.
5. **Comment Element** — toggles a sticky pick mode:
   - The popup closes and the page shows a blue banner: "🎯 Click an element to comment".
   - Click any element → an in-page modal asks for the bug description.
   - Type the comment, press **Enter** or click **Save** → comment saved.
   - Pick another element to comment, or press **Esc** to exit pick mode.
6. **■ Stop** — stops recording; the session is auto-archived.
7. **Preview Report** — see the generated `report.md` content before downloading.
8. **Export Report** — downloads `report-<timestamp>.md` with everything captured:
   - Annotated bugs (your comments + page URLs + locators)
   - Console / runtime / network errors observed during the test
   - Full step list as a markdown table

## Sessions

Click **Sessions** to manage saved recordings:
- Each Record→Stop is auto-archived as a session.
- Setting: **Start a new report each time I click Record** — toggles whether
  recordings accumulate or each is its own report.
- Per-session: **Load** (back into the popup), **Preview**, **Export .md**,
  **Rename**, **Delete**.
- **Export Combined .md** — all sessions in one file.

## What gets captured during recording

- **DOM events**: clicks (incl. checkbox/radio), form fills (text, textarea,
  contenteditable), select changes, Enter/Tab/Esc presses.
- **Navigation**: top-level URL changes (incl. SPA `history.pushState`).
- **Console**: `console.error` and `console.warn` from the page.
- **Network**: failed `fetch` and `XMLHttpRequest` (4xx, 5xx, network errors).
- **Runtime**: `window.error` events and `unhandledrejection` rejections.

The runtime probe is injected into the page via a content script and intercepts
`fetch` / `XMLHttpRequest` to report failures back to the recorder.

## Locator priority

Picks the first available, in this order, to keep selectors stable across
re-renders:

`data-testid` → `aria-label` → `name` → `id` → `placeholder` → `role` → text → CSS path

## Storage

All state lives in `chrome.storage.local`:
- `autoTestRecorderState` — current recording (steps, captured issues)
- `autoTestRecorderSessions` — saved sessions list
- `autoTestRecorderSettings` — preferences (e.g. new-report-per-recording)

State survives browser restarts; clear via the **Clear** button or via
`chrome://extensions` → Auto-Test Recorder → Inspect views → Application →
Storage.

## Limitations vs. the Electron version

- **No replay** — Chrome extensions can't synthesize trusted clicks the way
  Electron's `webview.sendInputEvent` can. Replay would need DevTools Protocol
  (Playwright/Puppeteer) on the backend.
- **No live DevTools panel inside the popup** — for full Console/Network UI,
  press **F12** in Chrome itself; this extension focuses on capturing the data
  for the report.

## Files

```
chrome-extension/
├── manifest.json       # MV3 manifest (storage, tabs, scripting, downloads, webNavigation)
├── background.js       # Service worker — owns state, sessions, message routing
├── content.js          # Page event capture + pick mode + runtime probe
├── popup.html          # Popup UI markup
├── popup.js            # Popup view + command dispatch
├── styles.css          # Popup + modal styles
├── report-utils.js     # Shared markdown report builder (popup + background)
└── README.md           # This file
```
