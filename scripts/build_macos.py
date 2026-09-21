#!/usr/bin/env python3
"""Build with a persistent local signing identity; never silently use ad-hoc signing."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parent.parent
PIN = ROOT / '.local' / 'macos-signing-identity'
VAD_SHA256 = 'a35ebf52fd3ce5f1469b2a36158dba761bc47b973ea3382b3186ca15b1f5af28'


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


def identity_choices():
    output = subprocess.check_output(['security', 'find-identity', '-v', '-p', 'codesigning'], text=True)
    return re.findall(r'\d+\) ([A-Fa-f0-9]{40}) "((?:Apple Development:|Developer ID Application:)[^"]+)"', output)


def release_identity(identities, requested):
    if not requested:
        raise SystemExit('Release builds require --identity with a Developer ID Application identity.')
    matches = [(key, name) for key, name in identities if requested in (key, name)]
    if len(matches) != 1:
        raise SystemExit('The selected signing identity is unavailable or ambiguous.')
    key, name = matches[0]
    if not name.startswith('Developer ID Application:'):
        raise SystemExit('Release builds require a Developer ID Application identity, not Apple Development or ad hoc signing.')
    return key


def set_release_plist(app, version, build_number):
    plist = app / 'Contents' / 'Info.plist'
    subprocess.run(['/usr/libexec/PlistBuddy', '-c', f'Set :CFBundleShortVersionString {version}', str(plist)], check=True)
    subprocess.run(['/usr/libexec/PlistBuddy', '-c', f'Set :CFBundleVersion {build_number}', str(plist)], check=True)


def resign_release_app(app, identity):
    # Tauri has already signed nested code. Only the root signature is
    # invalidated by updating its Info.plist.
    subprocess.run([
        'codesign', '--force', '--timestamp', '--options', 'runtime',
        '--sign', identity, '--entitlements', str(ROOT / 'src-tauri/Entitlements.plist'),
        str(app),
    ], check=True)


def validate_release_inputs(args):
    if platform.machine() != 'arm64':
        raise SystemExit('Release builds currently require native arm64 macOS.')
    output = Path(args.output)
    if not output.is_absolute() or output.suffix != '.app':
        raise SystemExit('--output must be an absolute path ending in .app.')
    if os.path.lexists(output):
        raise SystemExit(f'Refusing to replace existing release output: {output}')
    if not re.fullmatch(r'\d+\.\d+\.\d+', args.version or ''):
        raise SystemExit('--version must be numeric X.Y.Z.')
    if args.build_number is None or args.build_number < 1:
        raise SystemExit('--build-number must be a positive integer.')
    vad = ROOT / 'src-tauri/resources/models/silero_vad_v4.onnx'
    if not vad.is_file():
        raise SystemExit(f'Missing bundled VAD model: {vad}')
    digest = hashlib.sha256(vad.read_bytes()).hexdigest()
    if digest != VAD_SHA256:
        raise SystemExit(f'Bundled VAD model SHA256 mismatch: expected {VAD_SHA256}, got {digest}.')
    return output


def build_release(args):
    output = validate_release_inputs(args)
    identity = release_identity(identity_choices(), args.identity)
    output.parent.mkdir(parents=True, exist_ok=True)
    config = json.dumps({
        'version': args.version,
        'bundle': {'macOS': {'signingIdentity': identity, 'hardenedRuntime': True, 'minimumSystemVersion': '11.0'}},
    })
    env = os.environ.copy()
    env['APPLE_SIGNING_IDENTITY'] = identity
    env['MACOSX_DEPLOYMENT_TARGET'] = '11.0'
    for key in ('APPLE_ID', 'APPLE_PASSWORD', 'APPLE_TEAM_ID', 'APPLE_API_KEY',
                'APPLE_API_KEY_PATH', 'APPLE_API_ISSUER', 'NOTARYTOOL_PROFILE',
                'APPLE_CERTIFICATE', 'APPLE_CERTIFICATE_PASSWORD'):
        env.pop(key, None)
    with tempfile.TemporaryDirectory(prefix='.dictation-release-') as target:
        env['CARGO_TARGET_DIR'] = target
        # A release install must not run the development Nix-regeneration hook
        # or rewrite tracked source after the orchestrator records its commit.
        subprocess.run(['bun', 'install', '--frozen-lockfile', '--ignore-scripts'], cwd=ROOT, env=env, check=True)
        subprocess.run([
            'bun', 'run', 'tauri', 'build', '--bundles', 'app', '--config', config, '--', '--locked',
        ], cwd=ROOT, env=env, check=True)
        app = Path(target) / 'release/bundle/macos/Dictation.app'
        if not app.is_dir():
            raise SystemExit(f'Tauri did not produce the expected app bundle: {app}')
        set_release_plist(app, args.version, args.build_number)
        resign_release_app(app, identity)
        subprocess.run(['codesign', '--verify', '--deep', '--strict', str(app)], check=True)
        subprocess.run(['ditto', str(app), str(output)], check=True)
    print(f'Wrote release app {output}', flush=True)




def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--install', action='store_true', help='Install the verified build and launch through macOS; Dictation must be quit first.')
    parser.add_argument('--release', action='store_true', help='Build a notarization-ready Developer ID app without installing it.')
    parser.add_argument('--identity', help='Developer ID Application identity name or SHA-1 (required for release).')
    parser.add_argument('--version', help='Release marketing version (X.Y.Z).')
    parser.add_argument('--build-number', type=int, help='Release CFBundleVersion (positive integer).')
    parser.add_argument('--output', help='Absolute fresh .app output path for release builds.')
    args = parser.parse_args()
    release_only = (args.identity, args.version, args.build_number, args.output)
    if not args.release and any(value is not None for value in release_only):
        raise SystemExit('--identity, --version, --build-number, and --output require --release.')
    if sys.platform != 'darwin':
        raise SystemExit('This build command requires macOS.')
    if args.release:
        if args.install:
            raise SystemExit('--release cannot be combined with --install.')
        if not args.version or args.build_number is None or not args.output:
            raise SystemExit('--release requires --identity, --version, --build-number, and --output.')
        build_release(args)
        return
    if args.install:
        require_app_stopped()
    identities = identity_choices()
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
