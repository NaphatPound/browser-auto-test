# Task 01: Flowchart & Step Documentation Feature

## Objective
Implement a new feature to save user action flows and generate visual documentation using a flowchart UI, including interactive editing capabilities.

## Ideas for Implementation

### 1. Mermaid.js Diagram Generation (Static Documentation)
- **Concept**: Convert `TestSuite` steps into Mermaid.js Markdown syntax for GitHub/VS Code documentation.
- **Example**: `A[Navigate: /] --> B[Click: #login]`.

### 2. Interactive Flowchart UI (Editing Flow)
- **Concept**: Use **React Flow** or **LiteGraph.js** to create a node-based editor.
- **Features**:
  - **Visual Insertion**: Click the "+" button on a connection line between two nodes to insert a new step (e.g., "Wait 10s" or "Custom Fill").
  - **Node Properties**: Click a node to open a sidebar/modal to edit text, locators, or wait times.
  - **Drag-and-Drop**: Reorder steps by dragging nodes.
- **Pros**: Intuitive way to manage complex test flows.

### 3. Step Editor Side-Panel
- **Concept**: A split-view in the Electron app with the flowchart on one side and a detailed form on the other.
- **Form Fields**:
  - `Action Type`: Dropdown (click, fill, wait, etc.).
  - `Locator`: Strategy + Value (editable).
  - `Value/Text`: For input fields or assertions.
  - `Delay/Timeout`: For wait steps.

## Proposed Strategy & Tasks

### Phase 1: Core Logic Enhancement (Flow Editing)
1.  **Extend `src/recorder.ts`**:
    - [ ] Implement `insertStep(index: number, step: Step)`: Allows adding actions between existing ones.
    - [ ] Implement `duplicateStep(id: string)`: Quick way to copy similar actions.
2.  **Create `src/flowchart.ts`**:
    - [ ] Implement `generateMermaid(suite: TestSuite): string`.
    - [ ] Implement `generateFlowNodes(suite: TestSuite)`: Convert steps to a format compatible with React Flow or similar.

### Phase 2: UI Implementation (Electron)
1.  **Flowchart View Component**:
    - [ ] Create a canvas using a node-editing library.
    - [ ] Add "+" buttons between nodes for quick insertion.
2.  **Step Editor Modal/Panel**:
    - [ ] Create a form to edit `Step` properties.
    - [ ] Add a "Test Step" button to run only that specific action in the browser for validation.

### Phase 3: Export & Documentation
1.  **Update `src/exporter.ts`**:
    - [ ] Add `exportToHTML(suite: TestSuite)`: Generates a standalone documentation file with a static flowchart.
2.  **CLI Command**:
    - [ ] Add `auto-test edit <file.json>`: Opens the Electron app specifically in editor mode for a saved suite.

## Implementation Details for "Editing Flow"
- **Insertion Logic**: When the user clicks "+" between Step 2 and Step 3, call `recorder.insertStep(2, newStep)`.
- **Wait Action**: Provide a simple preset for common tasks like `wait(10000)`.
- **Text Input**: Allow editing the `text` property of a `fill` or `press` step via a dedicated input field in the UI.

## Next Steps
- [ ] Prototype `insertStep` in `Recorder` class.
- [ ] Research a lightweight node-based UI library for Electron.
- [ ] Create a sample Mermaid diagram with edit-placeholders.
