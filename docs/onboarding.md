# First sentence onboarding

The goal is to get to a real sentence with a working shortcut, with recovery where something fails. There are no new runtime dependencies, accounts, introductory slides, or artificial completion delays.

1. **Connect:** explain microphone and typing permissions separately. Requests only follow a click. Recheck on focus/visibility return; short, serialized polling runs after a request and stops after 90 seconds or a check failure. A denied request leaves Settings and Check again available. Native initialization errors cannot advance setup. Returning users repair permissions without repeating model selection.
2. **Prepare:** show only Fast and Accurate. Reuse cached models, disclose download size, allow cancellation, and suppress selection from late/cancelled/unmounted download continuations. More models remain available in Settings. Selecting a model stays on the same screen. Continue advances only after a downloaded model is selected; Back returns to permissions.
3. **Try it:** edit the shortcut, choose recording behavior, and optionally dictate into a local practice field. It is an actual dictation using normal history retention, not a simulation or a fake success check. Finish is always available; practice is optional. Microphone and recording behavior are available in a disclosure; Back returns to model selection.

## Shortcut recovery

Both shortcut implementations use a single capture owner so two settings rows cannot suspend/resume each other's session. Cancel and Escape preserve the stored binding. Blur/unmount cancels an active session; unmount during a pending native start waits for that start before resuming shortcuts. A committed update is not reverted by cleanup. Native listener cleanup releases late listeners and handles Escape in native events. The browser recorder retains modifiers pressed before the recorder was opened.

Capture controls are keyboard-accessible buttons with an explicit cancel control. Reset is disabled during capture and reports backend failures. Internal duplicate checks normalize modifier aliases and order. The backend still validates/registers the shortcut and restores the previous registration on failure. The existing macOS Secure Input warning remains visible during the trial.

This does not enumerate every shortcut owned by macOS or another application. Registration success is not proof that a hotkey is conflict-free. The real shortcut trial and nearby edit control provide the final check. Side-specific native modifiers remain distinct.

## Responsiveness and limits

Permission checks are serialized, callbacks are guarded against unmount, and the completion callback is one-shot. First-run GPU device enumeration moved out of startup logging; model loading or opening the compute-device list triggers that work. No claim of a measured startup speedup is made from this code change alone. Recognition, recording, and clipboard behavior still require real microphone testing in target applications.

Ad-hoc signed updates can invalidate macOS permission entries. The UI explains how to replace a stale Accessibility entry with the installed application. The explicit Repair typing access action resets only this app’s Accessibility decision with tccutil; the user must enable access again. Show app in Finder reveals the running bundle for manual replacement. No grant is enabled automatically. A production distribution should use a stable signing identity and notarization; development builds now use a pinned Apple Development identity; Developer ID distribution and notarization remain separate work.

## Verification

Browser tests cover denied permission recovery, native initialization/check failure and retry, inert preview, small-window layout, late download completion after cancel, both shortcut backends' Escape/blur/unmount behavior, duplicate conflicts, registration failure, and modifiers held before capture. These mock OS calls and complement native build/tests; they do not replace live OS permission and input testing.

Design references: [Apple onboarding guidance](https://developer.apple.com/design/human-interface-guidelines/onboarding) emphasizes learning through use and minimizing setup; [Raycast shortcut settings](https://manual.raycast.com/settings) provide a reference for accessible capture and conflict feedback. The implementation uses Dictation's existing Tauri/Rust architecture.

## Visual and navigation audit

Panel and window backgrounds are neutral in both themes. The default accent is a saturated blue (#0066FF); General offers color swatches and a custom picker. Color preferences persist and synchronize with the recording overlay, while derived text colors keep adequate contrast. Glass-inspired CSS is limited to navigation, using static translucency and a small backdrop blur; content uses more opaque surfaces. This is portable webview styling, not native NSGlassEffectView. Reduced transparency, increased contrast, and reduced motion preferences suppress the corresponding effects. There are no new runtime dependencies or animated blur effects. GPU/frame-time savings have not been measured.

Model selection no longer automatically advances onboarding or sorts the selected model to the top of the catalog. Explicit Continue/Back controls keep progression intentional. General settings retain a stable sequence while recording behavior, vocabulary, cleanup, language controls, and extra audio controls are disclosed on demand. Secondary navigation lives under More. The app name appears once in the native title bar, without a duplicate sidebar heading. Model options are keyboard-accessible; Escape dismisses the switcher.

General settings includes **Live transcript**, with its explanation in a keyboard-accessible question-mark tooltip. Group and preset explanations also live in tooltips. Turning it off uses the compact recording indicator; turning it on uses the existing live overlay, supported by streaming speech models. The choice persists and applies to the next recording. An already hidden overlay remains hidden until live words are explicitly enabled. This controls presentation, not speech recognition or its accuracy.

The orange menu-bar microphone indicator belongs to macOS, not Accessibility or Dictation's overlay. There is no supported per-app control to hide it in normal desktop use. Apple's [limited external-display/full-screen exception](https://support.apple.com/en-gb/118449) does not solve the ordinary menu-bar case. Keeping the microphone continuously open would change privacy/resource behavior, so capture remains tied to recording.

Design reference: [Apple materials](https://developer.apple.com/design/human-interface-guidelines/materials). Remaining validation: real macOS shortcut conflicts, permission recovery after ad-hoc updates, and end-to-end latency need device testing; browser mocks cannot establish these.

## Double-tap or hold

The additional activation mode treats one short tap while idle as a no-op. A second press within 300 ms of release starts locked recording; after releasing that key, a distinct tap stops it. A continuous hold starts recording at the existing hold threshold (300 ms by default), and release finishes it. Wait for the recording indicator before speaking in this mode. Existing Hold, Tap, and Auto choices are preserved.

Recognition of the gesture stays in the coordinator's existing event/timer thread. There is no new polling loop or always-on microphone. Physical repeated key-down events do not count as new taps. Busy-pipeline gestures are qualified before queuing; releasing a queued hold discards it. Tests cover fast double taps, boundary timing, a release just before the hold threshold, repeated presses, cancellation, another binding, external triggers, and pipeline completion both before and after qualification.

## macOS Fn system action

When either dictation binding is Fn alone, General and shortcut onboarding show a compact setup disclosure. Open Keyboard settings and set “Press fn key to” / “Press Globe key to” to “Do Nothing”. If macOS Dictation separately uses Fn twice, choose another system shortcut there. This is an explicit system-wide preference change made in macOS, not an app-only reservation. Control-Command-Space remains the standard emoji shortcut. Dictation does not silently write global preferences or report an unverified conflict as resolved.

The existing keyboard filter suppresses registered Fn press events but does not reliably prevent macOS’s short-tap action on every system. Holding and double-tapping continue through the same coordinator. No event replay, extra keyboard hook, or preference polling was added. The setup link is restricted to the two Keyboard settings URLs and reports failure with a manual recovery path.

Apple reference: [Keyboard settings](https://support.apple.com/guide/mac-help/kbdm162/mac) and [emoji and symbols](https://support.apple.com/guide/mac-help/mchlp1560/mac).
