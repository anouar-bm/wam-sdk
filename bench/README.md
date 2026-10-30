# Benchmarks

Measure what the SDK costs, and compare two builds of it. Timing never fails
a build. Only wrong audio output does.

```sh
npm run bench:micro                       # Node: ring buffers, parameter interpolator
npm run bench:browser                     # browsers: this checkout only
node bench/run.mjs --base ../other-sdk    # this checkout vs another built checkout
node bench/compare.mjs before.json after.json
```

Browsers come from Playwright (`npx playwright install chromium firefox`).
On macOS 27, Playwright's Firefox needs `CFFIXED_USER_HOME=/tmp/ffhome`
([microsoft/playwright#42768](https://github.com/microsoft/playwright/issues/42768)).

## What is measured

`browser.html` + `bench.js` render 5 s of stereo audio at 48 kHz in an
`OfflineAudioContext`, from a constant input of 1 through a chain of N nodes:

- **native**: N `GainNode`s. This is the reference, with no SDK involved.
- **WAM**: N instances of the test fixture WAM (`test/browser/fixtures/`) built
  on the SDK under test, optionally fed 500 `wam-automation` events per
  second.

Both run in two page modes:

- **plain**: events travel over MessagePort.
- **isolated**: COOP/COEP is set, events travel over SharedArrayBuffer ring
  buffers, and the timers are finer.

Only `startRendering()` is timed. Creating the nodes is timed separately as
"init", and it includes the cold first instance. After timing, every rendered
sample must equal exactly 1. This keeps the browser from skipping the work and
turns a broken build into an error instead of a fast time.

`micro.mjs` times `WamEventRingBuffer` write+read and
`WamParameterInterpolator.process` in Node, in batches, and checks the event
counts.

## How it is measured

- One page per browser and mode. One discarded warm-up round per SDK, then
  `--rounds` rounds (default 10) that alternate the order of the SDKs, so
  thermal or background drift hits both builds equally.
- The reported cost is the **median**. Min and p90 show the spread. The minimum
  alone rewards lucky samples.
- Cost per node is in **µs of rendering per second of audio**. 1,000,000 means
  exactly real time.
- **WAM overhead** = WAM cost − native cost, per node, in the same browser and
  page mode.
- **candidate/base** is a ratio of medians with a 95% bootstrap interval
  (seeded, so a report can be reproduced from its JSON). A change is called
  faster or slower only when the interval excludes 1.
- The page measures its own `performance.now()` resolution. A case shorter
  than 50 timer steps is flagged ⏱ and its ratio should be ignored. Measured on
  30 Oct 2026: Chromium 100 µs plain and 5 µs isolated; Firefox 20 µs in both.
  Firefox's `privacy.reduceTimerPrecision=false` still leaves a 20 µs clamp.

## Noise

Comparing the SDK at `d425ee7` with an identical separate build of itself
(Apple M4, 10 rounds) called all 28 cases "no clear change". WAM cases
measured within about ±2–5%. The ⏱ cases had much wider intervals (up to
0.42–2.36). Shared CI runners are noisier than a quiet laptop. scikit-image
treats ratios between 0.7 and 1.5 as noise on GitHub Actions.

## What it does not show

- **Real-time behavior.** Offline rendering runs as fast as possible on one
  thread. It says nothing about glitches, latency, or how the main thread keeps
  up. In particular, the SharedArrayBuffer audio→main ring buffer is drained by
  a 100 ms timer on the main thread, which offline rendering outruns.
- **Real plugins.** The fixture's DSP is a multiply, so these numbers are SDK
  overhead, not the cost of a Faust or other DSP.
- **Absolute speed on another machine.** Compare builds measured in the same
  run on the same machine, never numbers from different machines.

## Where it runs

- **Locally,** whenever a change might affect performance.
- **On every merge to `master`:** the new `master` is compared with the
  previous `master` tip in one job, and the report goes to the job summary.
  This follows Firefox, whose `webaudio` benchmark runs after each landing on
  trunk (`run-on-projects: [trunk]` in
  `taskcluster/kinds/browsertime/desktop.yml`) and compares each push with the
  previous ones, rather than running on every patch under review.
- **On a pull request, on demand:** adding the label `run-benchmark` compares
  the PR head with its base before merging. This is the equivalent of
  Firefox's Try perf runs.
- **On release:** the published release is compared with the previous release,
  and the report is attached to the release.

Pushes to PR branches don't run it. A comparison takes a few minutes, and most
changes under review don't touch performance.
