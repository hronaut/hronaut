# Source logpoint discovery (#340)

This is discovery groundwork, not a Hronaut instrumentation feature or an
approved production design. No probe API, UI, permission, or automatic probing
is added. The experiment uses privileged test-harness access only on a
disposable localhost page.

## Evidence and reproducible experiment

A standalone Chromium experiment mapped a synthetic TypeScript return statement
at `fixture.ts:3:2` to generated JavaScript `4:4`, captured its local value
without pausing, and stopped output after removal. That does not establish
Electron or application-level coexistence.

`tests/integration/logpoint-discovery.e2e.ts` exercises the actual Hronaut
Electron debugger attachment alongside the existing code-coverage controller.
Its fixture uses that known generated location; it is not a general source-map
resolver. Run it through the existing focused Docker integration runner:

```sh
npm run test:integration:docker:focused -- tests/integration/logpoint-discovery.e2e.ts
```

The case writes a bounded `LOGPOINT_DISCOVERY_RECEIPT` to the test log and attaches
JSON to the test result. Only a successful actual run establishes its runtime
findings. It checks non-pausing local observation, explicit removal, coverage
completion, navigation behavior, and intentional expression side effects. Its
100-call elapsed time is a single synthetic measurement, not a benchmark or a
promise of low overhead. An eight-value display buffer bounds retained values;
it does **not** bound expression execution, emitted events, or page overhead.

## Current integration concerns

- `profiling-controller.ts` enables `Debugger` for coverage and disables it when
  stopping/clearing coverage. A second owner cannot assume its probes survive.
- `tabs-manager.ts` serializes debugger commands with `withDebugger` and refuses
  competing MCP debugger actions while DevTools is open. A standalone CDP
  client does not prove safe coexistence with those application rules.
- URL-based probes may apply again after navigation. Navigation or ownership
  changes must revoke old authority explicitly; matching a URL is not consent.
- A logpoint condition is executable code. The synthetic expression deliberately
  increments page state. It is not inherently read-only, even if it returns
  `false` and never pauses execution.

## Recommendation: keep product implementation gated

Before proposing a production slice, demonstrate coordinated domain lifetime
and cleanup in Electron across coverage, DevTools, detachment, cancellation,
navigation and window destruction. Reuse existing execution approval and
workspace/tab/origin authority; the privileged fixture does not prove those
boundaries. Verify untrusted source maps without arbitrary filesystem/network
access, stale or ambiguous mappings, missing maps, and early-execution loss.

Bound execution frequency and lifetime as well as retained output, measure
representative overhead, and report dropped output honestly. Test isolation from
other tabs and prove removing a probe prevents further side effects. Compare
actual operator steps against normal DevTools logpoints and the available fork;
no workflow advantage or broad demand has been established by this experiment.
Do not expand this discovery directly into a step debugger.
