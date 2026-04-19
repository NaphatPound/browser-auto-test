# Task 02: AI-Friendly Bug Summary Export

## Objective
Implement a feature to export a consolidated bug report (`report.md`) after test execution. This report should be specifically formatted to provide an AI with enough context (error, code, steps) to autonomously fix the bugs.

## Ideas for Implementation

### 1. "AI-Ready" Markdown Format
- **Summary Section**: High-level count of passed/failed tests.
- **Detailed Bug Entries**: For each failure:
    - **Context**: File name, Spec title.
    - **Failure Point**: The exact step (index and description) that failed.
    - **Error**: The raw error message/stack trace from the test runner.
    - **Code Snippet**: The specific block of generated test code that corresponds to the failure.
    - **Suite Data**: A snippet of the original JSON `Step` definition.

### 2. CLI Integration
- **`auto-test run ... --export-bugs report.md`**: Automatically generates the report if failures occur.
- **`auto-test report ... --export-bugs report.md`**: Allows generating the report from an existing JSON result.

### 3. Consolidation Logic
- If multiple tests fail, append them all to `report.md`.
- Use a consistent template that matches the style of `report/bug01.md` but optimized for a "Fix this" prompt.

## Proposed Strategy & Tasks

### Phase 1: Bug Reporter Logic
1.  **Create `src/reporter.ts` additions**:
    - [ ] Implement `generateBugReport(suite: TestSuite, summary: ReportSummary): string`.
    - [ ] Add logic to correlate failed `StepResult` with the actual `Step` from the suite.
    - [ ] (Optional) Include the generated code for the failed spec in the report.

### Phase 2: CLI Updates
1.  **Update `src/cli.ts`**:
    - [ ] Add `--export-bugs <file>` flag to `cmdRun`.
    - [ ] Add `--export-bugs <file>` flag to `cmdReport`.
    - [ ] Ensure the file is written only if there are failures (or always if requested).

### Phase 3: Validation
1.  **Add Tests**:
    - [ ] Test `generateBugReport` with a mock failed `ReportSummary`.
    - [ ] Verify the Markdown output contains expected sections (Severity, Summary, Reproduction).

## Implementation Details
- **Template**:
  ```markdown
  # Bug: [Spec Title]
  ## Failure in [Suite Name]
  - **Step**: [Step Index]: [Step Label]
  - **Error**: [Error Message]
  - **Generated Code**:
    ```typescript
    // ... relevant lines ...
    ```
  ```

## Next Steps
- [ ] Research how to easily extract specific lines of generated code for a spec.
- [ ] Implement the Markdown template generator in `src/reporter.ts`.
- [ ] Update `CliIO` if necessary to support the new export.
