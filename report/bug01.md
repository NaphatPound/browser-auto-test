# bug01: `parsePlaywrightReport()` misreports retried specs as failed

## Severity
High

## Affected code
- `src/reporter.ts:65-71`
- `src/reporter.ts:96-112`

## Summary
`parsePlaywrightReport()` flattens every entry in `tests[].results` and rolls the final spec status up with `statuses.some((s) => s === 'failed')`. When a Playwright spec fails on the first attempt and passes on retry, the parser still marks the spec as `failed`.

The same flattening also duplicates step results across attempts, so `correlateSteps()` can no longer align recorded steps with the final execution.

## Why this is a bug
Playwright retries are represented as multiple result objects for the same logical spec. In the current implementation:

- `collectSpecs()` reads all attempts with `tests.flatMap((t) => t.results ?? [])`
- `rollupStatus()` returns `failed` if any attempt failed
- `stepResults` concatenates steps from every attempt instead of the final one

That makes the CLI report incorrect for flaky tests that recover on retry.

## Reproduction
Input report shape:

```json
{
  "suites": [
    {
      "specs": [
        {
          "title": "retry example",
          "tests": [
            {
              "results": [
                {
                  "status": "failed",
                  "duration": 50,
                  "error": { "message": "first try failed" },
                  "steps": [
                    { "title": "page.goto(/)", "duration": 10 },
                    { "title": "page.click(#submit)", "duration": 40, "error": { "message": "first try failed" } }
                  ]
                },
                {
                  "status": "passed",
                  "duration": 30,
                  "steps": [
                    { "title": "page.goto(/)", "duration": 10 },
                    { "title": "page.click(#submit)", "duration": 20 }
                  ]
                }
              ]
            }
          ]
        }
      ]
    }
  ]
}
```

Observed result from the current parser:

- `failed = 1`
- `passed = 0`
- `spec.status = "failed"`
- `spec.steps.length = 4`

Expected behavior:

- The spec should be reported from the final attempt, or retries should be modeled explicitly.
- A recovered retry must not be counted as a hard failure in the default summary.
- Step correlation should use one attempt, not a concatenation of all retries.

## User impact
- `auto-test run ... --report ...` can print `FAIL` even when the spec eventually passed on retry.
- `auto-test report ...` can overcount failures and produce misleading summaries.
- Step-by-step output can show duplicate actions and mismatched error attribution.

## Recommended fix
- In `collectSpecs()`, select the final attempt per test when computing `status`, `error`, and `steps`.
- If retry history matters, expose it as separate metadata instead of folding it into the main step list.
- Add a unit test covering `results: [failed, passed]` and assert that the parsed spec is not reported as failed.
