#!/usr/bin/env python3
"""Build with a persistent local signing identity; never silently use ad-hoc signing."""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile

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


def signing_requirement(app):
    subprocess.run(['codesign', '--verify', '--deep', '--strict', str(app)], check=True)
    inspection = subprocess.run(['codesign', '-d', '-r-', str(app)], text=True, capture_output=True, check=True)
    requirement = next((line for line in (inspection.stdout + inspection.stderr).splitlines()
                        if line.startswith('designated =>')), '')
    if not requirement or 'designated => cdhash' in requirement:
        raise SystemExit('Unexpected ad-hoc identity: do not install this build.')
    return requirement


def require_app_stopped():
    # Include the previous executable name so upgrades cannot overwrite a live app.
    result = subprocess.run(['pgrep', '-x', 'dictation|handy'], capture_output=True)
    if result.returncode == 0:
        raise SystemExit('Quit Dictation before installing. Installation will not interrupt a recording.')
    if result.returncode != 1:
        raise SystemExit('Could not determine whether Dictation is running; installation stopped.')


def install_app(app):
    destination = Path('/Applications/Dictation.app')
    require_app_stopped()
    requirement = signing_requirement(app)
    if destination.exists() and signing_requirement(destination) != requirement:
        raise SystemExit('Installed signing identity differs. Refusing to invalidate macOS permissions.')
    with tempfile.TemporaryDirectory(prefix='.dictation-install-', dir=destination.parent) as directory:
        staged = Path(directory) / 'Dictation.app'
        backup = Path(directory) / 'previous.app'
        subprocess.run(['ditto', str(app), str(staged)], check=True)
        if signing_requirement(staged) != requirement:
            raise SystemExit('Staged app identity does not match the build.')
        require_app_stopped()
        if destination.exists():
            destination.rename(backup)
        try:
            staged.rename(destination)
        except OSError:
            if backup.exists():
                backup.rename(destination)
            raise
    # LaunchServices gives the bundle its normal application/permission context.
    # Never launch Contents/MacOS/dictation as a child of a terminal or agent runner.
    subprocess.run(['open', str(destination)], check=True)
    print(f'Installed and launched {destination}', flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--install', action='store_true', help='Install the verified build and launch through macOS; Dictation must be quit first.')
    args = parser.parse_args()
    if sys.platform != 'darwin':
        raise SystemExit('This build command requires macOS.')
    if args.install:
        require_app_stopped()
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
    print(signing_requirement(app), flush=True)
    if args.install:
        install_app(app)


if __name__ == '__main__':
    main()
