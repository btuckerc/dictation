# Initial screening — 2026-09-19

These are pre-application CLI experiments, not end-to-end app benchmarks. Raw local artifacts remain in `../dictation-research`.

## Measured environment and method

Apple M2 Max, 96 GB unified RAM, macOS 27.0. Mac connected to AC power.
transcribe.cpp v0.2.3, commit 63a44d9239d610b3908e8a66b384924cd4a77217.
Release build, Metal backend, six CPU threads, Q8_0 weights, English hint,
timestamps disabled. Model revisions and SHA-256 hashes: models/manifest.json.

Three samples: upstream JFK clip (11 s), Samantha TTS technical prompt
(12.255875 s, 175 words/min), and generated digital silence (3 s).
Each configuration received one JFK warmup, then five serial cycles of all
three samples. No parallel ASR, model downloads, or cleanup inference during
the measured ASR runs. The desktop was otherwise in normal use; this is not
an isolated performance lab.

The harness observes elapsed time between flushed CLI JSON records. This
includes per-request file reading/processing and small harness overhead;
it excludes microphone capture, speech detection, GUI rendering, clipboard
insertion, and optional cleanup. Engine-internal timings are retained too.
Five repeated identical clips are a latency probe, not five independent
accuracy examples or a basis for production p95 estimates.

## ASR results

| Configuration                          | Warm technical clip median |   Observed range | Technical terms                                           |
| -------------------------------------- | -------------------------: | ---------------: | --------------------------------------------------------- |
| Parakeet Unified EN 0.6B Q8_0          |                   91.75 ms |   90.26–93.13 ms | Misheard PostgreSQL and idempotent; split AbortController |
| Whisper large-v3-turbo Q8_0            |                  411.97 ms | 410.46–516.55 ms | Similar errors without vocabulary                         |
| Whisper with initial vocabulary prompt |                  419.34 ms | 417.22–475.12 ms | Correct in all five repeats of this one synthetic clip    |

Technical sample source text:

> Refactor the TypeScript API client to use an AbortController. Keep the PostgreSQL migration idempotent. Do not change the OAuth callback URL. Add a regression test for the null user ID.

Vocabulary prompt: `Technical vocabulary: TypeScript, API, AbortController,
PostgreSQL, idempotent, OAuth, URL, null, user ID.`

The glossary intentionally contains the expected terms. This demonstrates
context biasing, not generalization to unseen technical vocabulary. TTS may
pronounce identifiers unnaturally; do not extrapolate these errors to the user.

Warm JFK medians: Parakeet 77.47 ms; Whisper 388.31 ms.
Silence: Parakeet empty; Whisper emitted `you`, or `Thank you.` with vocabulary.
These runs omit VAD: the app must reject silence before calling ASR.

Maximum resident set reported by macOS time for the original runs: Parakeet
885,424,128 bytes (~844 MiB), Whisper 1,112,227,840 bytes (~1,061 MiB).
This is CLI process RSS, not complete app RAM or a complete GPU-memory measure.

First-ever Parakeet process reported 9.68 s load and 9.88 s to header. A later
fresh process reported 280 ms model load and 0.39 s total including the JFK
transcription. This establishes a substantial first-use versus cached-restart
difference; it does not isolate compilation, filesystem caching, or each cause.
Whisper initially reported 351 ms load, after Parakeet had already initialized
the runtime. These are not comparable pristine cold-start measurements.

## Cleanup screening

Five synthetic text-only cases cover fillers, spoken correction, negation,
identifiers/paths, and quoted adversarial instructions. Same conservative
instructions for both providers; greedy or temperature-zero generation.

- Nous, already-loaded Ornith-1.5-9B-Q5_K_M: 0.24–0.60 s wall time including
  network. Manual review found intended instructions preserved in these five
  cases. It kept some spoken numbers as words. No concurrency/load benchmark.
- Apple's FoundationModels system model: 0.46–1.74 s. Several outputs replaced
  prose instructions with code or discarded constraints. This configuration
  fails the technical-cleanup screening. Prompt tuning was not exhausted.

Applying nous cleanup to actual ASR output did NOT reliably repair recognition
errors. Adding vocabulary corrected some names but left `item potent` wrong.
An explicit phonetic-repair instruction also left that error. Accurate input
transcription is necessary; cleanup cannot be assumed to recover missing intent.

Nous requests used the already-loaded model, without service changes or model
swaps. Local LLM cleanup using other downloadable models was not tested.

## Primary sources

- https://github.com/cjpais/Handy/releases/tag/v0.9.7
- https://github.com/cjpais/Handy/blob/v0.9.7/src-tauri/src/managers/transcription.rs
- https://handy.computer/docs/post-processing
- https://handy.computer/docs/paste-methods
- https://github.com/handy-computer/transcribe.cpp/tree/v0.2.3
- https://github.com/Beingpax/VoiceInk
- https://tryvoiceink.com/docs/vocabulary
- https://tryvoiceink.com/docs/custom-models
- https://github.com/Beingpax/VoiceInk/blob/v2.20/BUILDING.md
- https://github.com/altic-dev/FluidVoice (Fluid Intelligence runtime is private)
- https://github.com/FluidInference/FluidAudio (Core ML alternative, not benchmarked here)
- https://developer.apple.com/documentation/FoundationModels/generating-content-and-performing-tasks-with-foundation-models

## Integration smoke check

The exact app legacy-mode prompt and `reasoning_effort: none` request were sent to the existing nous endpoint with a synthetic technical transcript. It returned cleaned prose preserving TypeScript, PostgreSQL, idempotent, OAuth, and the negation in 1.434 seconds. This was one request during development, not a latency benchmark or a load test.
