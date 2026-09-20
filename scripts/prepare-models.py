#!/usr/bin/env python3
"""Seed Dictation's two pinned presets; verify every file before activation."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
PRESETS = {"handy-computer/parakeet-unified-en-0.6b-gguf", "handy-computer/whisper-large-v3-turbo-gguf"}

def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--from-cache", type=Path, help="Reuse previously downloaded GGUFs")
    parser.add_argument("--models-dir", type=Path, help="Override app model directory")
    args = parser.parse_args()
    if sys.platform == "darwin":
        base = Path.home() / "Library/Application Support"
    elif sys.platform == "win32":
        base = Path(os.environ["APPDATA"])
    else:
        base = Path(os.environ.get("XDG_DATA_HOME", str(Path.home() / ".local/share")))
    destination = args.models_dir or base / "com.btuckerc.dictation/models"
    destination.mkdir(parents=True, exist_ok=True)
    catalog = json.loads((ROOT / "src-tauri/src/catalog/catalog.json").read_text())
    for model in catalog["models"]:
        if model["id"] not in PRESETS:
            continue
        file = next(f for f in model["files"] if f["quant"] == "Q8_0")
        target = destination / file["filename"]
        if target.exists() and digest(target) == file["sha256"]:
            print(f"Verified: {target.name}")
            continue
        pending = target.with_suffix(".gguf.partial")
        try:
            cached = args.from_cache / file["filename"] if args.from_cache else None
            if cached and cached.is_file() and digest(cached) == file["sha256"]:
                shutil.copyfile(cached, pending)
            else:
                url = f"https://huggingface.co/{model['id']}/resolve/{model['revision']}/{file['filename']}"
                subprocess.run(["curl", "--fail", "--location", "--retry", "2", "--output", str(pending), url], check=True)
            if digest(pending) != file["sha256"]:
                raise RuntimeError(f"Checksum mismatch: {file['filename']}")
            pending.replace(target)
            print(f"Prepared: {target.name}")
        finally:
            pending.unlink(missing_ok=True)
    print(f"Models: {destination}")

if __name__ == "__main__":
    main()
