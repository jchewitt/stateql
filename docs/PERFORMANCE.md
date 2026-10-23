# Base-client scale and lifecycle measurements

**B7c remains open.** This is synthetic measurement tooling and an initial desktop baseline, not a production workload, real application trial or proof of memory safety. No package runtime is optimized by this slice. The [application trial](APPLICATION-TRIAL.md) and [final API decision](BASE-API-AUDIT.md) remain separate gates.

## Reproduce

```sh
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm measure:readiness
```

The command rebuilds core/GraphQL, runs a bounded Node subprocess, bundles the same public-API workload for Chromium, and writes `.artifacts/readiness/latest.json`. Browser bundle/metafile artifacts go to `output/playwright/readiness/`. Neither command publishes anything or overwrites the recorded baseline in `docs/measurements/`. Each Node run and browser profile has a five-minute limit; failure or timeout fails the command instead of producing a success report. Run it without concurrent builds, tests or other deliberate CPU load.

The report identifies the source commit, dirty state, runtime-source digest, harness-file hashes, browser-bundle hash, manifest versions and environment. Main contains unpublished B4–B7a changes while manifests still carry alpha.5; these measurements are not measurements of registry alpha.5. The baseline was collected before committing the harness, so `sourceDirty: true` is intentional. Use its hashes and the reviewed source to identify the harness, not a claimed clean release tag.

## What is measured

- **Schema and operation planning:** 32, 128 and 512 fields on a generated object type, selecting 2, 8 or 24 fields. Schema construction, binding and full/narrow operation preparation are timed independently. Two warmups precede five individual samples. Fixture construction and post-call validation are outside each timer; these are warmed measurements, not cold startup.
- **Record refresh:** 100, 1,000 and 5,000 records in Node; 100 and 1,000 in Chromium. Eight selected integer fields, one wide subscriber and two narrow peers share the same address. Each pair refreshes all fields, then changes all fixture values and refreshes only `f0`. One warmup pair precedes three measured pairs in Node or five in Chromium. Order is fixed and results are not randomized comparative performance claims.
- **Refresh timing boundary:** wall time includes planning, in-process GraphQL execution, transport validity guards, decoding, shared commits and subscribed projections. Local GraphQL execution is timed separately; subtraction leaves a broad client/scheduling remainder, not an isolated cache or planner measurement. There is no HTTP, response JSON serialization or Angular rendering. Fixture changes, byte counting and post-read record assertions are outside timing. Bytes are UTF-8 response-body JSON, excluding headers and request bodies.
- **Correctness:** every refresh checks selected values, preserved siblings, shared consumer updates and stable membership/order. Unrelated subscriber snapshots retain identity and receive no notification on narrow refresh. Assertions fail the measurement if those contracts fail.
- **Browser lifecycle/heap:** a separate page lifetime holds one client and reacquires three scopes of 1,000 records, with two owners each and zero inactive retention. Three warmup batches precede five measured acquire/release batches. Reusing the same scopes verifies a new initial acquisition after eviction. Full GC precedes each baseline/active/released/disposed sample. Samples report the whole isolate's used/allocated JS heap, embedder heap and backing storage, plus harness-owned counters. Those counters are not internal store instrumentation. No historical handle, response or snapshot is retained by the harness between batches.
- **CPU sensitivity:** fresh browser contexts run at 1× and CDP 4× CPU throttling. This approximates reduced CPU availability on the same machine; it does not reproduce physical mobile hardware, limited RAM, network loss, battery behavior or another browser engine.

The raw report preserves all observations and min/median/max in milliseconds. Small sample counts do not support tail-percentile or statistical-confidence claims. GC and JIT can move observations; heap plateaus in this bounded test cannot establish that every lifecycle or application is leak-free.

## Acceptance and next investigation

### October 23 desktop baseline

The [raw baseline](measurements/b7-readiness-baseline.json) uses unchanged runtime source at `43a3766e61fe34c87f5f338663f7fd2b1af933b4`, Windows x64, Ryzen 9 7900X, roughly 32 GB RAM, Node 24.2.0 and Chromium 156.0.8078.4. It contains five planning samples, three Node refresh pairs and five browser refresh pairs per dimension/profile.

| Environment               | Records | Full refresh median (ms) | Single-field refresh median (ms) |
| ------------------------- | ------: | -----------------------: | -------------------------------: |
| Node                      |     100 |                    56.05 |                            35.78 |
| Node                      |   1,000 |                 1,080.54 |                           418.94 |
| Node                      |   5,000 |                15,936.23 |                         3,621.83 |
| Chromium, 1×              |     100 |                    39.40 |                            23.10 |
| Chromium, 1×              |   1,000 |                   716.90 |                           274.10 |
| Chromium, 4× CPU throttle |     100 |                   190.20 |                           113.20 |
| Chromium, 4× CPU throttle |   1,000 |                 3,256.80 |                         1,267.40 |

**Finding PERF-01: large-list refresh latency blocks readiness.** The full 5,000-record Node refresh spends a median 12.21 ms in local GraphQL execution versus 15,936.23 ms overall. Separately, preparation of 24 selected fields in the 512-field schema takes a median 0.21 ms. These measurements justify profiling client work; they do not identify a particular internal function or establish a complexity class. Even the unthrottled 1,000-record browser scenario takes hundreds of milliseconds without network or UI rendering. A narrower response reduces work but does not make this workload ready for responsive application use.

Whole-isolate post-GC used heap at 1× was 2.87 MB at the warmed baseline, 30.54–30.56 MB while three scopes were active, 2.89–2.91 MB after releasing each batch and 2.82 MB after client disposal (decimal MB). At 4×, the corresponding ranges were 2.88 MB, 30.55–30.56 MB, 2.90–2.92 MB and 2.83 MB. Every released sample had zero harness-owned handles/subscriptions and zero in-flight fixture transport calls; 21 same-scope reacquisitions were verified per profile. This bounded run did not show accumulating retained data between batches. It does not establish an active-cache memory budget, internal timer counts, long-session behavior or a general absence of leaks.

Timing and memory numbers are evidence, not automatically accepted budgets. Do not increase a budget to make a slow baseline pass. Establish application responsiveness and retained-memory budgets on the intended workload/device after profiling and rerunning any fixes.

The large-list refresh cost is the first investigation target. Profile full and narrow reads separately with the same record dimensions, including operation planning, decoding, generation/coverage validation, commit projection and notification work. Preserve the current correctness assertions and add regression coverage for the actual fix. Optimize compiled operation reuse only if profiling shows it materially addresses the observed cost; a fast preparation microbenchmark does not justify a plan cache by itself.

B7c closes only after the scale finding is resolved or bounded by an explicitly accepted supported workload, repeated lifecycle and memory results are assessed, and a physical lower-powered environment or an explicitly agreed alternative supplies the remaining evidence. B7d must review that evidence before declaring extension readiness. The existing release PR remains batched.
