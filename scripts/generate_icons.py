"""Render original Dictation SVG assets with the existing Tauri icon CLI."""
from pathlib import Path
import shutil
import subprocess
import tempfile
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
VOICE = ET.parse(ROOT / 'assets/voice-mark.svg').getroot()[0].attrib['d']
TEXT = 'M3 8v8M7.5 4v16M13 6h8M13 12h6M13 18h8'


def glyph(state, color, badge=None):
    """State remains identifiable when macOS uses the PNG as an alpha template."""
    path = f'<path d="{VOICE}"/>'
    if state == 'recording':
        path = f'<g transform="translate(0 2) scale(.8)">{path}</g><circle cx="21" cy="4" r="3" fill="{badge or color}" stroke="none"/>'
    elif state == 'transcribing':
        path = f'<path d="{TEXT}"/>'
    elif state == 'warning':
        path = '<path d="M3.2 8.5v7M7.6 5.5v13M12 2v20"/>' + f'<path d="M20 5v8" stroke="{badge or color}"/><circle cx="20" cy="18" r="1.5" fill="{badge or color}" stroke="none"/>'
    return f'<g fill="none" stroke="{color}" stroke-width="2.4" stroke-linecap="round">{path}</g>'


def render(source, target, size=None):
    cmd = ['bunx', 'tauri', 'icon', str(source), '--output', str(target)]
    if size:
        cmd += ['--png', str(size)]
    subprocess.run(cmd, cwd=ROOT, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def main():
    with tempfile.TemporaryDirectory(prefix='dictation-icons-') as tmp:
        tmp = Path(tmp)
        render(ROOT / 'assets/dictation.svg', tmp / 'app')
        icon_root = ROOT / 'src-tauri/icons'
        for generated in (tmp / 'app').rglob('*'):
            if generated.is_file():
                target = icon_root / generated.relative_to(tmp / 'app')
                if target.is_file():
                    shutil.copyfile(generated, target)
        shutil.copyfile(tmp / 'app/icon.png', icon_root / 'logo.png')
        variants = {
            'tray_idle': ('idle', '#ffffff', None),
            'tray_idle_dark': ('idle', '#000000', None),
            'tray_recording': ('recording', '#ffffff', None),
            'tray_recording_dark': ('recording', '#000000', None),
            'tray_transcribing': ('transcribing', '#ffffff', None),
            'tray_transcribing_dark': ('transcribing', '#000000', None),
            'tray_idle_warning': ('warning', '#ffffff', None),
            'tray_idle_warning_dark': ('warning', '#000000', None),
            'handy': ('idle', '#0066ff', None),
            'recording': ('recording', '#0066ff', '#df3348'),
            'transcribing': ('transcribing', '#0066ff', None),
            'handy_warning': ('warning', '#0066ff', '#a85900'),
        }
        for name, (state, color, badge) in variants.items():
            source = tmp / f'{name}.svg'
            source.write_text(f'<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">{glyph(state, color, badge)}</svg>')
            render(source, tmp / name, 64)
            shutil.copyfile(tmp / name / '64x64.png', ROOT / 'src-tauri/resources' / f'{name}.png')
        state_root = ROOT / 'assets/states'
        state_root.mkdir(exist_ok=True)
        for state in ('idle', 'recording', 'transcribing', 'warning'):
            (state_root / f'{state}.svg').write_text(f'<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">{glyph(state, "#202020")}</svg>\n')
    print('Generated Dictation app and status icons from original SVG artwork.')


if __name__ == '__main__':
    main()
