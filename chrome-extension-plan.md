# Plan: Chrome Extension Recorder for Browser-Auto-Test

## Objective
Build a Chrome Extension (Manifest V3) that records user actions (clicks, inputs, navigations) and exports them as a JSON file compatible with the `TestSuite` format used in the core engine.

## Project Structure
```text
chrome-extension/
├── manifest.json         # Extension manifest (MV3)
├── background.js         # Service worker for state management
├── content.js            # Page injection for event capturing
├── popup.html            # UI to Start/Stop and view steps
├── popup.js              # Logic for popup interactions
└── styles.css            # Styling for the popup
```

## Functional Requirements

### 1. Event Capture (content.js)
- Listen for `click`, `input`, `change`, and `keydown` (Enter/Tab/Esc) events.
- Reuse logic from `src/inject.ts` to extract locators.
- Priority: `data-testid` > `aria-label` > `name` > `id` > `placeholder` > `role` > `text` > `CSS Selector`.
- Send messages to `background.js` with step details.

### 2. State Management (background.js)
- Maintain an array of `steps` and a `recording` boolean.
- Use `chrome.storage.local` to persist steps across page reloads.
- Handle navigation: Record `navigate` steps when `chrome.tabs.onUpdated` fires or via `beforeunload` signals.

### 3. User Interface (popup.html/js)
- Buttons: **Start Recording**, **Stop Recording**, **Clear**, **Download JSON**.
- Display a real-time list of recorded steps.
- Show "Recording..." status.

### 4. Data Export
- Generate a JSON object matching this schema:
  ```json
  {
    "name": "recorded flow",
    "baseUrl": "https://initial-url.com",
    "steps": [
      { "id": "uuid", "type": "navigate", "url": "..." },
      { "id": "uuid", "type": "click", "locator": { "strategy": "css", "value": "..." } }
    ],
    "createdAt": "ISO-TIMESTAMP"
  }
  ```

## Implementation Workflow (for AI Implementation)

### Step 1: manifest.json
- Permissions: `storage`, `activeTab`, `scripting`, `tabs`.
- Define `action` (popup) and `content_scripts`.

### Step 2: Content Script Injection
- In `content.js`, implement the `attach` logic.
- Use `chrome.runtime.sendMessage` to send events to the background.

### Step 3: Background Service Worker
- Handle `chrome.runtime.onMessage`.
- Implement navigation tracking using `chrome.webNavigation.onCompleted` if needed.

### Step 4: Popup Logic
- Connect to background state.
- Implement the "Download JSON" using a Blob and `chrome.downloads` or `URL.createObjectURL`.

## Technical Reference
- Use `Date.now()` + random suffix for `step.id`.
- Ensure `fill` steps collapse multiple inputs into a single final value.
