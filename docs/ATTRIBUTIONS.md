# Dictation attributions

Dictation is an independent fork maintained at [github.com/btuckerc/dictation](https://github.com/btuckerc/dictation).

## Handy

Dictation contains a substantial amount of code derived from [Handy by CJ Pais and contributors](https://github.com/cjpais/Handy). The inherited project is distributed under the MIT License. The copyright and permission notice from Handy is retained in the repository `LICENSE` file and is also shown offline in Dictation's About screen. The upstream source and license are available at:

- [Handy source](https://github.com/cjpais/Handy)
- [Handy MIT License](https://github.com/cjpais/Handy/blob/main/LICENSE)

This credit describes the relationship between the projects; Dictation is maintained and released separately by btuckerc.

## Runtime and frontend dependencies

Dictation uses open-source dependencies listed in `package.json`, `bun.lock`, and `src-tauri/Cargo.toml`. Their copyright and license notices remain the responsibility of the corresponding package distributions. The generated [third-party notice bundle](../src-tauri/resources/licenses/THIRD-PARTY-NOTICES.txt) is produced by [`scripts/generate_notices.py`](../scripts/generate_notices.py) from the macOS-targeted resolved frontend and Rust graphs. It includes exact cached upstream texts where available, canonical SPDX fallback text where a registry archive omits its notice, and a clearly marked unresolved-items section for package-specific copyright notices that still need verification. It must be regenerated from release metadata; it is not claimed to be exhaustive while that section is non-empty.

The speech-to-text stack includes [transcribe.cpp](https://github.com/handy-computer/transcribe.cpp), whose tagged v0.2.3 license is MIT, and [ggml](https://github.com/ggml-org/ggml), whose license is MIT. Their resolved Cargo notices are included in the generated bundle. The bundled [Silero VAD model](https://github.com/snakers4/silero-vad) is covered by the Silero project's MIT notice, which is reproduced in that bundle.

## Bundled artwork and sounds

The inherited Handy icon and tray artwork under `src-tauri/icons/` and `src-tauri/resources/` do not carry independent per-file provenance metadata in this checkout, but remain covered by the repository's retained upstream MIT notice. The Dictation waveform mark in `assets/dictation.svg` was created for this project and is distributed under the repository MIT notice. No separate upstream source was identified for the inherited notification sounds; retain the root MIT notice with releases and treat their historical source as a provenance follow-up.

Some MPL-2.0 Cargo packages are distributed in registry archives without license text. The generated bundle records their source repositories for source availability: [Servo](https://github.com/servo/servo), [Stylo](https://github.com/servo/stylo), and [Symphonia](https://github.com/pdeljanov/Symphonia).

## Notice rule

For MIT-covered code, preserve the copyright and permission notice in copies or substantial portions and keep the warranty/disclaimer text. Do not imply endorsement by Handy, CJ Pais, Georgi Gerganov, or any dependency author.
