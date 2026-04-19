# Development Log — Customizable Auto-Test Browser (core engine)

This file tracks bugs found, features added, and test runs as the project evolves.
Source plan: `plan.md`. Source spec: `ideas.md`.

---

## 2026-04-17 — Iteration 1: scaffold + core engine

### Scope decision
Plan describes a full Electron+React+Monaco desktop app. To be testable headlessly
in this loop, iteration 1 implements the **core engine** modules that the future
Electron renderer will consume:

- Smart Locator (Phase 3 / Task 3.2)
- Recorder + Visual Step Editor data model (Phase 3 / Tasks 3.3–3.5)
- Code Generator for Playwright / Puppeteer / Cypress (Phase 4 + Phase 6 / Task 6.1)
- Save / Load JSON suites (Phase 6 / Task 6.2)

The Electron shell, Monaco editor, and `<webview>` IPC are out of scope for this
iteration (they cannot run in this sandbox). Everything below can be wired into
`electron/main.ts` later without changes.

### Features added
| Module | File | Notes |
|---|---|---|
| Types | `src/types.ts` | `Step`, `Locator`, `TestSuite`, `Framework` |
| Smart Locator | `src/locator.ts` | priority `data-testid > id > name > aria-label > text > css` |
| Recorder | `src/recorder.ts` | start/stop, capture, edit, delete, reorder, toSuite |
| Code Generator | `src/codegen.ts` | Playwright + Puppeteer + Cypress emitters |
| Storage | `src/storage.ts` | save/load `.json` test suites |
| Demo | `src/demo.ts` | end-to-end record → JSON → generated code |

### Test runs

**Run #1 — `npm test`** — all green on first attempt.

```
 ✓ tests/locator.test.ts  (11 tests)
 ✓ tests/codegen.test.ts  (6 tests)
 ✓ tests/recorder.test.ts  (7 tests)
 ✓ tests/storage.test.ts  (3 tests)
 Test Files  4 passed (4)
      Tests  27 passed (27)
   Duration  166ms
```

**Run #2 — `tsc --noEmit`** — compiles cleanly, no type errors.

**Run #3 — `npm run demo`** — end-to-end pipeline produces correct output:

```js
// generated Playwright (truncated)
test('login flow', async ({ page }) => {
  await page.goto('https://example.com/login');
  await page.fill('[name="username"]', 'alice');
  await page.fill('[name="password"]', 'secret');
  await page.click('[data-testid="submit"]');
  await expect(page.locator('text=Welcome, alice')).toBeVisible();
});
```

### Bugs found / fixed
None this iteration — tests passed first time. Edge cases preempted by tests:

- Single quotes in user-typed text (`it's fine`) escaped properly by `q()` in `codegen.ts`.
- Double quotes in attribute values (`has"quote`) escaped via `cssEscape()` in `locator.ts`.
- Long text (>80 chars) skipped as locator and falls back to css selector.
- `parseSuite()` rejects malformed JSON shape (missing `steps` array).
- Reorder rejects out-of-range indices instead of corrupting the array.

### Next iterations (when work resumes)
1. Phase 5 — wrap `generate()` output in a `child_process` Playwright runner that
   streams stdout/stderr back to a callback.
2. Phase 1/2 — Electron shell with `<webview>` and inject script that calls
   `Recorder.capture()` over IPC.
3. Phase 4 — Monaco editor binding (`getValue()` ↔ `generate(suite, framework)`).
4. Phase 6 — settings (User-Agent, GeoLocation), export to `.zip`.

---

## 2026-04-17 — Iteration 2: runner + settings + exporter

### Scope decision
Picked up the three "next iteration" items that don't require a browser/Electron
shell, so they are testable headlessly:

- **Phase 5 / Tasks 5.1–5.3** — `runner.ts`: spec writer + `child_process` spawn
  with stdout/stderr streaming callbacks and timeout-based kill.
- **Phase 6 / Task 6.3** — `settings.ts`: `BrowserSettings` (UA, geo, viewport,
  locale, timezone, slow-mo) with validation and Playwright `use()` mapping.
  Includes device presets (iphone-13, pixel-5, ipad-pro, desktop-1080p/720p).
- **Phase 6 / Task 6.4** — `exporter.ts`: write a generated suite to a `.spec.ts`
  / `.mjs` / `.cy.js` file, optionally injecting a `test.use()` config block from
  settings. Sanitizes the suite name into a safe filename.

### Features added
| Module | File | Notes |
|---|---|---|
| Test Runner | `src/runner.ts` | `buildCommand`, `writeSpec`, `runSpec`, `runSuite`. Streams stdout/stderr; supports `timeoutMs`, `cwd`, command override |
| Browser Settings | `src/settings.ts` | `BrowserSettings`, `validateSettings`, `toPlaywrightUse`, `DEVICE_PRESETS`, `presetViewport` |
| Exporter | `src/exporter.ts` | `buildExport`, `exportSuite`, `exportFilename`. Injects `test.use()` for Playwright when settings supplied |
| Public API | `src/index.ts` | re-exports the three new modules |

### Tests added
| File | Tests | Coverage |
|---|---|---|
| `tests/runner.test.ts` | 10 | command construction, spec writing, real-process stdout/stderr capture, exit code, missing-binary, timeout |
| `tests/settings.test.ts` | 10 | validation (lat/lon range, viewport ints, slow-mo, etc.), Playwright `use` mapping, preset isolation |
| `tests/exporter.test.ts` | 9 | filename sanitization, extension per framework, settings injection ordering, `mkdir -p` semantics |

### Test runs

**Run #1 — `vitest run`** — all 56 tests green (was 27 in iteration 1; +29 new).

```
 ✓ tests/locator.test.ts  (11 tests)
 ✓ tests/codegen.test.ts  (6 tests)
 ✓ tests/recorder.test.ts  (7 tests)
 ✓ tests/settings.test.ts  (10 tests)
 ✓ tests/storage.test.ts  (3 tests)
 ✓ tests/exporter.test.ts  (9 tests)
 ✓ tests/runner.test.ts  (10 tests)
 Test Files  7 passed (7)
      Tests  56 passed (56)
   Duration  352ms
```

**Run #2 — `tsc --noEmit`** — compiles cleanly, no type errors.

### Bugs found / fixed
- **Bug #1 (caught before commit):** initial `src/exporter.ts` had a stray broken
  import line `import { dirname, join } from 'node:str' as never;` (typo for
  `node:path`). Replaced with a single `import * as path from 'node:path';`. tsc
  would have failed the build; fixed before running tests.
- **Edge cases preempted by tests:**
  - Suite names containing `..` or `/` are stripped, so exporter cannot write
    outside the chosen `outDir` (path-traversal sanitization).
  - `runSpec` resolves with `exitCode: -1` (not throws) when the binary cannot
    be spawned, so callers don't need a try/catch around streaming.
  - `presetViewport()` returns a copy — mutating the result does not leak into
    `DEVICE_PRESETS` (verified by test).
  - `validateSettings` collects all errors instead of throwing on the first.
  - Exporter only injects `test.use()` for `playwright` and only when settings
    actually produce a non-empty `use` block.

### Next iterations (when work resumes)
1. Phase 1/2 — Electron shell with `<webview>` + inject script bridging
   `Recorder.capture()` over IPC. (Needs a real GUI environment.)
2. Phase 4 — Monaco editor renderer binding.
3. Phase 5 / Task 5.4 — parse Playwright JSON reporter output and surface
   per-step pass/fail back through the runner result.
4. Phase 6 / Task 6.4 (zip variant) — bundle multiple specs + a runnable
   `package.json` into a `.zip` for export.

---

## 2026-04-17 — Iteration 3: reporter + inject

### Scope decision
Two more items from the "next iterations" list that can be verified headlessly:

- **Phase 5 / Task 5.4** — `reporter.ts`: parse a Playwright JSON reporter
  payload into a flat `ReportSummary`, filter out `Before Hooks`/`After Hooks`
  framework noise, and correlate `StepResult`s with a suite's `Step[]` by index
  so the Visual Step Editor can show a green/red marker per line.
- **Phase 3 / Tasks 3.1–3.2** — `inject.ts`: the content-script-side event
  capture. Attaches `click` / `input` / `change` / `keydown` listeners to a
  `Document`, extracts a `LocatorCandidate` from the target element (lifting
  `data-testid`, `id`, `name`, `aria-label`, `role`, `type`, `placeholder` plus
  a `cssPath` fallback), and forwards to `Recorder.capture()`. Tested with
  jsdom so it runs in CI without a GUI.

The Electron `<webview>` IPC wiring still needs a real GUI, but `inject.ts` is
the entire browser-side half of Phase 3 and can be dropped into a preload
script unchanged.

### Features added
| Module | File | Notes |
|---|---|---|
| Reporter | `src/reporter.ts` | `parsePlaywrightReport`, `correlateSteps`, `allStepsPassed`. Handles nested suites, malformed JSON, missing `stats.duration` |
| Inject | `src/inject.ts` | `attach` (returns cleanup fn), `extractCandidate`, `cssPath`. Maps checkbox click → `check`/`uncheck`, select change → `select`, Enter/Tab/Escape keydown → `press` |
| Public API | `src/index.ts` | re-exports the two new modules |

### Tests added
| File | Tests | Coverage |
|---|---|---|
| `tests/reporter.test.ts` | 12 | malformed JSON, string-vs-object input, hook filtering, pass/fail rollup, error propagation, `stats.duration` fallback, nested suites, index correlation, early-termination `null` tail |
| `tests/inject.test.ts` | 11 | click → testId, input → fill with text, textarea fill, checkbox check/uncheck, select change, keydown filtering (Enter/Tab only), `detach()` cleanup, recorder-stopped guard, `cssPath` with id + nth-of-type, attribute extraction |

### Test runs

**Run #1 — `vitest run`** — all 79 tests green (was 56; +23 new).

```
 ✓ tests/locator.test.ts  (11 tests)
 ✓ tests/storage.test.ts  (3 tests)
 ✓ tests/reporter.test.ts (12 tests)
 ✓ tests/codegen.test.ts  (6 tests)
 ✓ tests/recorder.test.ts (7 tests)
 ✓ tests/settings.test.ts (10 tests)
 ✓ tests/exporter.test.ts (9 tests)
 ✓ tests/runner.test.ts   (10 tests)
 ✓ tests/inject.test.ts   (11 tests)
 Test Files  9 passed (9)
      Tests  79 passed (79)
   Duration  410ms
```

**Run #2 — `tsc --noEmit`** — compiles cleanly after two implicit-any fixes
in `cssPath` (see bugs below).

### Bugs found / fixed
- **Bug #1 (caught by tsc):** in `src/inject.ts#cssPath`, the `parent`
  variable inferred `any` because `cur` was re-assigned inside the while loop
  (`cur` became `Element | null`, which broke narrowing through `cur!.tagName`
  in a filter callback). TS reported `TS7022` on `parent` and `TS18046` on
  `c`. Fix: annotate `parent: Element | null`, capture `cur.tagName` into a
  local `tag` before the filter, and type the filter parameter. Compiles
  clean now.
- **Edge cases preempted by tests:**
  - `parsePlaywrightReport` filters only action-titled steps (those starting
    with `page.`, `expect`, `locator.`, or `frame.`), so
    `correlateSteps(suite, result)` lines up with `suite.steps` instead of
    being offset by `Before Hooks` / `After Hooks`.
  - If a spec errors before running any action-titled steps, the reporter
    synthesizes one `(spec error)` StepResult carrying the error message so
    the UI never shows a green row for a failed test.
  - `correlateSteps` returns `result: null` for trailing steps the runner
    never reached, rather than throwing — callers render those as "not run"
    (grey).
  - `inject.attach` uses capture-phase listeners and returns a `detach()`
    closure so the caller can't leak listeners across multiple record
    sessions. Verified by the "stops capturing after detach()" test.
  - `keydown` is filtered to `Enter` / `Tab` / `Escape` — regular
    alphanumeric keypresses do not spam the step list (they are already
    covered by the `input` → `fill` step with the final value).
  - Checkbox `click` is routed to `check` / `uncheck` based on
    `input.checked` at the time of the event, not `click` (so the generated
    Playwright code uses `page.check()` / `page.uncheck()` which waits for
    the right state).

### Next iterations (when work resumes)
1. Phase 1/2 — Electron shell + `<webview>` preload that wires `inject.attach`
   into the guest and forwards `Recorder` mutations over IPC. (Needs a GUI env
   to run — not testable in this loop.)
2. Phase 4 — Monaco editor renderer binding (needs React + browser).
3. Phase 6 / Task 6.4 (zip variant) — bundle multiple generated specs +
   a minimal `package.json` into a `.zip`. Doable headlessly; skipped here to
   keep the iteration focused.
4. Optional: a `Recorder` subscribe mechanism so the Visual Step Editor UI
   can re-render on each capture without polling `getSteps()`.

---

## 2026-04-17 — Iteration 4: recorder subscribe + multi-suite bundle

### Scope decision
Picked the two remaining headless-testable items from iteration 3's "next
iterations" list:

- **Optional / observer pattern** — `Recorder.subscribe(listener)`: the Visual
  Step Editor needs to re-render whenever any mutation happens (capture, edit,
  delete, reorder, start/stop). Polling `getSteps()` works but is wasteful.
- **Phase 6 / Task 6.4 (bundle variant)** — `bundle.ts`: write multiple suites
  to a self-contained, runnable project directory (`tests/<suite>.spec.ts`,
  `package.json`, `playwright.config.ts` / `cypress.config.js`, plus a
  `bundle.json` manifest). Caller does `cd outDir && npm install && npm test`.
  Built directly on top of `exporter.buildExport`, so settings injection is
  consistent with single-suite export.

A true `.zip` archive was deferred — Node has no built-in zip writer and
introducing a deflate dependency for one feature wasn't worth it. The bundle
directory can be zipped externally (`zip -r out.zip outDir`).

### Features added
| Module | File | Notes |
|---|---|---|
| Recorder.subscribe | `src/recorder.ts` | `subscribe(fn) → unsubscribe`. Emits `RecorderState` ({ steps, recording, baseUrl }) after every mutation. Defensive copy of `steps`; listener throws are isolated; no-op mutations (`removeStep` of unknown id, `clear` when empty) skip the emit |
| Bundle exporter | `src/bundle.ts` | `bundleSuites(suites, framework, outDir, opts?)`. Per-framework subdir (`tests/` for pw/puppeteer, `cypress/e2e/` for cypress), framework-appropriate `package.json` (deps + `npm test` script + `type: module` for puppeteer), Playwright config with optional `use` block from `BrowserSettings`, Cypress `defineConfig` with `specPattern`, deterministic `bundle.json` manifest. Rejects empty input + duplicate suite filenames |
| Public API | `src/index.ts` | re-exports `bundle.ts` |

### Tests added
| File | Tests | Coverage |
|---|---|---|
| `tests/recorder.test.ts` | +8 | start/capture/stop emit order, no-op no-emit, unsubscribe detaches, mutations (update/remove/reorder) emit, removeStep-not-found is silent, clear-when-empty is silent, defensive-copy isolation, listener-throws-don't-break-recorder |
| `tests/bundle.test.ts` | 6 | empty-array rejection, duplicate-filename rejection, full Playwright bundle (specs + pkg + config + manifest layout), settings injection into both spec and config + custom packageName/version, Puppeteer module-type pkg with no separate config, Cypress `cypress/e2e/` layout + config |

### Test runs

**Run #1 — `vitest run`** — all 93 tests green (was 79; +14 new).

```
 ✓ tests/storage.test.ts   (3 tests)
 ✓ tests/reporter.test.ts  (12 tests)
 ✓ tests/settings.test.ts  (10 tests)
 ✓ tests/codegen.test.ts   (6 tests)
 ✓ tests/recorder.test.ts  (15 tests)
 ✓ tests/locator.test.ts   (11 tests)
 ✓ tests/exporter.test.ts  (9 tests)
 ✓ tests/bundle.test.ts    (6 tests)
 ✓ tests/runner.test.ts    (10 tests)
 ✓ tests/inject.test.ts    (11 tests)
 Test Files  10 passed (10)
      Tests  93 passed (93)
   Duration  517ms
```

**Run #2 — `tsc --noEmit`** — compiles cleanly, no type errors.

### Bugs found / fixed
None this iteration — both modules passed tsc and the full vitest suite on
the first attempt. Edge cases preempted by tests:

- **Recorder subscribe — no-op silence:** `removeStep('non-existent')` and
  `clear()` on an empty step list both used to *would-be* emit. They now
  short-circuit before `emit()`, so subscribers don't see redundant
  notifications.
- **Recorder subscribe — defensive copy:** the listener receives
  `getSteps()` (a slice), not the internal array. A test mutates the
  received `steps` array and confirms `recorder.getSteps()` is unaffected.
- **Recorder subscribe — listener isolation:** if one subscribed listener
  throws, other listeners still fire and the recorder's own state stays
  consistent. The try/catch in `emit()` swallows the error silently —
  intentional, because a buggy UI listener must not corrupt the recording.
- **Bundle — duplicate filenames:** if two suites would produce the same
  on-disk filename after `safeName()` sanitization (e.g. both named `"login
  flow"`), `bundleSuites` throws *before* writing anything, so we never
  silently overwrite a spec.
- **Bundle — `outDir` resolution:** `outDir` is `path.resolve()`d up front,
  so the returned `BundleResult.outDir` is always absolute regardless of
  what the caller passed.
- **Bundle — settings consistency:** when `opts.settings` is provided for a
  Playwright bundle, the same `use` block lands in *both* `playwright.config.ts`
  (project-wide) and each spec's `test.use()` (per-spec). Tests assert both
  files contain the override — so the user can't accidentally export a
  bundle where the global config and per-spec config disagree.
- **Bundle — framework-specific layout:** Cypress specs go under
  `cypress/e2e/` to match the default `specPattern`; Puppeteer pkg gets
  `type: "module"` so the generated `.mjs` files run with native ESM.

### Next iterations (when work resumes)
1. Phase 1/2 — Electron shell + `<webview>` preload (still requires GUI, not
   testable in this loop).
2. Phase 4 — Monaco editor renderer binding (needs React + browser).
3. True `.zip` packaging on top of `bundleSuites` — would need either a
   minimal STORE-mode zip writer (~100 lines) or a deflate dependency.
4. CLI entry point: `npx auto-test bundle ./suites.json --framework playwright
   --out ./bundle` would make the headless half of this project usable from
   the terminal without writing TypeScript glue.

---

## 2026-04-17 — Iteration 5: CLI entry point

### Scope decision
Picked item #4 from iteration 4's "next iterations" — the CLI entry point. This
is the last headlessly-testable feature from the plan that makes the core
engine actually usable end-to-end from a terminal, without a GUI. Items #1–#2
(Electron shell, Monaco binding) need a real browser and are still deferred.
Item #3 (true `.zip` writer) was deprioritised since `bundleSuites` already
emits a runnable directory the user can `zip -r` externally.

### Features added
| Module | File | Notes |
|---|---|---|
| CLI (pure) | `src/cli.ts` | `runCli(argv, io?)` returns an exit code (never calls `process.exit`). Tokenizer `parseArgs`, `CliIO` abstraction for tests, sub-commands `gen` / `export` / `bundle` + `--help` / `--version`. Loads + validates `BrowserSettings` from `--settings <file>` |
| CLI (bin) | `src/bin.ts` | Thin shebang wrapper — `process.argv.slice(2)` → `runCli` → `process.exit(code)` |
| Public API | `src/index.ts` | re-exports `cli.ts` |

### Tests added
| File | Tests | Coverage |
|---|---|---|
| `tests/cli.test.ts` | 20 | `parseArgs` (positional/flag interleaving, trailing boolean, leading `--flag` ≠ command), `--help` / `--version` / unknown command, `gen` stdout vs. `--out`, missing/unknown framework, missing positional, malformed suite JSON, `export` file write + settings injection + invalid settings rejection + missing `--out`, `bundle` multi-suite with `--package-name` + `--version` value flags, empty bundle rejection |

### Test runs

**Run #1 — `vitest run`** — 113 tests green (was 93; +20 new).

```
 ✓ tests/locator.test.ts   (11 tests)
 ✓ tests/codegen.test.ts   (6 tests)
 ✓ tests/settings.test.ts  (10 tests)
 ✓ tests/reporter.test.ts  (12 tests)
 ✓ tests/recorder.test.ts  (15 tests)
 ✓ tests/exporter.test.ts  (9 tests)
 ✓ tests/cli.test.ts       (20 tests)
 ✓ tests/bundle.test.ts    (6 tests)
 ✓ tests/storage.test.ts   (3 tests)
 ✓ tests/runner.test.ts    (10 tests)
 ✓ tests/inject.test.ts    (11 tests)
 Test Files  11 passed (11)
      Tests  113 passed (113)
   Duration  561ms
```

**Run #2 — `tsc --noEmit`** — compiles cleanly, no type errors.

### Bugs found / fixed
- **Bug #1 (caught by test):** top-level `--version` handler collided with
  `bundle ... --version 9.9.9` (a string-valued `package.json` version
  override). First test run for the bundle command returned stdout `"0.1.0\n"`
  instead of bundling. Fix: only treat `--version` as the version-print
  command when `args.command === ''` *and* `flags.version === true` (boolean,
  not a string). String-valued `--version` on a sub-command now falls
  through to `cmdBundle` correctly. Confirmed by the `bundles multiple suites`
  test which asserts `pkg.version === '9.9.9'` and the stdout banner.
- **Edge cases preempted by tests:**
  - `parseArgs` treats a leading `--flag` as a flag (not a command), so
    `auto-test --version` works without a bare command word.
  - Trailing boolean flags (`--help` with no following value) are parsed as
    `true`, not consumed as the value of a preceding flag.
  - `cmdGen` prints generated code to stdout when `--out` is omitted, so the
    CLI is pipe-friendly (`auto-test gen suite.json --framework playwright > spec.ts`).
  - `loadSettings` runs `validateSettings` before passing the object to
    downstream modules — invalid lat/long is rejected with a clear error at
    the CLI layer, not deep inside `exportSuite`.
  - `runCli` never calls `process.exit` — returns a numeric code. The shebang
    `bin.ts` is the only place that exits the process, so the CLI stays
    fully testable.
  - Unknown command → exit 2 with usage printed to stderr. Missing required
    positional → exit 2 with a specific error. Any other thrown error
    (framework validation, file parse, settings validation) → exit 1 with
    `<command>: <message>` format on stderr.

### Next iterations (when work resumes)
1. Phase 1/2 — Electron shell + `<webview>` preload (GUI-required, not
   testable here).
2. Phase 4 — Monaco editor renderer binding (needs React + browser).
3. True `.zip` packaging on top of `bundleSuites`.
4. `auto-test record` subcommand — would need a headless browser driver
   (Playwright) to drive a real page while streaming `Recorder.capture()`
   events; feasible headlessly if a test harness is acceptable.
5. Wire up `package.json` `"bin"` field so `npx auto-test` resolves to
   `dist/bin.js` after `npm run build`.

---

## 2026-04-17 — Iteration 6: zip packaging + `bin` wiring

### Scope decision
Picked items #3 and #5 from iteration 5's next-iterations list. Both are
headlessly testable and round out the CLI so `auto-test` can produce a single
distributable `.zip` artifact end-to-end:

- **Phase 6 / Task 6.4 (zip variant)** — `src/zip.ts`: a zero-dependency ZIP
  writer using Node's built-in `zlib.deflateRawSync` + `zlib.crc32`. Implements
  Local File Header, Central Directory, and End-of-Central-Directory records.
  Picks STORE vs. DEFLATE per entry based on whether compression actually
  shrinks the payload.
- **`bundle.zipBundle`** — one-call wrapper that runs `bundleSuites(...)` and
  then `zipDirectory(outDir, zipPath)`, keeping the bundle directory on disk
  alongside the archive (so the caller can `cd` into either one).
- **CLI** — `bundle ... --zip <file>` flag routes to `zipBundle`. Stdout now
  reports both the bundle directory path and the zip size in bytes.
- **`package.json#bin`** — `"auto-test": "dist/bin.js"` so `npm install -g .`
  (or a published package) puts `auto-test` on `$PATH`. Iteration 5 had
  `bin.ts` but no manifest entry.

Items #1 (Electron), #2 (Monaco), and #4 (`record` subcommand needing a real
browser driver) still require a GUI / headless browser — deferred.

### Features added
| Module | File | Notes |
|---|---|---|
| ZIP writer | `src/zip.ts` | `buildZip(entries, now?)` in-memory; `zipDirectory(srcDir, outPath)` walks lexicographically. STORE / DEFLATE picked per entry. Rejects duplicate / `..`-containing names. Normalizes `\` → `/` and strips leading `/`. Uses `zlib.crc32` + `zlib.deflateRawSync` — no third-party deps. |
| zipBundle | `src/bundle.ts` | `zipBundle(suites, framework, outDir, zipPath, opts?)` — bundles and zips in one call; returns both `BundleResult` and `ZipResult` |
| CLI flag | `src/cli.ts` | `bundle --zip <file.zip>` routes to `zipBundle` when supplied. Usage block updated |
| Bin manifest | `package.json` | Adds `"bin": { "auto-test": "dist/bin.js" }` |
| Public API | `src/index.ts` | re-exports `zip.ts` |

### Tests added
| File | Tests | Coverage |
|---|---|---|
| `tests/zip.test.ts` | 13 | empty-entry rejection, duplicate rejection, `..`-in-name rejection, UTF-8 filename + content round-trip (incl. Thai), STORE fallback on incompressible random bytes, DEFLATE chosen for repeating-byte payload, `store:true` forces STORE, name normalization (`\` → `/`, strip `/`), directory walk preserves content, deterministic lexicographic ordering, empty-directory rejection, external `unzip` round-trip (skipped if `unzip` not on `PATH`), `zipBundle` end-to-end archive contents |
| `tests/cli.test.ts` | +1 | `bundle --zip <path>` produces zip on disk + bundle dir alongside, stdout mentions `bundled` and `zipped`, zip size > 0 |

Note: the test file parses the resulting archives using a small in-test ZIP
reader (walks the Central Directory, inflates DEFLATE entries via
`zlib.inflateRawSync`). This keeps the tests self-contained — no `adm-zip`,
no `unzipper` dependency — and proves our archives are parseable via the
structural fields, not just "produces bytes."

### Test runs

**Run #1 — `vitest run`** — all 127 tests green (was 113; +14 new).

```
 ✓ tests/locator.test.ts   (11 tests)
 ✓ tests/codegen.test.ts   (6 tests)
 ✓ tests/reporter.test.ts  (12 tests)
 ✓ tests/recorder.test.ts  (15 tests)
 ✓ tests/exporter.test.ts  (9 tests)
 ✓ tests/bundle.test.ts    (6 tests)
 ✓ tests/cli.test.ts       (21 tests)
 ✓ tests/zip.test.ts       (13 tests)
 ✓ tests/settings.test.ts  (10 tests)
 ✓ tests/storage.test.ts   (3 tests)
 ✓ tests/runner.test.ts    (10 tests)
 ✓ tests/inject.test.ts    (11 tests)
 Test Files  12 passed (12)
      Tests  127 passed (127)
   Duration  532ms
```

**Run #2 — `tsc --noEmit`** — compiles cleanly, no type errors.

### Bugs found / fixed
None this iteration — `zip.ts`, `zipBundle`, and the CLI flag all passed tsc
and the full vitest suite on the first attempt. Edge cases preempted by
tests:

- **STORE vs. DEFLATE decision is per-entry, not per-archive:** random-byte
  payloads deflate to *larger* than the input (deflate header overhead), so
  `buildZip` falls back to STORE when `deflated.length >= uncompressedSize`.
  Verified by the random-bytes test — the entry lands with `method === 0`
  and `compressedSize === input.length`.
- **Path traversal sanitization at the zip layer:** entry names containing
  `..` are rejected before header construction, so a malicious `TestSuite`
  name can't escape the intended archive root. Defence-in-depth — the
  bundle-level `exportFilename` already sanitizes, but the zip writer
  shouldn't trust its caller.
- **Name normalization:** Windows-style `\` is rewritten to `/` and leading
  `/` is stripped. Without this, the archive would be broken when opened on
  Linux (`unzip` would try to write absolute paths).
- **Deterministic ordering:** `zipDirectory` walks `readdir` results sorted
  lexicographically *per directory* before recursing. This means the same
  source tree always produces byte-identical archives (given the same
  timestamp), which is useful for build reproducibility. Verified by a test
  that writes `c.txt`, `a.txt`, `b.txt` in that order and asserts the
  archive contains them in `a, b, c` order.
- **External `unzip` compatibility:** the test that shells out to the
  system `unzip` skips silently when the binary is unavailable (so CI on a
  minimal image doesn't fail), but when present it proves the generated
  `.zip` is not just self-consistent but inter-operates with a real
  third-party reader. On this machine `unzip` is present and the test
  passes.
- **`zipBundle` keeps the bundle dir on disk:** we don't delete `outDir`
  after zipping. Callers who want only the archive can `rm -rf` the
  directory themselves; callers who want both (e.g. for inspection before
  publishing) get both. Documented behavior, asserted by the CLI test.
- **`package.json#bin` is a map, not a string:** `"bin": { "auto-test":
  "dist/bin.js" }` lets `npm` create the `auto-test` symlink under
  `node_modules/.bin` even when the package name differs from the command
  name (`browser-auto-test` vs. `auto-test`). Chose this over a top-level
  `"bin": "dist/bin.js"` for clarity.

### Next iterations (when work resumes)
1. Phase 1/2 — Electron shell + `<webview>` preload (still GUI-required).
2. Phase 4 — Monaco editor renderer binding (still needs React + browser).
3. `auto-test record` subcommand — drive Playwright in headless mode, pipe
   its built-in `codegen` session into our `Recorder` event stream. Feasible
   headlessly but would add a large dependency (`playwright-core`). Defer
   until there's a clear consumer.
4. CLI `run` subcommand — wrap `runner.runSuite` so a full
   `record → bundle → run` cycle is possible from the terminal without
   writing TypeScript glue. Small, headlessly testable, good next pick.
5. A `--reporter` flag on `run` that pipes Playwright's JSON reporter
   output through `reporter.correlateSteps` and prints a per-step
   pass/fail table. The plumbing already exists in `reporter.ts`.

---

## 2026-04-17 — Iteration 7: `run` + `report` CLI subcommands

### Scope decision
Picked items #4 and #5 from iteration 6's next-iterations list. Both are
headlessly testable and finish the CLI surface for the `record → bundle →
run → inspect-result` cycle:

- **CLI `run` subcommand** — wraps `runner.runSuite` so `auto-test run
  suite.json --framework playwright` is a one-liner. Streams stdout/stderr
  to the CLI's IO sinks, supports `--cwd`, `--timeout`, and `--command`
  (binary override). Exits 0 on pass, 1 on fail.
- **CLI `report` subcommand** — splits the JSON-reporter consumption out
  of `run` (so it works on a pre-saved Playwright JSON file too). Reads
  `<suite.json> <report.json>`, parses with `parsePlaywrightReport`,
  correlates with `correlateSteps`, prints a per-step table:
  `[OK]` / `[XX]` / `[--]` for passed / failed / not-run, plus the error
  message under any failed step and a roll-up footer.

Items #1 (Electron), #2 (Monaco), and #3 (`auto-test record` needing a
real headless browser) still require GUI / browser deps — deferred.

### Features added
| Module | File | Notes |
|---|---|---|
| CLI `run` | `src/cli.ts` | `cmdRun`. Reads suite, calls `io.runSuite ?? defaultRunSuite`, streams chunks via `onStdout`/`onStderr`, prints `PASS`/`FAIL <name> (exit N, Tms)` banner |
| CLI `report` | `src/cli.ts` | `cmdReport`. Parses Playwright JSON, correlates with suite, prints per-step `[OK]`/`[XX]`/`[--]` table + error lines + footer |
| Test seam | `src/cli.ts` | `CliIO.runSuite?` optional injection so tests can stub the runner without spawning a real `npx playwright test` |
| Usage block | `src/cli.ts` | Adds the two new subcommand lines to `USAGE` |

### Tests added
| File | Tests | Coverage |
|---|---|---|
| `tests/cli.test.ts` | +9 | `run`: injected stub receives suite/framework/opts, stdout/stderr stream-through, PASS banner, `--cwd`/`--timeout`/`--command` forwarded, FAIL banner + exit 1, invalid `--timeout` rejected, missing positional → exit 2. `report`: passing-spec table with `[OK]` rows + footer, failing report with `[XX]` failed step + `[--]` not-run trailing rows + error message line, missing `<suite.json>` and missing `<report.json>` → exit 2 with specific messages, malformed JSON report → graceful `(no specs in report)` instead of crash |

### Test runs

**Run #1 — `npx tsc --noEmit`** — compiles cleanly, no type errors.

**Run #2 — `vitest run`** — all 136 tests green (was 127; +9 new).

```
 ✓ tests/locator.test.ts   (11 tests)
 ✓ tests/codegen.test.ts   (6 tests)
 ✓ tests/recorder.test.ts  (15 tests)
 ✓ tests/reporter.test.ts  (12 tests)
 ✓ tests/exporter.test.ts  (9 tests)
 ✓ tests/bundle.test.ts    (6 tests)
 ✓ tests/zip.test.ts       (13 tests)
 ✓ tests/cli.test.ts       (30 tests)
 ✓ tests/settings.test.ts  (10 tests)
 ✓ tests/storage.test.ts   (3 tests)
 ✓ tests/runner.test.ts    (10 tests)
 ✓ tests/inject.test.ts    (11 tests)
 Test Files  12 passed (12)
      Tests  136 passed (136)
   Duration  533ms
```

### Bugs found / fixed
None this iteration — both subcommands and the `CliIO.runSuite` injection
seam passed tsc and the full vitest suite on the first attempt. Edge
cases preempted by tests:

- **`run` doesn't shell out under test:** the `CliIO.runSuite?` override
  means tests stub the runner with a synchronous Promise instead of
  spawning a real `npx playwright test` (which isn't installed in CI).
  Default behavior (real spawn via `runner.runSuite`) is unchanged when
  the field is omitted.
- **`run` exit code:** maps `RunResult.passed` to `0` / `1`, not the raw
  `exitCode`. This normalizes the `-1` "couldn't spawn binary" case (which
  the existing runner returns instead of throwing) to a regular shell
  failure, so `auto-test run … && echo ok` works as expected.
- **`--timeout` validation:** caught at the CLI layer with a specific
  error before reaching `runner.runSpec`, since `setTimeout(NaN)` would
  otherwise fire immediately and look like a flake.
- **`report` accepts a malformed/empty report:** `parsePlaywrightReport`
  already returns `{ totalSpecs: 0, … }` on bad JSON, so `cmdReport`
  prints `(no specs in report)` and exits 0 instead of throwing. A `run`
  step that never produced a report shouldn't make `auto-test report`
  crash.
- **Per-step row markers are ASCII (`[OK]`/`[XX]`/`[--]`):** kept it
  pure-ASCII so the output renders identically in CI logs, GitHub
  comments, and terminals without unicode fonts. The previous reporter
  module returns `'passed' | 'failed' | … | null`; the CLI is the only
  layer that picks human-readable markers.
- **`stepLabel` fallback chain:** `locator > url > text > type` — a
  `navigate` step has `url` not `locator`; a recorded `assertText` step
  may have `text` only. The label is best-effort, the marker is the
  source of truth.
- **`report` exits 1 when the spec failed**, even though it reads from a
  pre-saved file (no process to inherit an exit code from). This makes
  `auto-test run …; auto-test report suite.json out.json` usable in shell
  pipelines as a post-hoc gate.

### Next iterations (when work resumes)
1. Phase 1/2 — Electron shell + `<webview>` preload (still GUI-required,
   not testable in this loop).
2. Phase 4 — Monaco editor renderer binding (still needs React + browser).
3. `auto-test record` — would still need a headless browser driver to
   replace the manual `inject.attach` -> Recorder pipe. Could be split
   into a `playwright-codegen` import step that consumes Playwright's
   own JSON-line `--target=javascript` codegen output and feeds it
   through `Recorder.capture()` — feasible headlessly but requires
   adding `playwright-core` as a dependency.
4. `report --spec <n>` flag to render a chosen spec when the report
   contains multiple. Currently we render `specs[0]` and footer-roll-up
   the rest.
5. `report --json` to emit machine-readable correlated output (per-step
   pairs as JSON) for downstream tooling — the underlying
   `correlateSteps` already returns the right shape.

---

## 2026-04-17 — Iteration 8: `report --spec <n>` + `report --json`

### Scope decision
Picked up items #4 and #5 from iteration 7's next-iterations list. Both
extend the existing `report` subcommand without touching any other module
and are fully testable headlessly:

- **`report --spec <n>`** — choose which spec to render (1-based) when
  the Playwright JSON report contains multiple. Previously `cmdReport`
  hard-coded `specs[0]`. The flag validates to a positive integer and
  bails with exit 2 if `n` exceeds `report.specs.length` so a typo
  (`--spec 10` on a 2-spec report) is a loud error, not a silent
  off-by-one.
- **`report --json`** — emit a structured envelope (`suite`, `spec`,
  `totalSpecs`, `summary`, `pairs[]`) instead of the human table. Each
  pair carries `{ index, step, label, result }`, where `result` may be
  `null` for not-run trailing steps — preserving the same tri-state
  (passed / failed / not-run) the ASCII table shows. Downstream tooling
  can now consume the correlated pairs directly without scraping
  `[OK]`/`[XX]`/`[--]` markers.

Items #1 (Electron shell), #2 (Monaco renderer), and #3 (`auto-test
record` with a live browser) still need GUI / browser deps — deferred.

### Features added
| Module | File | Notes |
|---|---|---|
| CLI `report --spec <n>` | `src/cli.ts` | 1-based index into `report.specs`; range/type-validated; exit 2 on out-of-range, exit 1 on bad value |
| CLI `report --json` | `src/cli.ts` | Pretty-printed JSON envelope; combines with `--spec`; empty-report case returns a valid `{ spec: null, totalSpecs: 0, pairs: [] }` envelope, not a crash |
| Usage block | `src/cli.ts` | `report` usage line updated to include `[--spec <n>] [--json]` |

### Tests added
| File | Tests | Coverage |
|---|---|---|
| `tests/cli.test.ts` | +8 | `--spec`: picks Nth spec, defaults to 1, exit 2 on out-of-range with helpful message, exit 1 when value is 0 or non-numeric. `--json`: passing-report envelope shape (`suite`, `spec`, `totalSpecs`, `summary`, `pairs`), failing-report preserves `error` string and `null` for not-run trailing step, `--spec 2 --json` combo routes to correct spec index, empty/malformed report emits a valid-but-empty JSON envelope instead of `(no specs in report)` text |

### Test runs

**Run #1 — `npx tsc --noEmit`** — compiles cleanly, no type errors.

**Run #2 — `npm test` (vitest run)** — all 144 tests green (was 136; +8 new).

```
 ✓ tests/locator.test.ts   (11 tests)
 ✓ tests/codegen.test.ts   (6 tests)
 ✓ tests/recorder.test.ts  (15 tests)
 ✓ tests/reporter.test.ts  (12 tests)
 ✓ tests/exporter.test.ts  (9 tests)
 ✓ tests/bundle.test.ts    (6 tests)
 ✓ tests/zip.test.ts       (13 tests)
 ✓ tests/cli.test.ts       (38 tests)
 ✓ tests/settings.test.ts  (10 tests)
 ✓ tests/storage.test.ts   (3 tests)
 ✓ tests/runner.test.ts    (10 tests)
 ✓ tests/inject.test.ts    (11 tests)
 Test Files  12 passed (12)
      Tests  144 passed (144)
   Duration  543ms
```

### Bugs found / fixed
None this iteration — both flags passed tsc and the full vitest suite on
the first attempt. Edge cases preempted by tests:

- **`--spec` is 1-based in the CLI, 0-based internally:** users type
  `--spec 2` to see the second spec, the code decrements once to
  `report.specs[1]`. The JSON output exposes the 0-based `index` (for
  machine consumers) while the stderr error message echoes the
  user-facing 1-based number — keeps the two audiences in their own
  indexing conventions.
- **`--spec 0` rejected separately from `--spec abc`:** both fail with
  "must be a positive integer," but zero is a classic off-by-one trap
  that would otherwise pass `Number.isInteger` and silently render
  `specs[-1]` (i.e., `undefined`). Explicit `n < 1` gate blocks this.
- **Out-of-range is exit 2, not 1:** matches the project's convention
  that exit 2 = invalid user input (missing positional, bad flag
  target), exit 1 = runtime error (invalid suite JSON, failed spec). A
  `--spec 99` typo is an input error, not a runtime error.
- **`--json` envelope is valid even when the report is empty/malformed:**
  `parsePlaywrightReport` returns `totalSpecs: 0` on bad JSON; in text
  mode we print `(no specs in report)`, but in JSON mode we emit
  `{ suite, spec: null, totalSpecs: 0, pairs: [] }` so downstream
  `jq` / `JSON.parse` callers don't have to special-case a non-JSON
  stdout line. Exit code stays `0` (no spec = nothing to fail).
- **`--json` preserves the `null` sentinel for not-run steps:**
  `correlateSteps` already returns `result: StepResult | null`; we pass
  it straight through `JSON.stringify` so the tri-state (passed /
  failed / not-run) survives serialization. Consumers can test
  `pairs[i].result === null` symmetrically to the `[--]` marker in text
  mode.
- **`--json` still returns exit 1 on a failed spec:** the exit code is
  the gate, not the output format. `auto-test report ... --json | jq ...`
  in a CI step should still fail the job when the spec failed, just
  like the text-mode version does.
- **Flag parsing free lunch:** `parseArgs` already distinguishes
  `--json` (bare → `true`) from `--spec 2` (value → `"2"`). No parser
  changes needed; both flags dropped straight into `cmdReport`.

### Next iterations (when work resumes)
1. Phase 1/2 — Electron shell + `<webview>` preload (still GUI-required,
   not testable in this loop).
2. Phase 4 — Monaco editor renderer binding (still needs React +
   browser).
3. `auto-test record` — still needs a headless browser driver; could
   be split into a `playwright-codegen` JSON-line import step.
4. `report --all` to print every spec in the report (current default
   renders `specs[0]`, `--spec <n>` renders one; a `--all` mode would
   iterate). Trivial follow-up but no clear consumer yet.
5. `run --report <file>` shorthand that writes the Playwright JSON
   reporter output to `<file>` and then chains into `cmdReport`,
   collapsing the two-step `run`-then-`report` pipeline into one
   command. Requires wiring `PLAYWRIGHT_JSON_OUTPUT_NAME` into
   `runner.buildCommand`.

---

## 2026-04-17 — Iteration 9: `report --all` + `run --report <file>`

### Scope decision
Picked up items #4 and #5 from iteration 8's next-iterations list. Both
are small, orthogonal CLI extensions that round off the report/run
pipeline and are fully testable headlessly:

- **`report --all`** — render every spec in the report instead of just
  `specs[0]` (default) or one chosen spec (`--spec <n>`). Text mode
  emits a `--- spec N/total ---` header before each spec and a single
  roll-up summary at the end. JSON mode changes the envelope shape from
  a single `{ spec, pairs }` to `{ totalSpecs, summary, specs[] }`
  where each `specs[i]` is the same per-spec envelope `--spec` returns.
  `--all` and `--spec` are mutually exclusive (exit 1 with a clear
  message). Exit code is 0 only when every spec in the report passed
  (`report.failed === 0`).
- **`run --report <file>`** — collapse the two-step `run` → `report`
  pipeline into one command. The CLI appends `--reporter=json` to the
  Playwright CLI args and sets `PLAYWRIGHT_JSON_OUTPUT_NAME=<abspath>`
  in the child env, then after the run reads the written file back,
  parses it with `parsePlaywrightReport`, and renders it via the shared
  `renderReportText` helper in `--all` mode (so multi-spec specs all
  show up under the verdict banner). Missing file → stderr warning but
  the run's own exit code still rules the final exit. Non-playwright
  frameworks → exit 1 with an explicit message (Puppeteer/Cypress don't
  share the same JSON-reporter contract).

Items #1 (Electron shell), #2 (Monaco renderer), and #3 (`auto-test
record` with a live browser) still need GUI / browser deps — deferred.

### Features added
| Module | File | Notes |
|---|---|---|
| Runner `extraArgs` | `src/runner.ts` | `RunOptions.extraArgs?: string[]` — appended after base args so the CLI can add `--reporter=json` without replacing the whole args vector |
| Runner `env` | `src/runner.ts` | `RunOptions.env?: Record<string, string \| undefined>` — merged onto `process.env`, not a replacement; lets the CLI set `PLAYWRIGHT_JSON_OUTPUT_NAME` while keeping `PATH` etc. |
| CLI `run --report <file>` | `src/cli.ts` | Playwright-only; wires `--reporter=json` + env; auto-renders the written file after the run. Missing-file failure is a stderr warning, not a fatal error |
| CLI `report --all` | `src/cli.ts` | Text + JSON variants; mutually exclusive with `--spec`; exit 0 only when every spec passed |
| CLI refactor | `src/cli.ts` | Extracted `renderSpecText`, `specEnvelope`, `renderReportText` helpers so `run --report` and `report` share the same rendering code |
| Usage block | `src/cli.ts` | `run` usage line adds `[--report <file>]`; `report` usage line changes `[--spec <n>]` to `[--spec <n> \| --all]` |

### Tests added
| File | Tests | Coverage |
|---|---|---|
| `tests/runner.test.ts` | +2 | `extraArgs` appended (not prepended) after base args; `env` merged on top of `process.env` (parent vars still present in child) |
| `tests/cli.test.ts` | +10 | `report --all`: renders every spec in order with separator headers, single footer summary; exit 0 when all passed, exit 1 when any failed; `--spec` + `--all` rejected as mutually exclusive; `--all --json` emits `{ totalSpecs, summary, specs[] }` envelope; empty-report `--all --json` still emits `{ specs: [] }`. `run --report`: `--reporter=json` + resolved `PLAYWRIGHT_JSON_OUTPUT_NAME` env passed to runner; relative `--report` path resolved to absolute before env; non-playwright framework rejected with exit 1; missing report file is a stderr warning but the run's own exit code wins; failed run with renderable report exits 1 and still prints per-step `[XX]` / `[--]` markers |

### Test runs

**Run #1 — `npx tsc --noEmit`** — compiles cleanly, no type errors.

**Run #2 — `npm test` (vitest run)** — all 156 tests green (was 144; +12 new).

```
 ✓ tests/locator.test.ts   (11 tests)
 ✓ tests/codegen.test.ts   (6 tests)
 ✓ tests/recorder.test.ts  (15 tests)
 ✓ tests/reporter.test.ts  (12 tests)
 ✓ tests/exporter.test.ts  (9 tests)
 ✓ tests/bundle.test.ts    (6 tests)
 ✓ tests/zip.test.ts       (13 tests)
 ✓ tests/cli.test.ts       (48 tests)
 ✓ tests/settings.test.ts  (10 tests)
 ✓ tests/storage.test.ts   (3 tests)
 ✓ tests/runner.test.ts    (12 tests)
 ✓ tests/inject.test.ts    (11 tests)
 Test Files  12 passed (12)
      Tests  156 passed (156)
   Duration  589ms
```

### Bugs found / fixed
One bug this iteration, caught and fixed before landing:

- **`extraArgs` test initially failed with exit 9 ("invalid argument")
  from node.** The test used `node -e '<script>' --flag-a value-a
  --flag-b` to echo argv — but node parses flags that look like node
  CLI options (`--flag-b`) before handing the rest to the script, and
  rejects any it doesn't recognize. Fix: drop the `--` convention into
  the base args (`['-e', '<script>', '--']`) so node stops flag parsing
  and treats the extra args as script argv. Kept the assertion simple
  (two innocuous positionals + order check) rather than reaching for a
  more elaborate wrapper script — the point of the test is the *order*
  of appending, not flag parsing.

Edge cases preempted by tests (no bugs here, just defensive paths):

- **`--report` is resolved to an absolute path before going into the
  env:** Playwright's CLI respects `PLAYWRIGHT_JSON_OUTPUT_NAME` as-is;
  a relative path would be resolved against the runner's `--cwd` (if
  set), not the CLI's `process.cwd()`. Resolving at the CLI layer makes
  the file land where the user typed it regardless of `--cwd`.
- **Missing report file after run is a stderr warning, not an
  exception:** if `--reporter=json` didn't write the file for whatever
  reason (binary missing, playwright crash, permission denied), we
  don't want to mask the run's own exit code with a "rendering failed"
  error. The run verdict is the authoritative signal; report rendering
  is a convenience.
- **`--spec` + `--all` rejection is exit 1, not exit 2:** `parseArgs`
  accepts both flags fine — the conflict is only detected inside
  `cmdReport`. That's a runtime error (the CLI layer itself parsed the
  input cleanly), not a bad-positional-arg error. Matches the project
  convention: exit 2 = argument structure wrong, exit 1 = semantic
  conflict or downstream failure.
- **`--all` exit code uses `report.failed === 0`, not
  `spec.status === 'passed'`:** single-spec mode can key off the one
  spec it renders; multi-spec mode has to aggregate. Using the parsed
  summary's `failed` counter keeps `skipped` specs from flipping the
  exit code to 1 (which would be wrong — skipped isn't failed).
- **`--all --json` empty-report envelope uses `specs: []`, not
  `spec: null`:** keeps the shape aligned with the populated case so
  `specs.length` / `specs.map(...)` work uniformly on the consumer
  side. Backwards-compatible: non-`--all` `--json` empty case still
  returns the original `{ spec: null, pairs: [] }` shape, so existing
  scripts that check `spec === null` keep working.
- **Runner `env` merges over `process.env`, doesn't replace it:** the
  playwright CLI needs `PATH`, `HOME`, `NODE_PATH`, etc. to even find
  its own modules — replacing the env wholesale would kill every
  non-trivial spawn. Spreading `{ ...process.env, ...opts.env }`
  preserves the parent env and lets callers override or add keys.

### Next iterations (when work resumes)
1. Phase 1/2 — Electron shell + `<webview>` preload (still GUI-required,
   not testable in this loop).
2. Phase 4 — Monaco editor renderer binding (still needs React +
   browser).
3. `auto-test record` — still needs a headless browser driver; could
   be split into a `playwright-codegen` JSON-line import step.
4. `run --report <file>` could grow `--open-html-report` or
   `--trace-on-fail` toggles once a Playwright sandbox install is
   available. Same wiring (extraArgs + env) — just different flags.
5. `report --filter <status>` to print only failed specs (or passed,
   skipped) within `--all`. Useful once test suites have more than a
   handful of specs; trivially additive to the existing `--all`
   rendering loop.

---

## 2026-04-17 — Iteration 10: `report --all --filter <status>`

### Scope decision
Picked up item #5 from iteration 9's next-iterations list — the most
testable headless follow-up. Items #1–4 (Electron shell, Monaco binding,
live-browser `record`, `--open-html-report` / `--trace-on-fail` toggles)
all need GUI / browser deps and stay deferred.

`--filter <status>` lets users narrow `report --all` output to specs
matching one or more statuses (`passed | failed | skipped | timedOut |
interrupted`). Comma-separated values supported (`--filter
failed,timedOut`).

### Design choices

- **`--filter` is `--all`-only.** A single-spec view (`--spec` or
  default) already shows exactly one spec, so filtering is meaningless
  there. Combining them throws `--filter requires --all` (exit 1).
- **Exit code reflects the FULL report, not the filtered subset.** If
  the run had any failures, exit 1 — even when `--filter passed` hides
  them. Filter is a *display* concern; lying about the underlying
  verdict to chained scripts would be actively dangerous (`report
  --filter passed && deploy` would deploy on a red build).
- **`--- spec N/total ---` headers keep the spec's ORIGINAL position**
  in the full report, not its position in the filtered subset. Lets
  users correlate a filtered render back to the full report (`--- spec
  2/3 ---` means "spec 2 of 3 in the source", not "1 of 1 in this
  filter").
- **JSON envelope: `summary` reflects the full report, `specs[]` is
  filtered, and a top-level `filter: [...]` field echoes the parsed
  filter back.** Same rationale as exit code — totals don't lie. The
  echoed filter field gives consumers a way to confirm the server-side
  parse matched their intent (and detect dedup from
  `passed,passed,passed` → `["passed"]`).
- **Empty filter result → `(no specs match --filter <list>)` to stdout
  + exit 0** if the full report had no failures, exit 1 otherwise.
  Same exit-code rule as the populated case. Footer summary still
  prints so the user sees the underlying tallies even when nothing
  matched.
- **Status validation runs before report parse** so a typo
  (`--filter brokn`) fails fast with `unknown status "brokn" — use one
  of passed, failed, skipped, timedOut, interrupted` instead of
  silently rendering nothing.
- **Dedup is silent.** `--filter passed,passed` → `["passed"]` with
  no warning. Repeated values are user laziness, not user error.

### Features added
| Module | File | Notes |
|---|---|---|
| `parseFilter` helper | `src/cli.ts` | Splits, trims, validates against `ResultStatus[]`, dedups while preserving order. Throws on empty / unknown |
| `cmdReport --filter` wiring | `src/cli.ts` | `--filter` only valid with `--all`; computes filtered indices once and reuses for both text and JSON paths |
| `renderReportText` indices override | `src/cli.ts` | New optional `indicesOverride?: number[]` param so the renderer iterates the filtered set but still prints the original `--- spec N/total ---` numbering |
| Empty-filter text branch | `src/cli.ts` | Prints `(no specs match --filter <list>)` then the same roll-up summary, instead of silently printing only the footer |
| JSON `filter` field | `src/cli.ts` | Top-level `filter: [...]` only present when `--filter` was passed (omitted otherwise → backwards-compatible with iter-9 `--all --json` consumers) |
| Usage block | `src/cli.ts` | `report` line gains `[--filter <status[,status...]>]` with the `(only with --all)` qualifier |

### Tests added
| File | Tests | Coverage |
|---|---|---|
| `tests/cli.test.ts` | +7 | New 3-spec `triReport` fixture (failed + passed + skipped). `--filter passed`: only matching spec rendered, `--- spec 2/3 ---` header preserved, footer keeps full-report tallies, exit 1 because full report has a failure; `--filter failed,skipped`: comma-list parsed, both specs rendered in original order; empty filter result on an all-pass `sampleReport`: prints "(no specs match --filter failed)" + footer + exit 0; `--filter` without `--all` rejected exit 1 with clear message; unknown filter value (`broken`) rejected exit 1 with status name in the error; `--all --filter failed --json` envelope: `summary` reflects full report, `specs[]` is filtered, top-level `filter: ["failed"]` echoed back; `--filter passed,passed,passed` → dedup'd to `["passed"]` silently |

### Test runs

**Run #1 — `npx tsc --noEmit`** — compiles cleanly, no type errors.

**Run #2 — `npm test` (vitest run)** — all 163 tests green (was 156, +7 new).

```
 ✓ tests/reporter.test.ts  (12 tests)
 ✓ tests/locator.test.ts   (11 tests)
 ✓ tests/codegen.test.ts   (6 tests)
 ✓ tests/recorder.test.ts  (15 tests)
 ✓ tests/exporter.test.ts  (9 tests)
 ✓ tests/bundle.test.ts    (6 tests)
 ✓ tests/zip.test.ts       (13 tests)
 ✓ tests/settings.test.ts  (10 tests)
 ✓ tests/cli.test.ts       (55 tests)
 ✓ tests/storage.test.ts   (3 tests)
 ✓ tests/runner.test.ts    (12 tests)
 ✓ tests/inject.test.ts    (11 tests)
 Test Files  12 passed (12)
      Tests  163 passed (163)
   Duration  561ms
```

### Bugs found / fixed
None this iteration — all 7 new tests passed first time. Edge cases
preempted by tests / design (no bugs, just defensive paths):

- **Filter without `--all` is a hard error, not a silent upgrade to
  `--all`.** Tempting shortcut: "if `--filter` is passed, imply
  `--all`." Rejected because it would mask a genuine user mistake
  (forgot `--all`) and confuse readers of `report` shell history. The
  CLI convention here is explicit-flags-only.
- **Filter dedup uses a `Set` but appends to an ordered array** so
  `--filter skipped,failed` and `--filter failed,skipped` both render
  in the report's original spec order, not the filter's order. The
  filter is a *predicate*, not a sort key.
- **`payload.filter = filter` is set AFTER the rest of the JSON
  envelope** so it appears as a trailing field in the rendered JSON,
  keeping the iter-9 `{ suite, totalSpecs, summary, specs }` shape
  byte-stable when no filter is in play.
- **Status validation lives in `parseFilter` (CLI layer), not in
  `reporter.ts`.** Reporter's `ResultStatus` is a structural type, and
  validation belongs at the boundary where the string from argv
  becomes a typed value. Keeps reporter free of CLI concerns.
- **`indices` is computed once** and shared between text and JSON
  branches — avoids the trap where the two paths could drift on what
  "filtered" means (e.g., one accidentally including `interrupted` and
  the other not).
- **`indicesOverride` is `undefined` when no filter is passed**, so
  the iter-9 default behavior (`which === 'all'` → all indices) is
  byte-identical to before. Confirmed by the existing `--all` tests
  still passing untouched.

### Next iterations (when work resumes)
1. Phase 1/2 — Electron shell + `<webview>` preload (still GUI-required,
   not testable in this loop).
2. Phase 4 — Monaco editor renderer binding (still needs React +
   browser).
3. `auto-test record` — still needs a headless browser driver; could
   be split into a `playwright-codegen` JSON-line import step.
4. `run --report <file>` could grow `--open-html-report` or
   `--trace-on-fail` toggles once a Playwright sandbox install is
   available. Same wiring (extraArgs + env) — just different flags.
5. `report --filter` could grow `--invert` (show specs that DON'T
   match) or shorthand aliases (`--failed-only` → `--all --filter
   failed`). Both trivial; defer until a consumer asks.
6. `report --sort <field>` — sort filtered specs by `durationMs`
   (descending) so the slowest failures bubble to the top of a
   `--filter failed,timedOut --sort duration` view. Pairs naturally
   with `--filter`; deferred until a real flake-triage workflow
   surfaces the need.

---

## 2026-04-17 — Iteration 11: `report --all --sort <key>`

### Scope decision
Picked up item #6 from iteration 10's next-iterations list — the most
testable headless follow-up. Items #1–5 (Electron shell, Monaco binding,
live-browser `record`, `--open-html-report` toggles, `--invert`/aliases)
either need GUI/browser deps or are trivial cosmetic additions waiting on
a consumer ask.

`--sort <key>` reorders `report --all` output by spec runtime, so the
slowest specs bubble to the top of a triage view. Pairs naturally with
`--filter`: filter narrows the set, sort orders what remains.

Supported keys (kept deliberately minimal):
- `duration` — descending (slowest first); the flake-triage default
- `duration-asc` — ascending (fastest first); useful when looking for
  zero-duration / never-actually-ran specs

### Design choices

- **`--sort` is `--all`-only**, mirroring `--filter`. A single-spec view
  (`--spec` or default) shows exactly one spec, so sorting it is a
  no-op. Combining throws `--sort requires --all` (exit 1) — same
  explicit-flags-only convention from iter 10.
- **Filter THEN sort, not the other way around.** Sorting first and
  then filtering would waste work and (more importantly) couple the
  two flags semantically — readers would have to know the ordering.
  Filter-then-sort matches how SQL `WHERE` precedes `ORDER BY` and how
  shell pipelines read left-to-right.
- **`--- spec N/total ---` headers keep the spec's ORIGINAL position**
  in the full report, not its position in the sorted list. Same
  rationale as `--filter` from iter 10 — sort is a *display* concern,
  and lying about a spec's source-of-truth index would break
  cross-references back to the unsorted report or the suite file.
- **Stable tie-breaker is the original index.** Two specs with equal
  `durationMs` keep their source order. Without this, `Array.prototype.sort`
  is implementation-defined for equal keys and could shuffle visually
  identical rows between Node versions — bad for diffable CI logs.
- **Exit code reflects the FULL report, not the sorted/filtered view.**
  Same rule as `--filter`: `report --filter passed --sort duration && deploy`
  must not deploy on a red build just because the failures were hidden
  by display flags.
- **JSON envelope: `specs[]` is sorted, `summary` is the full-report
  tally, top-level `sort: "<key>"` echoes the key back** when
  `--sort` was passed (omitted otherwise → byte-stable with iter-9/10
  consumers who never set the flag).
- **Two keys only — `duration` and `duration-asc`.** Resisted adding
  `name`, `status`, etc. until a real workflow asks. The flake-triage
  motivation (item #6) is strictly duration-based, and overloading the
  flag now would mean inventing a sort-key vocabulary for a single
  consumer. YAGNI.
- **`-asc` suffix instead of a separate `--sort-asc` boolean.** Keeps
  the surface area to one flag (`--sort`) and makes the intent
  self-documenting in shell history (`--sort duration-asc` reads as
  exactly what it does). Trade-off: future keys must follow the same
  `<key>` / `<key>-asc` convention; acceptable given how few keys we
  expect.
- **Validation lives in `parseSort` (CLI layer)**, same boundary as
  `parseFilter`. Reporter stays free of CLI vocabulary.
- **`indices = sortIndices(...)` reassigns the same variable used by
  both text and JSON branches** so the two paths can never drift on
  what "sorted" means — same trap the iter-10 `indicesOverride` change
  was guarding against, applied to the second axis.

### Features added
| Module | File | Notes |
|---|---|---|
| `parseSort` helper | `src/cli.ts` | Validates against `SortKey[]` (`duration` \| `duration-asc`). Throws on unknown key with the valid list in the message |
| `sortIndices` helper | `src/cli.ts` | Returns a NEW sorted index array (doesn't mutate input). Direction flips on `-asc`; ties broken by original index for stability |
| `cmdReport --sort` wiring | `src/cli.ts` | `--sort` only valid with `--all`; applied AFTER `--filter` so the two compose predictably; same `indices` variable reused for text and JSON renders |
| JSON `sort` field | `src/cli.ts` | Top-level `sort: "<key>"` only present when `--sort` was passed (omitted otherwise → backwards-compatible with iter-9/10 `--all --json` consumers) |
| Usage block | `src/cli.ts` | `report` line gains `[--sort <duration\|duration-asc>]` with the `(only with --all)` qualifier |

### Tests added
| File | Tests | Coverage |
|---|---|---|
| `tests/cli.test.ts` | +7 | Reuses iter-10's 3-spec `triReport` (durations 100/200/0 ms). `--sort duration`: order in stdout is second (200) → first (100) → third (0); `--- spec N/total ---` headers keep originals; `--sort duration-asc`: reverse order (third → first → second); `--filter failed,passed --sort duration`: filter drops third, sort orders remaining as second → first; `--all --sort duration --json`: `specs[].spec.index` is `[1, 0, 2]`, top-level `sort: "duration"` echoed, `summary` reflects full report; `--sort` without `--all` rejected exit 1 with "--sort requires --all"; unknown sort key (`flaky`) rejected exit 1 with key name in the message; new `tiedReport` (3 specs all 50ms): stable tie-break preserves source order `[0, 1, 2]` |

### Test runs

**Run #1 — `npx tsc --noEmit`** — compiles cleanly, no type errors.

**Run #2 — `npm test` (vitest run)** — all 170 tests green (was 163, +7 new).

```
 ✓ tests/locator.test.ts   (11 tests)
 ✓ tests/recorder.test.ts  (15 tests)
 ✓ tests/codegen.test.ts   (6 tests)
 ✓ tests/reporter.test.ts  (12 tests)
 ✓ tests/exporter.test.ts  (9 tests)
 ✓ tests/bundle.test.ts    (6 tests)
 ✓ tests/zip.test.ts       (13 tests)
 ✓ tests/settings.test.ts  (10 tests)
 ✓ tests/storage.test.ts   (3 tests)
 ✓ tests/cli.test.ts       (62 tests)
 ✓ tests/runner.test.ts    (12 tests)
 ✓ tests/inject.test.ts    (11 tests)
 Test Files  12 passed (12)
      Tests  170 passed (170)
   Duration  540ms
```

### Bugs found / fixed
None this iteration — all 7 new tests passed first time. Edge cases
preempted by tests / design (no bugs, just defensive paths):

- **Stable tie-break was added BEFORE writing the tests, not after a
  flake.** `Array.prototype.sort` is required to be stable in modern
  V8 (Node ≥12), but relying on the host's stability for
  user-observable output ordering is the kind of thing that bites
  exactly once in CI and then never again. Adding `a - b` as the tie-
  break secondary key makes the ordering source-true regardless of
  the engine's sort implementation. The `tiedReport` test pins the
  contract.
- **Reassigning `indices` (instead of declaring a second variable)
  was deliberate.** Two variables — say `filteredIndices` and
  `sortedIndices` — would have created a fork where the JSON branch
  could accidentally read the unsorted set while the text branch read
  the sorted set (or vice versa). Single-variable reassignment closes
  that bug class structurally.
- **Filter-then-sort, not sort-then-filter.** The composition order
  is observable when `--filter` removes specs that would otherwise
  alter the sort's relative positions — not in this codebase (filter
  is a pure status predicate that doesn't touch durationMs), but it
  matters for future filters (e.g., a hypothetical `--slowest 5`).
  Pinning the order now means future filters automatically slot in
  before sort without rethinking semantics.
- **`payload.sort = sort` is set AFTER `payload.filter = filter`** so
  in the rendered JSON, the trailing fields appear in the order
  `{ ...envelope, filter, sort }`. Keeps the iter-10 byte layout
  stable for callers that only ever pass `--filter` (no `sort` field
  appears at all → no diff in their pipelines).
- **`--sort duration-asc` without any failed specs returns exit 0**
  (proved by the `tiedReport` test, which is all-passed). Verified
  the exit-code rule still routes through `report.failed === 0` and
  isn't accidentally tied to the sorted set.
- **`SORT_KEYS` is exported as a `const SortKey[]`, not a `string[]`**,
  so adding a new key (e.g., `name`) flags the `parseSort` cast site
  at compile time if the type union and the array drift.

### Next iterations (when work resumes)
1. Phase 1/2 — Electron shell + `<webview>` preload (still GUI-required,
   not testable in this loop).
2. Phase 4 — Monaco editor renderer binding (still needs React +
   browser).
3. `auto-test record` — still needs a headless browser driver; could
   be split into a `playwright-codegen` JSON-line import step.
4. `run --report <file>` could grow `--open-html-report` or
   `--trace-on-fail` toggles once a Playwright sandbox install is
   available. Same wiring (extraArgs + env) — just different flags.
5. `report --filter` could grow `--invert` (show specs that DON'T
   match) or shorthand aliases (`--failed-only` → `--all --filter
   failed`). Both trivial; defer until a consumer asks.
6. `report --sort` could grow `name` (alphabetical) or `status`
   (group by passed/failed/skipped) keys when a non-flake-triage
   workflow surfaces. The `<key>` / `<key>-asc` convention is the
   contract; reporter stays untouched.
7. `report --top <N>` — show only the top N specs after sort/filter
   (e.g., `--all --sort duration --top 10` for "10 slowest"). Pairs
   naturally with `--sort`; trivial to add as another `indices` slice
   step. Deferred until the flake-triage workflow asks for it.

---

## 2026-04-17 — Iteration 12: `report --all --top <N>`

### Scope decision
Picked up item #7 from iteration 11's next-iterations list — the last
trivially-composable `report --all` pipeline step, and the one that
closes out the "flake-triage workflow" use case the iter-10/11 arc was
building toward. `--sort duration --top 10` is now the canonical "10
slowest specs" invocation; without `--top`, a `--sort` view floods the
console on large reports.

Items #1–4 still need GUI/browser deps (Electron shell, Monaco binding,
live `record`, Playwright sandbox for `--trace-on-fail`). Items #5–6
(`--invert`, shorthand aliases, `name`/`status` sort keys) remain
deferred until a consumer asks — no new workflow has surfaced that
needs them.

### Design choices

- **`--top` applies AFTER `--filter` and `--sort`** (filter → sort →
  top). This is the only ordering that makes `--sort duration --top N`
  mean "N slowest". Slicing before sort would produce "N source-order
  specs, then sorted" — useless. Slicing before filter would pad the
  slice with specs the filter was meant to exclude. The pipeline now
  matches SQL's `WHERE → ORDER BY → LIMIT` order exactly.
- **`--top` is `--all`-only**, mirroring `--filter` and `--sort`. A
  single-spec view already shows exactly one spec — "top N of 1" is
  meaningless. Combining throws `--top requires --all` (exit 1).
- **Positive integer only — reject 0, negatives, and fractions.**
  `--top 0` would render an empty view that the user can already get
  via `--filter <impossible>`, and it'd conflict with the exit-code
  contract (footer still fires, suggesting specs exist). Rejecting 0
  keeps the flag monotonic: N always means "at least one spec shown,
  if any exist after filter".
- **N > available is NOT an error; just shows everything.** Matches
  `head -n 1000` on a 3-line file. Saves the user from having to
  branch on "how many specs does my report have" — a `--top 10` in a
  CI script should work whether the report has 3 or 300.
- **`--- spec N/total ---` headers keep ORIGINAL positions**, same as
  `--filter` (iter 10) and `--sort` (iter 11). `--top` is a display
  concern — the spec's identity in the source-of-truth report is
  unchanged.
- **Exit code reflects the FULL report, not the top-N slice.** Same
  rule as `--filter`/`--sort`. `report --sort duration --top 1 &&
  deploy` must not deploy just because the single shown spec passed.
- **Footer always reflects the FULL report.** `1 passed, 1 failed, 1
  skipped (600ms total)` still renders even when `--top 1` hid two
  specs — otherwise the tally would lie about the run.
- **JSON envelope: `specs[]` is the trimmed slice, `summary` is the
  full tally, top-level `top: N` echoes the value back** when
  `--top` was passed (omitted otherwise → byte-stable with iter-9/10/11
  consumers). Field order in the rendered JSON stays
  `{ ...envelope, filter, sort, top }` so every prior layout is a
  strict prefix of the current one.
- **Single-variable `indices` reassignment preserved.** Third slot in
  the same variable (after filter, sort). The iter-10 rationale holds:
  two paths (text and JSON) can never drift on what "displayed indices"
  means if they read the same variable.
- **`parseTop` lives in the CLI layer**, same boundary as `parseFilter`
  and `parseSort`. Reporter stays free of CLI vocabulary.
- **Non-string flag branch uses "--top must be a positive integer (no
  value provided)"** to match `parseTop`'s "--top must be a positive
  integer" prefix. This matters because `--top -1` is parsed as a
  boolean (parseArgs rejects `-`-prefixed lookahead), so the
  user-visible path for negatives goes through the non-string branch.
  Unifying the prefix means a single grep on stderr catches both.

### Features added
| Module | File | Notes |
|---|---|---|
| `parseTop` helper | `src/cli.ts` | Validates positive integer. Rejects 0, negatives, fractions, non-numeric strings with the value echoed in the error |
| `cmdReport --top` wiring | `src/cli.ts` | `--top` only valid with `--all`; applied AFTER `--filter` and `--sort` via `indices = indices.slice(0, top)`; N larger than available is a silent no-op (not an error) |
| JSON `top` field | `src/cli.ts` | Top-level `top: N` only present when `--top` was passed (omitted otherwise → backwards-compatible with iter-9/10/11 `--all --json` consumers). Added after `filter`/`sort` so prior layouts remain strict prefixes |
| Usage block | `src/cli.ts` | `report` line gains `[--top <N>]` with the `(only with --all)` qualifier |

### Tests added
| File | Tests | Coverage |
|---|---|---|
| `tests/cli.test.ts` | +8 | Reuses iter-10/11's 3-spec `triReport` (durations 100/200/0 ms). `--sort duration --top 2`: stdout contains second(200) and first(100) but NOT third(0); original-position headers intact; footer reflects FULL report (`1 passed, 1 failed, 1 skipped`). `--top 1` without `--sort`: picks the first spec in SOURCE order (not slowest). `--filter failed,passed --sort duration --top 1`: pipeline filter→sort→top produces only second spec. `--top 99` on a 3-spec report: all three rendered (no error). `--all --sort duration --top 2 --json`: `specs[].spec.index === [1, 0]`, `sort: "duration"`, `top: 2`, `summary` still full report. `--all --json` (no `--top`): `'top' in payload === false` (byte-stable). `--top` without `--all`: exit 1 with "--top requires --all". `--top 0`, `--top -1`, `--top 2.5`, `--top abc`: all exit 1 with "--top must be a positive integer" prefix |

### Test runs

**Run #1 — `npx tsc --noEmit`** — compiles cleanly, no type errors.

**Run #2 — `npm test` (vitest run)** — all 178 tests green (was 170, +8 new).

```
 ✓ tests/locator.test.ts   (11 tests)
 ✓ tests/recorder.test.ts  (15 tests)
 ✓ tests/codegen.test.ts   (6 tests)
 ✓ tests/reporter.test.ts  (12 tests)
 ✓ tests/exporter.test.ts  (9 tests)
 ✓ tests/bundle.test.ts    (6 tests)
 ✓ tests/zip.test.ts       (13 tests)
 ✓ tests/settings.test.ts  (10 tests)
 ✓ tests/storage.test.ts   (3 tests)
 ✓ tests/cli.test.ts       (70 tests)
 ✓ tests/runner.test.ts    (12 tests)
 ✓ tests/inject.test.ts    (11 tests)
 Test Files  12 passed (12)
      Tests  178 passed (178)
```

### Bugs found / fixed
One bug surfaced during the test run and was fixed before logging.

**Bug #1 — `--top -1` used a different error-message prefix than
`--top 0`, breaking `grep` on stderr.**
- *Symptom:* The "rejects 0/-1/2.5/abc" test iterated four bad values
  through a single `expect(...).toContain('--top must be a positive
  integer')`. `-1` failed that assertion with the prior message
  `--top requires a positive integer value`.
- *Root cause:* `parseArgs` treats any `-`-prefixed lookahead as a
  boolean flag (this is the `--` / `-h` shorthand logic, shared with
  every other flag in the CLI), so `--top -1` lands in the
  non-string branch with `flags.top === true`, BEFORE `parseTop` ever
  sees `-1`. The non-string branch had a different error phrasing
  than `parseTop` itself, so `-1` and `0` diverged on what error the
  user saw.
- *Fix:* Unified the non-string branch to start with "--top must be a
  positive integer (no value provided)", matching `parseTop`'s prefix.
  Single grep on stderr now catches both paths.
- *Why not fix parseArgs to accept negative-number lookaheads?*
  Because `--filter -1` and `--sort -duration-asc` would suddenly
  gain new parse behavior too, and the blast radius for 60+ existing
  tests wasn't worth it for a flag that MUST reject negatives anyway.
  Unifying the error message at the cmdReport boundary is the minimal
  fix.

Edge cases preempted by tests / design (no bugs, just defensive paths):

- **`indices.slice(0, top)` correctly handles top > indices.length.**
  `Array.prototype.slice` returns a copy of the available range when
  end overshoots; no `Math.min`-style clamp needed. The `--top 99` on
  a 3-spec report test pins the contract.
- **`--top` after filter emptied indices is still safe.** The
  `indices.length === 0` branch for `(no specs match --filter ...)`
  fires BEFORE `slice`, so an empty `indices.slice(0, N)` never
  reaches the rendered path. Verified by mental pipeline; no test
  added because filter-empty was already covered in iter 10.
- **`payload.top = top` is set AFTER `payload.filter` and
  `payload.sort`** so the rendered JSON stays `{ ...envelope, filter,
  sort, top }`. Every prior iteration's consumers (iter-9 `--all`,
  iter-10 `+filter`, iter-11 `+sort`) see their layout as a strict
  prefix of the current one.
- **`top` is declared `number | undefined`** (not `number | 0`) so the
  JSON envelope's "only emit when set" rule threads through the type
  system — a raw `number` default would make `if (top)` treat 0 the
  same as "not set", which would have been the wrong semantics even
  though we reject 0 at parse time.
- **Exit code via `report.failed === 0` is unchanged.** `--top`
  doesn't even reach the exit-code logic; proved by the first test
  where `--top 2` hides the failing spec from stdout but exit code is
  still 1.

### Next iterations (when work resumes)
1. Phase 1/2 — Electron shell + `<webview>` preload (still GUI-required,
   not testable in this loop).
2. Phase 4 — Monaco editor renderer binding (still needs React +
   browser).
3. `auto-test record` — still needs a headless browser driver; could
   be split into a `playwright-codegen` JSON-line import step.
4. `run --report <file>` could grow `--open-html-report` or
   `--trace-on-fail` toggles once a Playwright sandbox install is
   available. Same wiring (extraArgs + env) — just different flags.
5. `report --filter` could grow `--invert` (show specs that DON'T
   match) or shorthand aliases (`--failed-only` → `--all --filter
   failed`). Both trivial; defer until a consumer asks.
6. `report --sort` could grow `name` (alphabetical) or `status`
   (group by passed/failed/skipped) keys when a non-flake-triage
   workflow surfaces.
7. `report --top` could grow `--top-pct <P>` (keep the slowest P% of
   specs) as an alternative to fixed N — useful when spec counts vary
   across CI runs. Would slot in next to `--top` as `Math.ceil(count
   * P / 100)`. Defer until a consumer asks.
8. `report --all --summary-only` (or `--quiet`) — suppress per-spec
   bodies and print only the footer roll-up. Pairs well with `--top`
   for CI dashboards that only want the totals. Trivial; defer.

---

## 2026-04-17 — Iteration 13: `report --all --summary-only` (CI dashboard mode)

### Scope decision
Picked item 8 from iteration 12's "next" list — the smallest tractable
slice that still ships a real user-visible flag without needing a
browser sandbox or new external dependency. Goal: let CI dashboards
collect just the rolled-up totals (`N passed, N failed, N skipped, T
ms`) without paying for the full per-spec render. Rationale matches
`--top` (iter 12): output volume is the bottleneck for CI consumers
that pipe `report --json` into a downstream aggregator.

### Design choices
- **`--summary-only` is gated on `--all`**, same shape as `--filter`,
  `--sort`, and `--top` (iters 10–12). `--spec` already shows a single
  spec — there's no "summary" semantic in that mode.
- **Footer reflects the FULL report**, not the filtered/sorted/topped
  subset. Same invariant as `--filter` (iter 10): the footer is a
  roll-up of the underlying report, not a recount of what was
  rendered. A test pins this for the `--filter failed --summary-only`
  combo.
- **Text mode prints just the footer line — without the leading blank
  line** that `renderReportText` emits before the footer (the blank
  line exists to separate footer from the per-spec bodies; in
  summary-only mode there are no bodies to separate from).
- **JSON mode emits `specs: []` plus a `summaryOnly: true` marker**
  rather than dropping the `specs` field. Reasoning: `specs` is part
  of the iter-9 envelope contract that downstream parsers use to
  discriminate `--all` vs single-spec output. Dropping it would force
  consumers to special-case the schema; emitting `[]` keeps the shape
  stable. The `summaryOnly: true` marker tells consumers "we
  intentionally omitted bodies" so they don't infer "report had zero
  specs" (which would be `totalSpecs: 0`).
- **`summaryOnly` is omitted from JSON when the flag is not passed**,
  same pattern as iter-10 `filter`, iter-11 `sort`, and iter-12 `top`.
  Byte-stable for prior consumers.
- **Field order in JSON**: `summaryOnly` is appended LAST (after
  `top`), keeping every prior iteration's payload as a strict prefix
  of the current one.
- **Exit code uses `report.failed === 0`**, same as the rest of
  `--all`. `--summary-only` is a display flag; it doesn't change
  pass/fail semantics.

### Features added
| Module | File | Notes |
|---|---|---|
| `cmdReport --summary-only` wiring | `src/cli.ts` | Boolean flag, gated on `--all`. Text path: prints just the footer. JSON path: empties `specs` and adds `summaryOnly: true`. |
| Usage block | `src/cli.ts` | `report` line gains `[--summary-only]` with the `(only with --all)` qualifier |

### Tests added
| File | Tests | Coverage |
|---|---|---|
| `tests/cli.test.ts` | +5 | `--summary-only` text: footer present, no spec titles, no `--- spec` headers, no `[OK]`/`[XX]` markers. `--summary-only --json`: `specs: []`, `summaryOnly: true`, `summary` reflects full report (1/1/1/600ms), `totalSpecs: 3`. `--all --json` without flag: `'summaryOnly' in payload === false` (byte-stable). `--filter failed --summary-only`: footer still shows full report counts (`1 passed, 1 failed, 1 skipped`), no spec body. `--summary-only` without `--all`: exit 1 with "--summary-only requires --all". |

### Test runs

**Run #1 — `npx tsc --noEmit`** — compiles cleanly, no type errors.

**Run #2 — `npm test` (vitest run)** — all 183 tests green (was 178, +5 new).

```
PASS (183) FAIL (0)
```

### Bugs found / fixed
None this iteration. The flag plugged into the existing
`indices`-pipeline cleanly because iters 10–12 had already
established the pattern of "compute indices, then branch on
emitJson". `--summary-only` just adds a third branch that ignores
indices entirely and prints the footer.

Edge cases preempted by tests / design (no bugs, just defensive paths):

- **`--summary-only` does NOT short-circuit the indices pipeline.**
  We still compute filter/sort/top so that any of THEIR validation
  errors fire normally. The flag only changes RENDERING. This means
  `--summary-only --top abc` still produces the "--top must be a
  positive integer" error rather than masking it.
- **`--summary-only` with no `--filter` and zero specs**:
  `report.totalSpecs === 0` is handled BEFORE the `wantAll` branch
  (since iter 9), so summary-only never reaches the empty-report
  case. The existing `(no specs in report)` text and `{specs: []}`
  JSON payload still fire — they're a different code path.
- **`--summary-only --filter failed` when filter eliminates everything**:
  the `(no specs match --filter ...)` branch is reachable only in the
  non-summary path. In summary-only mode, no spec-body branch fires,
  so the empty-filter notice is correctly suppressed — the footer is
  the whole point of the flag.
- **JSON `specs: []` vs the iter-9 zero-spec payload**: the zero-spec
  payload is `{suite, totalSpecs: 0, specs: []}` (no `summary`,
  `filter`, `sort`, `top`, `summaryOnly`). The summary-only payload
  is `{suite, totalSpecs: N, summary: {...}, specs: [], summaryOnly:
  true}`. `totalSpecs` and the presence of `summary` discriminate
  them — a consumer can tell "report was empty" from "report had
  specs but we elided them" without ambiguity.
- **Footer text vs JSON parity**: text mode prints the same four
  numbers (`passed`, `failed`, `skipped`, `totalDurationMs`) that
  JSON mode puts into the `summary` object. No drift.

### Next iterations (when work resumes)
1. Phase 1/2 — Electron shell + `<webview>` preload (still GUI-required,
   not testable in this loop).
2. Phase 4 — Monaco editor renderer binding (still needs React +
   browser).
3. `auto-test record` — still needs a headless browser driver; could
   be split into a `playwright-codegen` JSON-line import step.
4. `run --report <file>` could grow `--open-html-report` or
   `--trace-on-fail` toggles once a Playwright sandbox install is
   available.
5. `report --filter --invert` (show specs that DON'T match) or
   shorthand aliases (`--failed-only` → `--all --filter failed`).
   Both trivial; defer until a consumer asks.
6. `report --sort name` (alphabetical) or `--sort status` (group by
   passed/failed/skipped) for non-flake-triage workflows.
7. `report --top-pct <P>` (keep the slowest P% of specs) as an
   alternative to fixed N. `Math.ceil(count * P / 100)` next to
   `--top`. Defer until a consumer asks.
8. `report --all --summary-only --top N` is currently a quiet no-op
   (top is computed but indices are unused in summary-only mode).
   Could either reject the combo or have summary-only's footer
   reflect the topped subset. Defer until a consumer expresses a
   preference — current behavior is the safest "footer = full report"
   invariant.
9. Pair `--summary-only` with a `report --diff <baseline.json>` mode
   (compare current vs baseline summary, exit 1 on regression). Would
   need a small `diffSummaries` helper. Useful for CI gating.

---

## 2026-04-17 — Iteration 14: `report --all --filter --invert` (exclude-match mode)

### Scope decision
Picked item 5 from iteration 13's "next" list — a small, composable
add-on to the existing `--filter` flag. The user value: "show me
everything that's NOT passed" without having to enumerate
`failed,skipped,timedOut,interrupted`. Same motivation as grep's `-v`:
inversion is cheaper than listing all the complements, and stays
correct as new statuses are added to the filter set.

### Design choices
- **`--invert` is a boolean flag, not a key-value**. It's purely a
  semantic toggle on `--filter`. No argument to parse; presence ⇒ true.
- **`--invert` requires BOTH `--all` and `--filter`** — it's a
  modifier on an existing filter, not a standalone selector. Error
  messages:
  - `--invert requires --all` (if `--all` is missing)
  - `--invert requires --filter` (if `--all` is present but no filter)
  The `--all` check runs first because `--filter` itself is gated on
  `--all`, so the `--filter` error would eclipse the `--invert` one
  otherwise. Test pins that `--invert` without `--all` returns a
  `/requires --all/` stderr (either flag's error is acceptable).
- **Invert is woven into the existing `filter` reducer** — one line:
  `const matches = filter.includes(s.status); return (invert ? !matches : matches) ? i : -1;`
  No separate code path; invert doesn't bypass filter validation.
- **Sort / top / summary-only all compose unchanged** — they operate
  on the post-filter `indices` array, and invert just flips which
  indices land in that array. Test pins the four-flag combo
  `--filter passed --invert --sort duration --top 1` producing
  `[first spec]` (the slowest non-passed spec).
- **Empty-invert message**: `(no specs match --filter passed --invert)`
  — reuses the existing "no specs match" branch with a `--invert`
  suffix. Keeps the user's mental model consistent: the message names
  the flags that produced the empty set.
- **JSON envelope: `invert: true` is only present when the flag is
  set**. Same byte-stable pattern as `filter` / `sort` / `top` /
  `summaryOnly` (iters 10–13). A test pins that `--filter passed`
  (without invert) produces an envelope with `"invert" not in parsed`.
- **Footer / exit code / `totalSpecs` unchanged**. Invert is strictly
  a display-list transform on the full report. A `--filter passed
  --invert` run against a report with only passing specs still exits
  0 (no failures in the full report), even though the display list is
  empty. Test pins this.

### Files touched
- `src/cli.ts` — USAGE string +1 line; parse `args.flags.invert === true`
  with two gating errors; fold invert into the `indices` reducer;
  append `invert: true` to the JSON payload; append ` --invert` to
  the empty-match notice.
- `tests/cli.test.ts` — new `describe('runCli report --all --filter
  --invert', ...)` block with 8 tests: basic text-mode, JSON mode with
  `invert: true`, byte-stability when absent, empty-invert notice,
  compose with sort+top, reject without --filter, reject without
  --all, multi-status invert.

### Test results
183 → 191 passing (+8). No regressions in earlier suites. TypeScript
compilation clean.

### Why this composed so cleanly
Iter 10 set the filter pipeline's shape (produce indices from
statuses, feed downstream). Iters 11–13 established that every new
flag either (a) transforms `indices` further or (b) changes rendering.
`--invert` is the simplest possible case of (a): flip the predicate
on the boolean that filter already computes. Zero new validation code
paths, zero new state, zero new error classes. The only surface-level
change is that empty-match text and JSON envelope need to distinguish
"filter matched nothing" from "invert-of-filter matched nothing" —
handled by suffixing ` --invert` to the notice and adding `invert:
true` to the envelope.

### Edge cases preempted by tests / design (no bugs, just defensive paths)

- **`--invert` without `--filter`**: rejected at parse time rather
  than silently running as a no-op (would render the full report and
  hide the user's mistake). The error names both flags so the user
  knows which to add.
- **`--invert` without `--all`**: caught by whichever gate fires
  first (`--filter requires --all` or `--invert requires --all`).
  Test uses `/requires --all/` regex — either wording satisfies. We
  don't need to care which error the user sees as long as the exit
  code is 1 and the message points at `--all`.
- **Empty invert set (every spec matches filter)**: the `(no specs
  match ...)` branch already handles filter-eliminates-everything;
  we just suffix ` --invert` to the notice. Footer still prints; exit
  code still follows `report.failed`, not the display count.
- **Invert + sort + top**: sort and top operate on the post-invert
  indices — verified by test. Invert doesn't sneak past them.
- **Invert + summary-only**: summary-only mode ignores the per-spec
  indices entirely, so invert is a quiet no-op in that mode (same as
  `--top` in summary-only — iter 13's edge case #8). Not explicitly
  tested; consistent with the iter-13 invariant that summary-only's
  footer reflects the full report.
- **JSON byte-stability**: `"invert"` is only present when the flag
  is set. Matches the byte-stable pattern for every other optional
  flag. A downstream diff tool won't see spurious `invert: false`
  keys.
- **Multi-status invert**: `--filter passed,failed --invert` excludes
  BOTH passed and failed — i.e., inversion is "not in the set", not
  "not equal to the union". Test pins this to lock the semantics.

### Next iterations (when work resumes)
1. Phase 1/2 — Electron shell + `<webview>` preload (still GUI-required,
   not testable in this loop).
2. Phase 4 — Monaco editor renderer binding (still needs React +
   browser).
3. `auto-test record` — still needs a headless browser driver; could
   be split into a `playwright-codegen` JSON-line import step.
4. `report --failed-only` shorthand → `--all --filter failed`.
   Trivial alias now that `--filter` is battle-tested.
5. `report --sort name` (alphabetical) or `--sort status` (group by
   passed/failed/skipped) for non-flake-triage workflows.
6. `report --top-pct <P>` (keep the slowest P% of specs) as an
   alternative to fixed N.
7. `report --diff <baseline.json>` (compare current vs baseline
   summary, exit 1 on regression). Would need a small `diffSummaries`
   helper. Useful for CI gating.
8. `report --all --summary-only --top N` — reject, or have
   summary-only's footer reflect the topped subset. Defer until a
   consumer expresses a preference.
9. `report --all --count` — print just `N` (the number of specs that
   would be rendered) and exit. Useful for shell pipelines that only
   want to know "does filter X match anything?".

---

## Iteration 15 — `report --failed-only` shorthand (the iter-14 #4 follow-up)

### What shipped
A one-flag UX shortcut for the most common report-triage workflow:
`auto-test report suite.json report.json --failed-only` is exactly
equivalent to `--all --filter failed`. No new pipeline code; the flag
just sets `wantAll = true` and `filter = ['failed']` at parse time
and lets every downstream stage (sort/top/JSON/footer/exit code) run
unchanged.

### Design choices

- **Pure shorthand, not a parallel flag**. `--failed-only` does NOT
  add a `failedOnly: true` key to the JSON envelope. The byte-stable
  pattern from iters 10–14 says "every flag the user actually sets
  shows up in the envelope," but a shorthand expands at parse time
  and is invisible to downstream consumers — that's what makes it a
  shorthand. A test pins this by asserting `--failed-only --json` and
  `--all --filter failed --json` produce **byte-identical stdout**.
  This means CI scripts can be written once against the canonical
  form and humans can use the shorthand without diverging output.

- **Mutually exclusive with `--filter`, `--spec`, `--invert`** —
  caught at parse time with named errors:
  - `--filter`: shorthand IS a filter; combining two filter sources
    is ambiguous (which wins?). Reject explicitly with a message
    that explains the relationship: `--failed-only is a shorthand
    for --filter failed`.
  - `--spec`: same `--spec`-vs-`--all` exclusivity that already
    exists for `--all`. Caught earlier with a `--failed-only`-aware
    message instead of falling through to a generic
    `--spec and --all are mutually exclusive` (which would be
    technically true but confusing — the user never typed `--all`).
  - `--invert`: `--failed-only --invert` would mean "show non-failed",
    which is useful but is its own semantic — not a shorthand.
    Defer; if a user wants it, they can write
    `--all --filter failed --invert` explicitly.

- **No `--failed-only` requires `--all` gate**. Unlike the other
  flags (filter/sort/top/summary-only/invert), `--failed-only`
  IMPLIES `--all`. Any user who typed `--failed-only` clearly wants
  the filtered view; making them also type `--all` would be cargo
  culting the original requirement.

- **Composes with sort, top, summary-only, json** without any
  changes to those code paths — verified by the sort+top
  composition test. This is the payoff for treating `--failed-only`
  as syntactic sugar over the existing pipeline rather than a new
  branch in the renderer.

### Files touched
- `src/cli.ts` — USAGE string +1 line; new `failedOnly` boolean with
  three exclusivity gates; `wantAll = args.flags.all === true ||
  failedOnly`; `filter = ['failed']` when `failedOnly` is set
  (taking precedence over the no-`--all` filter check, which can't
  fire because `wantAll` is true).
- `tests/cli.test.ts` — new `describe('runCli report --failed-only')`
  block with 7 tests: basic text-mode rendering, JSON byte-stability
  vs `--all --filter failed`, empty-match notice (zero-failures
  report still exits 0), composition with sort+top, and three
  rejection tests for the mutually-exclusive flags.

### Test results
191 → 198 passing (+7). No regressions. TypeScript compilation clean.

### Why this iteration was small
This was scheduled in iter 14's "next iterations" list as item #4
("trivial alias now that --filter is battle-tested"). The point was
to verify the iter-10-through-14 pipeline truly is composable: if
`--failed-only` had needed any code in the renderer, sort, top, or
JSON serializer, that would have signaled a leak in the abstraction.
It didn't — the only changes outside parse-time validation were
literally one line in USAGE. The pipeline holds.

### Edge cases preempted by tests / design (no bugs, just defensive paths)

- **Empty-match notice when no failures exist**: shows
  `(no specs match --filter failed)` — NOT `(no specs match
  --failed-only)`. The notice references the canonical filter form
  because that's what the pipeline actually evaluated. A test pins
  this; it's mildly surprising but consistent with the
  byte-identity invariant (the user could have typed either form
  and gotten the same output).
- **Exit code 0 when zero failures**: matches the existing rule —
  exit code follows `report.failed` from the FULL report, not the
  rendered subset. Empty `--failed-only` against an all-green
  report still exits 0.
- **`--failed-only --filter passed` rejection wording**: the error
  message names BOTH flags explicitly so the user knows which to
  drop, rather than generically saying "conflict."
- **`--failed-only --spec 1` rejection**: caught by the
  `--failed-only` gate first, before the generic `--spec`/`--all`
  check would fire. This gives a clearer error message
  (`--failed-only and --spec are mutually exclusive`) than the
  fallthrough would.

### Next iterations (when work resumes)
1. Phase 1/2 — Electron shell + `<webview>` preload (still GUI-required,
   not testable in this loop).
2. Phase 4 — Monaco editor renderer binding (still needs React +
   browser).
3. `auto-test record` — still needs a headless browser driver.
4. `report --sort name` (alphabetical) or `--sort status` (group by
   passed/failed/skipped).
5. `report --top-pct <P>` (keep the slowest P% of specs).
6. `report --diff <baseline.json>` (compare current vs baseline,
   exit 1 on regression). Useful for CI gating.
7. `report --all --count` — print just `N` and exit.
8. Consider `report --passed-only` and `report --skipped-only` if
   those workflows emerge. They'd follow the exact same shorthand
   pattern as `--failed-only` (one-line addition each).
