# Task 03: Step Export & Chrome Extension Plan

## Objective
Implement a feature to export all recorded steps from the Electron app as a JSON file (`TestSuite` format) and create a comprehensive development plan (`extension-plan.md`) for building a Chrome Extension recorder that produces compatible data.

## Ideas for Implementation

### 1. Electron App: Export Button
- Add an "Export JSON" button to the sidebar.
- Use Electron's `showSaveDialog` (via IPC) to let the user pick a location for the `.json` file.
- Serialize `state.steps` into a `TestSuite` object.

### 2. Chrome Extension: "AI-Ready" Plan
- Define the Manifest V3 architecture.
- Re-use `src/inject.ts` logic for event capturing.
- Provide a clear workflow for the AI: Popup -> Content Script -> Background -> Download JSON.
- Ensure the output JSON structure matches the `TestSuite` type used in this project.

## Proposed Strategy & Tasks

### Phase 1: Electron Export Feature
1.  **UI Update (`app/index.html`)**:
    - [x] Add `<button id="btn-export-json">Export JSON</button>`.
2.  **Renderer Logic (`app/renderer.js`)**:
    - [x] Implement the export button click handler to download JSON directly.
    - [x] Serialize `state.steps` into a `TestSuite` object.

### Phase 2: Chrome Extension Planning
1.  **Create `chrome-extension/plan.md`**:
    - [x] Define the project structure.
    - [x] Detail the message-passing protocol.
    - [x] Specify the expected JSON output format.
    - [ ] Include snippets from `src/inject.ts` for reference.

## Implementation Details
- **Export Format**:
  ```json
  {
    "name": "recorded flow",
    "baseUrl": "...",
    "steps": [...],
    "createdAt": "..."
  }
  ```

## Next Steps
- [ ] Add the Export button to the Electron UI.
- [ ] Implement the `plan.md` (or `extension-plan.md`) for the AI.
