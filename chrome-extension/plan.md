# Plan: Chrome Extension Recorder

## Objective
Implement a Chrome Extension to record user actions and export them to `TestSuite` JSON.

## Task 1: manifest.json
- [ ] Set `manifest_version: 3`.
- [ ] Add `permissions`: `["storage", "activeTab", "scripting"]`.
- [ ] Define `content_scripts` to inject `content.js` on all URLs.

## Task 2: content.js
- [ ] Implement event listeners for `click`, `input`, `change`, `keydown`.
- [ ] Use a smart locator strategy (testid -> id -> name -> etc.).
- [ ] Send `step` objects to `background.js` using `chrome.runtime.sendMessage`.

## Task 3: background.js
- [ ] Maintain a persistent list of steps in `chrome.storage.local`.
- [ ] Handle recording toggle state.

## Task 4: popup.html / popup.js
- [ ] Provide "Start", "Stop", and "Export JSON" buttons.
- [ ] Format the recorded steps into the `TestSuite` schema for download.
