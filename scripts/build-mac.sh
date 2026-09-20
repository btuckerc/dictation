#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
bun install --frozen-lockfile
mkdir -p src-tauri/resources/models
if [[ ! -f src-tauri/resources/models/silero_vad_v4.onnx ]]; then
  curl --fail --location --retry 2 https://blob.handy.computer/silero_vad_v4.onnx \
    --output src-tauri/resources/models/silero_vad_v4.onnx
fi
printf "%s  %s\n" a35ebf52fd3ce5f1469b2a36158dba761bc47b973ea3382b3186ca15b1f5af28 src-tauri/resources/models/silero_vad_v4.onnx | shasum -a 256 -c -
bun run build:mac "$@"
echo "Built: src-tauri/target/release/bundle/macos/Dictation.app"
