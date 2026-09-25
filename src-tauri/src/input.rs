use crate::settings::PasteMethod;
use enigo::{Direction, Enigo, Key, Keyboard, Mouse, Settings};
use log::warn;
use std::sync::{Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};

#[cfg(target_os = "macos")]
mod macos {
    use super::Key;
    use log::{debug, warn};
    use std::ffi::c_void;

    type TisInputSourceRef = *const c_void;
    type CfDataRef = *const c_void;
    type CfStringRef = *const c_void;

    // kVK_ANSI_V. This is the behavior Handy used before layout-aware
    // resolution and remains the safest fallback if macOS cannot expose the
    // active layout.
    const ANSI_V_KEYCODE: u16 = 9;
    const KEYCODE_COUNT: u16 = 128;
    const UC_KEY_ACTION_DISPLAY: u16 = 3;
    const UC_KEY_TRANSLATE_NO_DEAD_KEYS_MASK: u32 = 1;
    // Carbon's cmdKey is bit 8. UCKeyTranslate expects Carbon modifiers shifted
    // right by 8, so Command is represented by bit 0 here.
    const COMMAND_MODIFIER_STATE: u32 = 1;

    #[link(name = "Carbon", kind = "framework")]
    unsafe extern "C" {
        fn TISCopyCurrentKeyboardLayoutInputSource() -> TisInputSourceRef;
        fn TISGetInputSourceProperty(
            input_source: TisInputSourceRef,
            property_key: CfStringRef,
        ) -> CfDataRef;
        static kTISPropertyUnicodeKeyLayoutData: CfStringRef;
        fn UCKeyTranslate(
            key_layout: *const u8,
            virtual_key_code: u16,
            key_action: u16,
            modifier_key_state: u32,
            keyboard_type: u32,
            key_translate_options: u32,
            dead_key_state: *mut u32,
            max_string_length: usize,
            actual_string_length: *mut usize,
            unicode_string: *mut u16,
        ) -> i32;
        fn LMGetKbdType() -> u8;
    }

    #[link(name = "CoreFoundation", kind = "framework")]
    unsafe extern "C" {
        fn CFDataGetBytePtr(data: CfDataRef) -> *const u8;
        fn CFRelease(value: *const c_void);
    }

    struct InputSource(TisInputSourceRef);

    impl Drop for InputSource {
        fn drop(&mut self) {
            if !self.0.is_null() {
                // SAFETY: TISCopyCurrentKeyboardLayoutInputSource returned this
                // retained reference, so this balances that ownership.
                unsafe { CFRelease(self.0) };
            }
        }
    }

    fn find_keycode(mut matches: impl FnMut(u16) -> bool) -> Option<u16> {
        (0..KEYCODE_COUNT).find(|&keycode| matches(keycode))
    }

    /// Resolves the physical key that macOS interprets as `v` while Command is
    /// held. Including Command is important: non-Latin layouts commonly map
    /// Cmd shortcuts to their ANSI equivalents, while standard Dvorak does not.
    ///
    /// TIS APIs must run on the main thread. Dictation's paste path already enters
    /// through `AppHandle::run_on_main_thread` before reaching this function.
    fn resolve_command_v_keycode() -> Result<u16, String> {
        // SAFETY: This function is called on the macOS main thread. The returned
        // source follows the Create Rule and is released by InputSource::drop.
        let source = InputSource(unsafe { TISCopyCurrentKeyboardLayoutInputSource() });
        if source.0.is_null() {
            return Err("macOS returned no current keyboard layout input source".into());
        }

        // SAFETY: The source remains retained for the duration of the scan and
        // the property constant is provided by Carbon.
        let layout_data =
            unsafe { TISGetInputSourceProperty(source.0, kTISPropertyUnicodeKeyLayoutData) };
        if layout_data.is_null() {
            return Err("current macOS keyboard layout has no Unicode layout data".into());
        }

        // SAFETY: layout_data is a CFData owned by the retained input source and
        // remains valid until source is dropped after the scan.
        let layout = unsafe { CFDataGetBytePtr(layout_data) };
        if layout.is_null() {
            return Err("current macOS keyboard layout data is empty".into());
        }

        // SAFETY: LMGetKbdType has no arguments and returns the current physical
        // keyboard type used by UCKeyTranslate.
        let keyboard_type = unsafe { LMGetKbdType() } as u32;
        let keycode = find_keycode(|keycode| {
            let mut dead_key_state = 0;
            let mut chars = [0_u16; 4];
            let mut length = 0_usize;

            // SAFETY: layout points to valid UCKeyboardLayout bytes while source
            // is retained. All output pointers reference initialized local
            // storage of the declared sizes.
            let status = unsafe {
                UCKeyTranslate(
                    layout,
                    keycode,
                    UC_KEY_ACTION_DISPLAY,
                    COMMAND_MODIFIER_STATE,
                    keyboard_type,
                    UC_KEY_TRANSLATE_NO_DEAD_KEYS_MASK,
                    &mut dead_key_state,
                    chars.len(),
                    &mut length,
                    chars.as_mut_ptr(),
                )
            };

            status == 0 && length == 1 && chars[0] == u16::from(b'v')
        })
        .ok_or_else(|| "could not map Cmd+V in the current macOS keyboard layout".to_string())?;

        Ok(keycode)
    }

    pub(super) fn command_v_key() -> Key {
        match resolve_command_v_keycode() {
            Ok(keycode) => {
                debug!("Resolved Cmd+V for the active macOS layout to keycode {keycode}");
                Key::Other(u32::from(keycode))
            }
            Err(error) => {
                warn!(
                    "Could not resolve Cmd+V for the active macOS layout ({error}); using ANSI V keycode {ANSI_V_KEYCODE}"
                );
                Key::Other(u32::from(ANSI_V_KEYCODE))
            }
        }
    }
}

/// Wrapper for Enigo stored in Tauri's managed state.
///
/// Synthetic key events go through [`EnigoState::lock`], which first completes
/// any modifier release deferred by [`send_paste_chord_deferred`]. That keeps
/// the invariant that no other synthetic key event is posted while a paste
/// chord's modifiers are still held, while letting the chord's caller return
/// before the hold ends.
pub struct EnigoState {
    enigo: Mutex<Enigo>,
    deferred_release: Mutex<Option<DeferredRelease>>,
}

/// Modifiers left held by [`send_paste_chord_deferred`] and when to release them.
struct DeferredRelease {
    modifiers: &'static [Key],
    due: Instant,
}

impl EnigoState {
    pub fn new() -> Result<Self, String> {
        let enigo = Enigo::new(&Settings::default())
            .map_err(|e| format!("Failed to initialize Enigo: {}", e))?;
        Ok(Self {
            enigo: Mutex::new(enigo),
            deferred_release: Mutex::new(None),
        })
    }

    /// Locks Enigo for sending input. Blocks until a deferred modifier release
    /// is due and sends it first, so the caller's events never carry a stale
    /// modifier.
    pub fn lock(&self) -> Result<MutexGuard<'_, Enigo>, String> {
        let mut enigo = self
            .enigo
            .lock()
            .map_err(|e| format!("Failed to lock Enigo: {}", e))?;
        self.complete_deferred_release(&mut enigo);
        Ok(enigo)
    }

    /// Like [`lock`](Self::lock), but returns `None` instead of waiting when
    /// another thread holds Enigo.
    #[cfg(target_os = "windows")]
    pub fn try_lock(&self) -> Option<MutexGuard<'_, Enigo>> {
        let mut enigo = self.enigo.try_lock().ok()?;
        self.complete_deferred_release(&mut enigo);
        Some(enigo)
    }

    /// Current mouse position. Does not wait for a deferred modifier release:
    /// reading the cursor posts no key event.
    pub fn cursor_location(&self) -> Option<(i32, i32)> {
        self.enigo.lock().ok()?.location().ok()
    }

    /// Must be called with `enigo` locked from this state.
    fn complete_deferred_release(&self, enigo: &mut Enigo) {
        let pending = self
            .deferred_release
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .take();
        if let Some(release) = pending {
            std::thread::sleep(release.due.saturating_duration_since(Instant::now()));
            if let Err(e) = release_modifiers(enigo, release.modifiers) {
                warn!("Failed to release held paste modifiers: {e}");
            }
        }
    }
}

/// Get the current mouse cursor position using the managed Enigo instance.
/// Returns None if the state is not available or if getting the location fails.
pub fn get_cursor_position(app_handle: &AppHandle) -> Option<(i32, i32)> {
    app_handle.try_state::<EnigoState>()?.cursor_location()
}

/// A paste keystroke: modifiers (in press order) held around one clicked key.
/// Virtual key codes keep the chord layout-independent (Russian, AZERTY,
/// Dvorak, ...). On Wayland this may not work; callers check first.
pub struct PasteChord {
    modifiers: &'static [Key],
    key: Key,
}

/// Cmd on macOS, Ctrl elsewhere.
#[cfg(target_os = "macos")]
const PASTE_MODIFIER: Key = Key::Meta;
#[cfg(not(target_os = "macos"))]
const PASTE_MODIFIER: Key = Key::Control;

#[cfg(target_os = "windows")]
const INSERT_KEY: Key = Key::Other(0x2D); // VK_INSERT
#[cfg(not(target_os = "windows"))]
const INSERT_KEY: Key = Key::Other(0x76); // XK_Insert (keycode 118 / 0x76, also used as fallback)

/// The V key for the paste chord. On macOS this resolves Cmd+V for the active
/// keyboard layout, which must happen on the main thread.
#[cfg(target_os = "macos")]
fn paste_v_key() -> Key {
    macos::command_v_key()
}

#[cfg(target_os = "windows")]
fn paste_v_key() -> Key {
    Key::Other(0x56) // VK_V
}

#[cfg(target_os = "linux")]
fn paste_v_key() -> Key {
    Key::Unicode('v')
}

impl PasteChord {
    /// The chord for a clipboard paste method.
    pub fn for_method(paste_method: &PasteMethod) -> Result<Self, String> {
        let (modifiers, key): (&'static [Key], Key) = match paste_method {
            PasteMethod::CtrlV => (&[PASTE_MODIFIER], paste_v_key()),
            PasteMethod::CtrlShiftV => (&[PASTE_MODIFIER, Key::Shift], paste_v_key()),
            PasteMethod::ShiftInsert => (&[Key::Shift], INSERT_KEY),
            other => {
                return Err(format!(
                    "Invalid paste method for clipboard paste: {:?}",
                    other
                ))
            }
        };
        Ok(Self { modifiers, key })
    }
}

/// Presses the chord's modifiers and clicks its key, leaving the modifiers
/// held. If any step fails, releases whatever was pressed before returning.
fn press_chord(enigo: &mut Enigo, chord: &PasteChord) -> Result<(), String> {
    for (pressed, modifier) in chord.modifiers.iter().enumerate() {
        if let Err(e) = enigo.key(*modifier, Direction::Press) {
            let _ = release_modifiers(enigo, &chord.modifiers[..pressed]);
            return Err(format!("Failed to press {:?}: {}", modifier, e));
        }
    }
    if let Err(e) = enigo.key(chord.key, Direction::Click) {
        let _ = release_modifiers(enigo, chord.modifiers);
        return Err(format!("Failed to click {:?}: {}", chord.key, e));
    }
    Ok(())
}

/// Releases modifiers in reverse press order.
fn release_modifiers(enigo: &mut Enigo, modifiers: &[Key]) -> Result<(), String> {
    let mut result = Ok(());
    for modifier in modifiers.iter().rev() {
        if let Err(e) = enigo.key(*modifier, Direction::Release) {
            result = Err(format!("Failed to release {:?}: {}", modifier, e));
        }
    }
    result
}

/// Sends a paste chord, keeping the modifiers held for `hold` after the key
/// click before releasing them.
///
/// Most applications read the modifier from the key event's flags and need no
/// hold at all, but applications that poll global keyboard state when handling
/// the key need the modifier to still be down (#164) — the hold insures against
/// those. This blocks the calling thread for `hold`.
pub fn send_paste_chord(
    enigo: &mut Enigo,
    chord: &PasteChord,
    hold: Duration,
) -> Result<(), String> {
    press_chord(enigo, chord)?;
    std::thread::sleep(hold);
    release_modifiers(enigo, chord.modifiers)
}

/// Like [`send_paste_chord`] with the same modifier hold, but returns right
/// after the key click. The release is sent `hold` later by a helper thread, or
/// earlier-but-not-before-due by the next [`EnigoState::lock`], so the calling
/// (main) thread is free during the hold.
///
/// `enigo` must be the guard obtained from the app's [`EnigoState`].
#[cfg(any(target_os = "macos", target_os = "windows"))]
pub fn send_paste_chord_deferred(
    app_handle: &AppHandle,
    enigo: &mut Enigo,
    chord: &PasteChord,
    hold: Duration,
) -> Result<(), String> {
    let state = app_handle
        .try_state::<EnigoState>()
        .ok_or("Enigo state not initialized")?;
    // The guard came from `state.lock()`, which already completed any earlier
    // deferral; complete defensively so a release can never be overwritten.
    state.complete_deferred_release(enigo);
    press_chord(enigo, chord)?;
    *state
        .deferred_release
        .lock()
        .unwrap_or_else(PoisonError::into_inner) = Some(DeferredRelease {
        modifiers: chord.modifiers,
        due: Instant::now() + hold,
    });

    let app_handle = app_handle.clone();
    std::thread::spawn(move || {
        std::thread::sleep(hold);
        if let Some(state) = app_handle.try_state::<EnigoState>() {
            // Locking completes the release unless a newer lock already did.
            if let Err(e) = state.lock() {
                warn!("Failed to release held paste modifiers: {e}");
            }
        }
    });
    Ok(())
}

/// Pastes text directly using the enigo text method.
/// This tries to use system input methods if possible, otherwise simulates keystrokes one by one.
pub fn paste_text_direct(enigo: &mut Enigo, text: &str) -> Result<(), String> {
    enigo
        .text(text)
        .map_err(|e| format!("Failed to send text directly: {}", e))?;

    Ok(())
}
