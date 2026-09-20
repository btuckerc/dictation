# macOS permission recovery and update identity

A checked System Settings row is not proof that the running executable is trusted. The dev-2 app was ad-hoc signed: its designated requirement was a specific code hash. Replacing it changed the identity recognized by privacy controls. [Apple TN3127](https://developer.apple.com/documentation/technotes/tn3127-inside-code-signing-requirements) explains this development failure mode.

## Recovery

The primary interaction is a draggable app icon next to typing access. Open System Settings, drag the icon directly into its access list, then enable Dictation. It starts a native AppKit file drag for the running bundle using the macOS-only `drag` crate (no JavaScript drag plugin). The operation is copy-only and does not grant permission by itself.

For a stale checked entry, expand **Already enabled, but still not working?**:

1. **Repair typing access** invokes `/usr/bin/tccutil reset Accessibility <this app's configured bundle identifier>`. It resets only Dictation, only Accessibility, and only after that explicit click. It does not edit the TCC database, use sudo, reset all apps, or enable a grant.
2. System Settings opens. The user drags the app icon into the list and enables Dictation again. Some macOS versions label this pane Device Control and Data Access.
3. If a stale row remains, remove it with − first. **Show app in Finder** is retained only inside the repair disclosure as a keyboard fallback for adding the app with +. The primary drag icon carries the actual installed `.app`, not a screenshot, shortcut, or the executable inside it.
4. Returning to Dictation triggers the real OS checks and native initialization. Continue remains disabled until those succeed. Repair errors stay visible and retryable. A successful reset alone is never represented as a successful grant. If macOS still reports old state, quit and reopen Dictation after enabling access.

The reset action does not touch microphone permission, history, models, vocabulary, or shortcuts. Resetting an entry may require one new user approval. This is intentionally a repair action, not something run automatically on launch or update.

## Preventing repeated repair

Use `bash scripts/build-mac.sh` (dependency/model-resource setup included) or `bun run build:mac` (dependencies already installed). The Python wrapper chooses an available Apple-issued signing identity, pins its public fingerprint locally, and verifies the signed bundle. Multiple distinct signers require explicit selection. A missing/expired pinned identity fails the build rather than silently producing a differently signed app. The raw upstream Tauri command bypasses this guard and should not be used to produce installed updates.

Keep the bundle identifier, signing identity and installation path stable. The first move from ad-hoc to certificate signing is a one-time identity migration and requires reauthorization. Certificate rotation and migration from Apple Development to Developer ID must be deliberate; compatibility must be verified rather than assumed. The local fingerprint file contains no private key and is ignored by git. A new build host needs access to the intended signing identity through normal keychain/CI provisioning.

For public distribution, use Developer ID Application signing, hardened runtime, notarization, and a signed update channel. Apple Development signing improves our local development identity continuity; it is not a substitute for that distribution process. No Developer ID identity was available on the development host during this change.

Managed fleets can investigate Apple's [PPPC payload](https://support.apple.com/guide/deployment/privacy-preferences-policy-control-payload-settings-dep38df53c2a/web) through MDM. That is a separate administrator-controlled deployment path, not an onboarding dependency or an app's license to approve its own access.

## Adjacent window placement

Opening System Settings triggers a bounded sequence of up to four metadata reads while the window launches. The process is identified by `com.apple.systempreferences`; only its PID, normal-window layer, and bounds are used. Window titles and screen pixels are not read. [Apple explains](https://developer.apple.com/videos/play/wwdc2019/701/) that CGWindowListCopyWindowInfo does not trigger a screen-recording prompt and filters unavailable metadata. Missing metadata leaves placement unchanged.

Dictation moves its own window beside the destination when there is enough room. Positioning uses logical points, converts Core Graphics/AppKit coordinates, and respects the target display's visible work area, including negative display origins, menu bar, and Dock. It never moves System Settings, shrinks windows, overlaps the destination deliberately, or pushes Dictation offscreen. If the screen is too small, layout remains unchanged. There is no background tracking or repeated snapping after a user moves a window. Geometry tests cover right/left placement, work-area clamping, multiple-display origins, and insufficient space; actual OS drop acceptance requires a live manual check.
