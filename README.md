# Dictation

Private, Mac-first technical dictation, built on [Handy v0.9.7](https://github.com/cjpais/Handy/releases/tag/v0.9.7). Local speech recognition, two presets, and optional text cleanup through an existing inference server. No subscription or new hosted speech service.

- **Fast:** Parakeet Unified English 0.6B, Q8_0.
- **Accurate:** Whisper large-v3-turbo, Q8_0, with your custom vocabulary supplied during recognition.
- **Plain dictation:** offline after models are downloaded.
- **Optional cleanup:** an OpenAI-compatible endpoint, such as nous. Only the cleanup shortcut sends the transcript. Network cleanup has a three-second deadline; errors, empty responses, and timeouts retain the plain transcript and show a notice.

“Accurate” names the vocabulary-aware preset; it is not a promise that it wins on every utterance. [Measured baseline and limitations](docs/benchmark-baseline.md). The CLI screening is encouraging; real microphone accuracy, full recording-to-paste latency, battery use, and non-Mac builds still need acceptance testing.

## Build and install on Mac

Prerequisites: Xcode command-line tools, Rust stable, Bun 1.3.11, Python 3.11+ (for model preparation and evaluation). See [BUILD.md](BUILD.md) for native dependencies on other platforms.

```sh
git clone git@github.com:btuckerc/dictation.git
cd dictation
bash scripts/build-mac.sh
python3 scripts/prepare-models.py
ditto src-tauri/target/release/bundle/macos/Dictation.app /Applications/Dictation.app
open /Applications/Dictation.app
```

The preparation script downloads the two pinned, checksum-verified models into the app's data directory (~1.6 GB). Alternatively download one preset from the app. `--from-cache /path/to/models` reuses verified GGUF files. Models and local recordings are never bundled into the repository.

Grant **Microphone** access for recording and **Accessibility** (called Device Control and Data Access on newer macOS versions) for shortcuts/pasting when macOS prompts. Mac builds require an existing Apple Development or Developer ID Application signing identity. The build script pins the chosen fingerprint in ignored `.local/macos-signing-identity` and refuses to fall back to ad-hoc signing. Set `APPLE_SIGNING_IDENTITY` explicitly if multiple signers are available. Development-signed builds are not notarized distribution builds. See [permission repair and signing](docs/macos-permissions.md). The private fork's updater is disabled: build a new checkout and replace the application to update. Existing application data is separate from Handy under `com.btuckerc.dictation`.

## Use

First launch uses a compact Connect → Prepare → Try it flow, with permission recovery, cancellable model downloads, and an optional live shortcut trial. See [onboarding design and corner cases](docs/onboarding.md).

1. Choose Fast or Accurate in General. Model selection waits for a successful load and is rejected while dictation is busy.
2. Add project names and identifiers to Custom Words. Accurate supplies these to the recognizer; both presets retain Handy's text correction behavior.
3. Default Mac shortcut: **Option+Space** for plain dictation. Push-to-talk/toggle behavior and shortcuts are configurable.
4. Optionally save the existing server URL and model in General → Cleanup. For this setup: `http://nous:8080/v1`, model `Ornith-1.5-9B-Q5_K_M`. Save enables configuration; it does not prove server connectivity. Use **Option+Shift+Space** for cleanup. Plain dictation still works without the server.
5. Review text before sending. Cleanup cannot reliably reconstruct misrecognized terms. History retains transcripts and, according to retention settings, recordings; configure retention in Advanced.

Escape cancels an active operation. The overlay reports recording/transcription/processing state. The pipeline holds the operation until the queued paste completes to prevent a cancelled or delayed operation from inserting into a newer one. OS focus and clipboard behavior still require live testing in your target applications.

## Design

Keep ASR on the dictating device: one resident speech model, Metal acceleration on Apple Silicon, Silero voice activity detection, and configurable model unloading. This avoids a network dependency for the basic interaction and adds no speech-server load to nous. Optional cleanup uses the already-running server without swapping its model.

This is an independent application built on Handy's Rust/Tauri system-webview foundation, preserving its Windows/Linux architecture instead of introducing a separate service or desktop framework. Portability is inherited source support, not a claim of verified releases. Advanced upstream model/provider options remain available; the three-second deadline applies to network cleanup, not the optional Apple system-model path.

## Validation and evaluation

```sh
bun install --frozen-lockfile
bun run build
bun run lint
cargo test --manifest-path src-tauri/Cargo.toml --lib --locked
cargo clippy --manifest-path src-tauri/Cargo.toml --lib --locked
python3 -m unittest discover -s scripts -p 'test_*.py'
bunx playwright install chromium
bunx playwright test tests/dictation-presets.spec.ts tests/onboarding.spec.ts tests/shortcuts.spec.ts
```

[Evaluation guide](docs/evaluation.md): compare Fast and Accurate on the same recordings with word error rate, exact technical-term recall, raw outputs, model hashes, and timing. The example manifest requires your own audio; it does not record your microphone. Negations, corrections, silence, and intent need manual review.

Before daily-use acceptance: real technical prompts in your coding/chat apps; cancel and focus changes; microphone changes and sleep/wake; disconnected/busy cleanup server; idle resource use and warm/cold end-to-end latency. Do not infer these results from synthetic CLI measurements.

## Provenance

Base: Handy `05e0aedd2906f0d82722735f930465950c476b90` (v0.9.7), MIT licensed; copyright retained in [LICENSE](LICENSE). See [original README](README.upstream.md) and [attributions](docs/ATTRIBUTIONS.md). Model licenses are independent and linked in the model catalog. Dictation uses its own 0.1.x version series. Internal package/binary names remain unchanged for compatibility. This is an independent private development fork, not an official Handy release.
