# Dictation

Private, Mac-first technical dictation, built on [Handy v0.9.7](https://github.com/cjpais/Handy/releases/tag/v0.9.7). Local speech recognition, two presets, and optional text cleanup through an existing inference server. No subscription or new hosted speech service.

- **Fast:** Parakeet Unified English 0.6B, Q8_0.
- **Accurate:** Whisper large-v3-turbo, Q8_0, with your custom vocabulary supplied during recognition.
- **Plain dictation:** offline after models are downloaded.
- **Optional cleanup:** an OpenAI-compatible endpoint, such as nous. Only the cleanup shortcut sends the transcript. Network cleanup has a three-second deadline; errors, empty responses, and timeouts retain the plain transcript and show a notice.

“Accurate” names the vocabulary-aware preset; it is not a promise that it wins on every utterance. [Measured baseline and limitations](docs/benchmark-baseline.md). The CLI screening is encouraging; real microphone accuracy, full recording-to-paste latency, battery use, and non-Mac builds still need acceptance testing.

## Download for Mac

Download the Apple Silicon ZIP from [the latest GitHub release](https://github.com/btuckerc/dictation/releases/latest), unzip it, and move **Dictation.app** to **Applications**. Quit an older copy before replacing it.

Starting with **0.1.2**, release downloads are Developer ID–signed, notarized by Apple, and include a stapled ticket. No developer account, local signing, or quarantine-removal command is needed. macOS may ask you to confirm opening a downloaded app and grant Microphone and Accessibility access. Speech models are downloaded separately during setup. The deployment target is macOS 11 or later; older macOS versions have not been runtime-qualified.

There is no automatic updater. To update, quit Dictation and replace the app with the latest download; your app data is kept separately.

## Build and install on Mac

Prerequisites: Xcode command-line tools, Rust stable, Bun 1.3.11, Python 3.11+ (for model preparation and evaluation). See [BUILD.md](BUILD.md) for native dependencies on other platforms.

```sh
git clone git@github.com:btuckerc/dictation.git
cd dictation
python3 scripts/prepare-models.py
bash scripts/build-mac.sh --install
```

The install flow prepares prerequisites, builds the signed bundle, replaces `/Applications/Dictation.app`, and launches it through LaunchServices. Quit Dictation before installing an update; it does not reset macOS permissions automatically.

The preparation script downloads the two pinned, checksum-verified models into the app's data directory (~1.6 GB). Alternatively, download one preset from the app. `--from-cache /path/to/models` reuses verified GGUF files. Models and local recordings are never bundled into the repository.

For a prepared checkout, `bun run install:mac` runs the same safe signed installation flow. Use `bash scripts/build-mac.sh --install` when prerequisites also need to be prepared.

Grant **Microphone** access for recording and **Accessibility** (called Device Control and Data Access on newer macOS versions) for shortcuts/pasting when macOS prompts. Local source builds require an existing Apple Development or Developer ID Application signing identity. The build script pins the chosen fingerprint in ignored `.local/macos-signing-identity` and refuses to fall back to ad-hoc signing. Set `APPLE_SIGNING_IDENTITY` explicitly if multiple signers are available. Development-signed builds are not notarized distribution builds. See [permission repair and signing](docs/macos-permissions.md). Existing application data is separate from Handy under `com.btuckerc.dictation`.

## Developer ID releases

Public releases use **Developer ID Application** signing, Apple's notarization service, a stapled ticket, and a verified ZIP hosted on GitHub Releases—not the local development certificate or a Gatekeeper bypass. The shared sibling checkout `mac-releases` owns this process:

```sh
python3 ../mac-releases/release.py --help
python3 ../mac-releases/release.py build dictation \
  --version 0.1.2 --build-number 3 --identity "Developer ID Application: Your Name (TEAMID)"
```

The release builder requires clean committed source, native Apple Silicon, an installed Developer ID certificate/private key, locked Bun/Cargo dependencies, and the checksum-verified bundled Silero VAD model. It targets macOS 11.0 consistently with the Swift bridge; the shared pipeline rejects any bundled Mach-O binary with a higher deployment target than advertised. This is a build target, not a claim of runtime testing on every macOS version.

`scripts/build_macos.py --release --identity ... --version X.Y.Z --build-number N --output /absolute/path/Dictation.app` is the lower-level build-only adapter. It neither installs nor changes `.local/macos-signing-identity`. The central `notarize` command uploads to Apple using a Keychain profile and produces a stapled ZIP only after acceptance and verification. `draft` and `publish` are separate explicit actions; they require an existing remote version tag matching the built commit. Signing alone is not a completed release. Existing published downloads are not changed by adding this pipeline.

## Use

First launch uses a compact Connect → Prepare → Try it flow, with permission recovery, cancellable model downloads, and an optional live shortcut trial. See [onboarding design and corner cases](docs/onboarding.md).

1. Choose Fast or Accurate in General. Model selection waits for a successful load and is rejected while dictation is busy.
2. Add project names and identifiers to Custom Words. Accurate supplies these to the recognizer; both presets retain Dictation's text correction behavior.
3. Default Mac shortcut: **Option+Space** for plain dictation. Push-to-talk/toggle behavior and shortcuts are configurable.
4. Optionally save the existing server URL and model in General → Cleanup. For this setup: `http://nous:8080/v1`, model `Ornith-1.5-9B-Q5_K_M`. Save enables configuration; it does not prove server connectivity. Use **Option+Shift+Space** for cleanup. Plain dictation still works without the server.
5. Review text before sending. Cleanup cannot reliably reconstruct misrecognized terms. History retains transcripts and, according to retention settings, recordings; configure retention in Advanced.

In **Dictionary → Replacements**, add a **Replace → With** rule such as `two → 2`. Unlike Custom Words (recognition hints), these are literal, case-insensitive whole-word or phrase replacements applied after dictation and optional cleanup. `Two people` becomes `2 people`; `to`, `too`, and `twosome` are unchanged. Replacement spelling is preserved, phrases match their exact internal spacing, and the longest matching rule wins. Rules run once without cascading into other rules. Edit or remove them in the same section; existing history is unchanged unless you retry its transcription.

Escape cancels an active operation. The overlay reports recording/transcription/processing state. The pipeline holds the operation until the queued paste completes to prevent a cancelled or delayed operation from inserting into a newer one. OS focus and clipboard behavior still require live testing in your target applications.

The recording indicator is a compact waveform-only capsule: muted while the microphone starts, audio-reactive once samples arrive, and a travelling dot pulse while transcribing or processing. Releasing the shortcut keeps the same pill size without flashing a status label; screen readers still receive the working status. Live mode expands to preserve the transcript. There is no on-pill cancel button; use the configured cancel shortcut (Escape by default). Reduced Motion disables decorative animation. On macOS the surface is web-rendered inside a native nonactivating NSPanel, not native Liquid Glass.

Accent presets are the original cyan-blue (`#55C3E8`), white (`#FFFFFF`), electric yellow (`#F5D90A`), and hot pink (`#FF4FA3`). The recording waveform uses the selected accent. Text, selected navigation, and button outlines use contrast-adjusted variants in light and dark appearances; custom colors remain configurable.

The menu bar tray exposes exactly three actions: **Copy Last Transcript**, **Settings**, and **Quit**.

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

Base: Handy `05e0aedd2906f0d82722735f930465950c476b90` (v0.9.7), MIT licensed; copyright retained in [LICENSE](LICENSE). See [original README](README.upstream.md) and [attributions](docs/ATTRIBUTIONS.md). Model licenses are independent and linked in the model catalog. Dictation is the independent `btuckerc/dictation` fork and uses its own 0.1.x version series; its package, executable, Rust library, and bundle identifier are Dictation-specific. This is not an official Handy release.
