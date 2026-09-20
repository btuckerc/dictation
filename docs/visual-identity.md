# Dictation visual identity

The mark is five rounded meter bars with an asymmetric falloff. It represents voice without a hand, ear, or brain metaphor. The app tile uses a restrained cobalt gradient and a fine edge highlight; interface glyphs use the selected accent or the platform's monochrome treatment. Settings backgrounds stay neutral.

- Ready: the five-bar mark.
- Recording: the meter with a separate recording dot.
- Transcribing: two meter bars beside three text strokes.
- Shortcut blocked: the meter beside an exclamation mark.

Each status has a distinct silhouette because macOS uses the tray artwork as an alpha template. Color alone cannot communicate state there. The recording overlay retains its existing audio-driven meter and capture-ready behavior; this identity update does not change recording timing or add a continuously running animation to the tray. Standard microphone and keyboard permission symbols keep their literal meaning.

The original SVG sources are in `assets/`; regenerate every app and status icon with `python3 scripts/generate_icons.py`. The SVG artwork and interface glyphs were created for Dictation and are distributed under the repository's MIT terms. Handy's code attribution remains in About and the bundled license notices. Its hand, ear, brain, and wordmark artwork are not used by this identity.

References: Wispr's [voice-interface design article](https://wisprflow.ai/post/designing-a-natural-and-useful-voice-interface) informed the quiet, compact direction; Apple's [app icon guidance](https://developer.apple.com/design/human-interface-guidelines/app-icons) informed simplicity and small-size recognition. This is original artwork, not a copy of Wispr's logo or Apple's symbols. The PNG/ICNS tile is a precomposed cross-platform asset, not a native Icon Composer Liquid Glass asset.
