#!/usr/bin/env python3
"""Build with a persistent local signing identity; never silently use ad-hoc signing."""
import json
import os
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parent.parent
PIN = ROOT / '.local' / 'macos-signing-identity'


def choose_identity(identities, requested=None, pinned=None):
    selected = requested or pinned
    if selected:
        matches = [(key, name) for key, name in identities if selected in (key, name)]
        if len(matches) != 1:
            raise ValueError('The selected signing identity is unavailable or ambiguous. Set APPLE_SIGNING_IDENTITY to its SHA-1 fingerprint.')
        return matches[0][0]
    names = {name for _, name in identities}
    if len(names) != 1:
        raise ValueError('Choose a signing identity explicitly with APPLE_SIGNING_IDENTITY. No ad-hoc fallback is allowed.')
    return sorted(key for key, _ in identities)[0]


def main():
    if sys.platform != 'darwin':
        raise SystemExit('This build command requires macOS.')
    output = subprocess.check_output(['security', 'find-identity', '-v', '-p', 'codesigning'], text=True)
    identities = re.findall(r'\d+\) ([A-Fa-f0-9]{40}) "((?:Apple Development:|Developer ID Application:)[^"]+)"', output)
    requested = os.environ.get('APPLE_SIGNING_IDENTITY')
    pinned = PIN.read_text().strip() if PIN.exists() else None
    try:
        identity = choose_identity(identities, requested, pinned)
    except ValueError as error:
        raise SystemExit(str(error)) from error
    if pinned and pinned != identity:
        raise SystemExit('Signing identity differs from the local pin. An intentional migration requires removing .local/macos-signing-identity and may require reauthorizing permissions.')
    PIN.parent.mkdir(exist_ok=True)
    PIN.write_text(identity + '\n')
    print(f'Using pinned signing identity {identity}', flush=True)
    config = json.dumps({'bundle': {'macOS': {'signingIdentity': identity}}})
    env = os.environ.copy()
    env['APPLE_SIGNING_IDENTITY'] = identity
    subprocess.run(['bun', 'run', 'tauri', 'build', '--bundles', 'app', '--config', config], cwd=ROOT, env=env, check=True)
    app = ROOT / 'src-tauri/target/release/bundle/macos/Dictation.app'
    subprocess.run(['codesign', '--verify', '--deep', '--strict', str(app)], check=True)
    inspection = subprocess.run(['codesign', '-d', '-r-', str(app)], text=True, capture_output=True, check=True)
    requirement = inspection.stdout + inspection.stderr
    if 'designated =>' not in requirement or 'designated => cdhash' in requirement:
        raise SystemExit('Unexpected ad-hoc identity: do not install this build.')
    print(requirement, flush=True)


if __name__ == '__main__':
    main()
