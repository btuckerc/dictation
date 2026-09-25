use crate::input;
use crate::settings;
use crate::settings::{
    AppSettings, OverlayColor, OverlayDesign, OverlayPosition, OverlayShape, OverlaySpeech,
};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize};

#[cfg(not(target_os = "macos"))]
use log::debug;

#[cfg(not(target_os = "macos"))]
use tauri::WebviewWindowBuilder;

#[cfg(target_os = "macos")]
use tauri::WebviewUrl;

#[cfg(target_os = "macos")]
use tauri_nspanel::{tauri_panel, CollectionBehavior, PanelBuilder, PanelLevel, StyleMask};

#[cfg(target_os = "linux")]
use crate::utils;

#[cfg(target_os = "linux")]
use gtk_layer_shell::{Edge, KeyboardMode, Layer, LayerShell};

#[cfg(target_os = "macos")]
tauri_panel! {
    panel!(RecordingOverlayPanel {
        config: {
            can_become_key_window: false,
            is_floating_panel: true
        }
    })
}

// Native overlay window sizes (logical points). One window is reused for every
// state and resized in `show_overlay_state`; each size need only be at least as
// large as the card it hosts (the `--ov-*` vars in RecordingOverlay.css). The
// card is CSS-anchored flush to the screen edge, so window height doesn't move
// where the card sits — only OVERLAY_TOP_OFFSET / OVERLAY_BOTTOM_OFFSET do. Keep
// these in sync with the CSS card geometry.
//
// On Windows these sizes are additionally multiplied by the accessibility text
// scale (see windows_text_scale_factor), which WebView2 applies as a zoom.
//
// Compact overlay: recording, transcribing and processing all keep the same
// 108x34 pill (--ov-pill-w / --ov-base-h plus borders), so release never resizes
// the visible surface. Retain window slack for placement and content scaling.
const OVERLAY_WIDTH: f64 = 256.0;
const OVERLAY_HEIGHT: f64 = 50.0;

// Actual is 394x118, just a little extra
const OVERLAY_STREAM_WIDTH: f64 = 400.0;
const OVERLAY_STREAM_HEIGHT: f64 = 120.0;

// Dynamic Orb design: one box holds either blob (orb_blob_size) in its centre
// with at least 24 pt of slack on every side for the contact seat, the appear
// overshoot and a tugged drop. Keep in sync with BOX_WIDTH / BOX_HEIGHT in
// OrbIndicator.tsx and ORB_SHAPES in orbMotion.ts.
const ORB_BOX_WIDTH: f64 = 128.0;
const ORB_BOX_HEIGHT: f64 = 104.0;

// Orb with the Live text card stacked above (below, for top placement) it.
const ORB_STREAM_WIDTH: f64 = 400.0;
const ORB_STREAM_HEIGHT: f64 = 218.0;

/// The blob itself, in points: Apple's capsule for a standalone control, or a
/// circle. Both clear the 44 pt minimum hit target.
fn orb_blob_size(shape: OverlayShape) -> (f64, f64) {
    match shape {
        OverlayShape::Capsule => (80.0, 48.0),
        OverlayShape::Circle => (56.0, 56.0),
    }
}

/// Overlay window size (logical) for a given UI state and design.
fn overlay_dimensions(state: &str, design: OverlayDesign) -> (f64, f64) {
    match (design, state == "streaming") {
        (OverlayDesign::Pill, true) => (OVERLAY_STREAM_WIDTH, OVERLAY_STREAM_HEIGHT),
        (OverlayDesign::Pill, false) => (OVERLAY_WIDTH, OVERLAY_HEIGHT),
        (OverlayDesign::Orb, true) => (ORB_STREAM_WIDTH, ORB_STREAM_HEIGHT),
        (OverlayDesign::Orb, false) => (ORB_BOX_WIDTH, ORB_BOX_HEIGHT),
    }
}

static LAST_MIC_LEVEL_EMIT: AtomicU64 = AtomicU64::new(0);
const EMIT_THROTTLE_MS: u64 = 33; // ~30 FPS

#[cfg(target_os = "macos")]
const OVERLAY_TOP_OFFSET: f64 = 46.0;
#[cfg(any(target_os = "windows", target_os = "linux"))]
const OVERLAY_TOP_OFFSET: f64 = 4.0;

#[cfg(target_os = "macos")]
const OVERLAY_BOTTOM_OFFSET: f64 = 15.0;

#[cfg(any(target_os = "windows", target_os = "linux"))]
const OVERLAY_BOTTOM_OFFSET: f64 = 40.0;

// Gap between the blob and the Dock or taskbar side of the work area, on the
// 8 pt grid: clear of the Dock's magnification without floating mid-screen.
#[cfg(target_os = "macos")]
const ORB_BOTTOM_GAP: f64 = 32.0;
#[cfg(any(target_os = "windows", target_os = "linux"))]
const ORB_BOTTOM_GAP: f64 = 56.0;

/// Window offset from the screen edge. The orb window carries transparent
/// slack around the blob, so its offset is pulled in by that slack: the
/// blob's top edge sits where the pill's does, and its bottom edge
/// ORB_BOTTOM_GAP above the work area, whatever the shape.
fn overlay_edge_offset(
    position: OverlayPosition,
    design: OverlayDesign,
    shape: OverlayShape,
) -> f64 {
    let slack = (ORB_BOX_HEIGHT - orb_blob_size(shape).1) / 2.0;
    match (position, design) {
        (OverlayPosition::Top, OverlayDesign::Pill) => OVERLAY_TOP_OFFSET,
        (OverlayPosition::Bottom, OverlayDesign::Pill) => OVERLAY_BOTTOM_OFFSET,
        (OverlayPosition::Top, OverlayDesign::Orb) => (OVERLAY_TOP_OFFSET - slack).max(0.0),
        (OverlayPosition::Bottom, OverlayDesign::Orb) => ORB_BOTTOM_GAP - slack,
    }
}

/// The blob's hit rectangle (left, top, right, bottom in global logical
/// points) currently on screen, or None while the pill is shown. Read by the
/// hover poller to find the blob.
static ORB_HIT: Mutex<Option<(f64, f64, f64, f64)>> = Mutex::new(None);

/// True while the blob is held (pressed and possibly pulled). The panel keeps
/// the mouse until release even when the pointer strays off the blob.
static ORB_HELD: AtomicBool = AtomicBool::new(false);

/// True from show until hide is requested; the hover poller runs only then.
static OVERLAY_SHOWN: AtomicBool = AtomicBool::new(false);

/// Whether the last shown state was the streaming layout, so a re-layout
/// (placement or design change) sizes the window for what is on screen.
static OVERLAY_IS_STREAMING: AtomicBool = AtomicBool::new(false);

#[cfg(target_os = "macos")]
fn lock_get<T: Copy>(slot: &Mutex<Option<T>>) -> Option<T> {
    slot.lock().ok().and_then(|guard| *guard)
}

fn lock_set<T>(slot: &Mutex<Option<T>>, value: Option<T>) {
    if let Ok(mut guard) = slot.lock() {
        *guard = value;
    }
}

/// The blob's hit rectangle inside a window of the given origin and size,
/// with a couple of points of forgiveness. The orb box is centred and flush to
/// the placement edge (RecordingOverlay.css); the blob is centred in the box.
fn orb_hit_rect(
    window: (f64, f64),
    size: (f64, f64),
    position: OverlayPosition,
    shape: OverlayShape,
) -> (f64, f64, f64, f64) {
    const FORGIVE: f64 = 2.0;
    let box_top = match position {
        OverlayPosition::Top => window.1,
        OverlayPosition::Bottom => window.1 + size.1 - ORB_BOX_HEIGHT,
    };
    let (w, h) = orb_blob_size(shape);
    let cx = window.0 + size.0 / 2.0;
    let cy = box_top + ORB_BOX_HEIGHT / 2.0;
    let (rx, ry) = (w / 2.0 + FORGIVE, h / 2.0 + FORGIVE);
    (cx - rx, cy - ry, cx + rx, cy + ry)
}

/// Record where the blob now sits (None for the pill) for the hover poller.
fn remember_orb_box(window: (f64, f64), size: (f64, f64), settings: &AppSettings) {
    let hit = (settings.overlay_design == OverlayDesign::Orb).then(|| {
        orb_hit_rect(
            window,
            size,
            settings.overlay_position,
            settings.overlay_shape,
        )
    });
    lock_set(&ORB_HIT, hit);
}

/// Configures the edge and offset of a GTK layer surface. gtk-layer-shell
/// commits anchor and margin changes itself, including while the surface is
/// mapped, so changing position does not require a manual hide/show cycle.
#[cfg(target_os = "linux")]
fn configure_layer_shell_position(
    gtk_window: &gtk::ApplicationWindow,
    position: OverlayPosition,
    design: OverlayDesign,
    shape: OverlayShape,
) {
    let margin = overlay_edge_offset(position, design, shape);
    let (edge, opposite_edge) = match position {
        OverlayPosition::Top => (Edge::Top, Edge::Bottom),
        OverlayPosition::Bottom => (Edge::Bottom, Edge::Top),
    };

    gtk_window.set_anchor(edge, true);
    gtk_window.set_anchor(opposite_edge, false);
    gtk_window.set_layer_shell_margin(edge, margin.round() as i32);
    gtk_window.set_layer_shell_margin(opposite_edge, 0);
}

/// Configures a GTK layer surface before it is shown.
///
/// Tauri's normal `set_size` path calls `gtk_window_resize`, but layer surfaces
/// derive their dimensions from GTK's size request. gtk-layer-shell documents
/// the `set_size_request` + `resize(1, 1)` sequence for forcing a new size.
#[cfg(target_os = "linux")]
fn configure_layer_shell_surface(
    gtk_window: &gtk::ApplicationWindow,
    position: OverlayPosition,
    design: OverlayDesign,
    shape: OverlayShape,
    width: f64,
    height: f64,
) {
    use gtk::prelude::{GtkWindowExt, WidgetExt};

    configure_layer_shell_position(gtk_window, position, design, shape);

    gtk_window.set_size_request(
        width.round().max(1.0) as i32,
        height.round().max(1.0) as i32,
    );
    gtk_window.resize(1, 1);
}

/// Initializes GTK layer shell for Linux overlay window
/// Returns true if layer shell was successfully initialized, false otherwise
#[cfg(target_os = "linux")]
fn init_gtk_layer_shell(overlay_window: &tauri::webview::WebviewWindow) -> bool {
    if utils::env_flag_enabled("DICTATION_NO_GTK_LAYER_SHELL") {
        debug!("Skipping GTK layer shell init (DICTATION_NO_GTK_LAYER_SHELL is enabled)");
        return false;
    }

    if !gtk_layer_shell::is_supported() {
        return false;
    }

    // Try to get the GTK window from the Tauri webview
    if let Ok(gtk_window) = overlay_window.gtk_window() {
        gtk_window.init_layer_shell();
        gtk_window.set_layer(Layer::Overlay);
        gtk_window.set_keyboard_mode(KeyboardMode::None);
        gtk_window.set_exclusive_zone(0);

        let settings = settings::get_settings(overlay_window.app_handle());
        let (width, height) = overlay_dimensions("recording", settings.overlay_design);
        configure_layer_shell_surface(
            &gtk_window,
            settings.overlay_position,
            settings.overlay_design,
            settings.overlay_shape,
            width,
            height,
        );

        let initialized = gtk_window.is_layer_window();
        LAYER_SHELL_ACTIVE.store(initialized, Ordering::SeqCst);
        return initialized;
    }
    false
}

/// Forces a window to be topmost using Win32 API (Windows only)
/// This is more reliable than Tauri's set_always_on_top which can be overridden
#[cfg(target_os = "windows")]
fn force_overlay_topmost(overlay_window: &tauri::webview::WebviewWindow) {
    use windows::Win32::UI::WindowsAndMessaging::{
        SetWindowPos, HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_SHOWWINDOW,
    };

    // Clone because run_on_main_thread takes 'static
    let overlay_clone = overlay_window.clone();

    // Make sure the Win32 call happens on the UI thread
    let _ = overlay_clone.clone().run_on_main_thread(move || {
        if let Ok(hwnd) = overlay_clone.hwnd() {
            unsafe {
                // Force Z-order: make this window topmost without changing size/pos or stealing focus
                let _ = SetWindowPos(
                    hwnd,
                    Some(HWND_TOPMOST),
                    0,
                    0,
                    0,
                    0,
                    SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW,
                );
            }
        }
    });
}

fn get_monitor_with_cursor(app_handle: &AppHandle) -> Option<tauri::Monitor> {
    if let Some(mouse_location) = input::get_cursor_position(app_handle) {
        if let Ok(monitors) = app_handle.available_monitors() {
            for monitor in monitors {
                // On Windows both the cursor (enigo -> GetCursorPos) and the
                // monitor bounds are physical pixels, so compare them directly.
                #[cfg(target_os = "windows")]
                if is_mouse_within_monitor(mouse_location, monitor.position(), monitor.size()) {
                    return Some(monitor);
                }

                // macOS/Linux: enigo returns logical coords, so scale the bounds down.
                #[cfg(not(target_os = "windows"))]
                {
                    let scale = monitor.scale_factor();
                    let pos = PhysicalPosition::new(
                        (monitor.position().x as f64 / scale) as i32,
                        (monitor.position().y as f64 / scale) as i32,
                    );
                    let size = PhysicalSize::new(
                        (monitor.size().width as f64 / scale) as u32,
                        (monitor.size().height as f64 / scale) as u32,
                    );
                    if is_mouse_within_monitor(mouse_location, &pos, &size) {
                        return Some(monitor);
                    }
                }
            }
        }
    }

    app_handle.primary_monitor().ok().flatten()
}

fn is_mouse_within_monitor(
    mouse_pos: (i32, i32),
    monitor_pos: &PhysicalPosition<i32>,
    monitor_size: &PhysicalSize<u32>,
) -> bool {
    let (mouse_x, mouse_y) = mouse_pos;
    let PhysicalPosition {
        x: monitor_x,
        y: monitor_y,
    } = *monitor_pos;
    let PhysicalSize {
        width: monitor_width,
        height: monitor_height,
    } = *monitor_size;

    mouse_x >= monitor_x
        && mouse_x < (monitor_x + monitor_width as i32)
        && mouse_y >= monitor_y
        && mouse_y < (monitor_y + monitor_height as i32)
}

/// Returns overlay position in logical coordinates (points on macOS).
///
/// The Bottom anchor uses the macOS work area (visibleFrame) so the overlay
/// tracks the Dock — above it when shown, at the screen edge when hidden.
/// This relies on tauri 2.11's work_area.position.y fix (#14655), the same
/// bug that led PR #969 to abandon work_area for full monitor bounds. Top and
/// the other platforms keep full monitor bounds plus the fixed offsets
/// (work_area is unreliable on Wayland; Windows' offset clears the taskbar).
///
/// We must use LogicalPosition (not PhysicalPosition) because Tauri/tao
/// converts PhysicalPosition using the scale factor of the monitor the window
/// is *currently* on, which is wrong when moving cross-monitor. Windows uses
/// `place_windows_overlay` instead (no single logical space across mixed DPI).
fn calculate_overlay_position(
    app_handle: &AppHandle,
    width: f64,
    height: f64,
) -> Option<(f64, f64)> {
    let monitor = get_monitor_with_cursor(app_handle)?;
    let scale = monitor.scale_factor();
    let monitor_x = monitor.position().x as f64 / scale;
    let monitor_y = monitor.position().y as f64 / scale;
    let monitor_width = monitor.size().width as f64 / scale;

    let settings = settings::get_settings(app_handle);

    let x = monitor_x + (monitor_width - width) / 2.0;
    let offset = overlay_edge_offset(
        settings.overlay_position,
        settings.overlay_design,
        settings.overlay_shape,
    );
    let y = match settings.overlay_position {
        OverlayPosition::Top => monitor_y + offset,
        OverlayPosition::Bottom => {
            // work_area.position shares monitor.position's global coordinate
            // space, so no monitor offset is added.
            #[cfg(target_os = "macos")]
            let bottom = {
                let wa = monitor.work_area();
                (wa.position.y as f64 + wa.size.height as f64) / scale
            };
            #[cfg(not(target_os = "macos"))]
            let bottom = monitor_y + monitor.size().height as f64 / scale;

            bottom - height - offset
        }
    };

    Some((x, y))
}

/// Windows accessibility text size (Settings > Accessibility > Text size), a
/// separate axis from display scaling that WebView2 applies as a document zoom.
#[cfg(target_os = "windows")]
fn windows_text_scale_factor() -> f64 {
    // Absent until the user moves the slider off 100%; stored as a percentage.
    winreg::RegKey::predef(winreg::enums::HKEY_CURRENT_USER)
        .open_subkey(r"Software\Microsoft\Accessibility")
        .and_then(|key| key.get_value::<u32, _>("TextScaleFactor"))
        .map(|percent| (percent as f64 / 100.0).clamp(1.0, 2.25))
        .unwrap_or(1.0)
}

/// Overlay rectangle in the destination monitor's physical pixels, so nothing
/// is converted through the window's previous-monitor DPI.
#[cfg(target_os = "windows")]
#[allow(clippy::too_many_arguments)]
fn windows_overlay_bounds(
    monitor_position: PhysicalPosition<i32>,
    monitor_size: PhysicalSize<u32>,
    scale: f64,
    text_scale: f64,
    logical_width: f64,
    logical_height: f64,
    overlay_position: OverlayPosition,
    design: OverlayDesign,
    shape: OverlayShape,
) -> (i32, i32, i32, i32) {
    // Grow the window with the text scale; offsets stay DPI-only since the
    // card sits flush against the window's screen-edge side.
    let content_scale = scale * text_scale;
    let width = (logical_width * content_scale).round().max(1.0) as i32;
    let height = (logical_height * content_scale).round().max(1.0) as i32;
    let x = (monitor_position.x as f64 + (monitor_size.width as f64 - width as f64) / 2.0).round()
        as i32;
    let offset = overlay_edge_offset(overlay_position, design, shape) * scale;
    let y = match overlay_position {
        OverlayPosition::Top => (monitor_position.y as f64 + offset).round() as i32,
        OverlayPosition::Bottom => {
            (monitor_position.y as f64 + monitor_size.height as f64 - height as f64 - offset)
                .round() as i32
        }
    };

    (x, y, width, height)
}

/// Moves and sizes the overlay in one native SetWindowPos, bypassing tao's
/// current-DPI logical conversion that mislands cross-monitor moves.
#[cfg(target_os = "windows")]
fn place_windows_overlay(
    app_handle: &AppHandle,
    overlay_window: &tauri::webview::WebviewWindow,
    logical_width: f64,
    logical_height: f64,
) -> Result<(), String> {
    use windows::Win32::UI::WindowsAndMessaging::{SetWindowPos, SWP_NOACTIVATE, SWP_NOZORDER};

    let monitor = get_monitor_with_cursor(app_handle)
        .ok_or_else(|| "failed to determine the monitor containing the cursor".to_string())?;
    let text_scale = windows_text_scale_factor();
    let settings = settings::get_settings(app_handle);
    let (x, y, width, height) = windows_overlay_bounds(
        *monitor.position(),
        *monitor.size(),
        monitor.scale_factor(),
        text_scale,
        logical_width,
        logical_height,
        settings.overlay_position,
        settings.overlay_design,
        settings.overlay_shape,
    );
    let hwnd = overlay_window
        .hwnd()
        .map_err(|error| format!("failed to get overlay window handle: {error}"))?;

    unsafe {
        SetWindowPos(
            hwnd,
            None,
            x,
            y,
            width,
            height,
            SWP_NOACTIVATE | SWP_NOZORDER,
        )
        .map_err(|error| format!("failed to set overlay bounds: {error}"))?;
    }

    log::debug!(
        "windows overlay bounds: x={} y={} width={} height={} scale={} text_scale={}",
        x,
        y,
        width,
        height,
        monitor.scale_factor(),
        text_scale
    );
    Ok(())
}

/// Creates the recording overlay window and keeps it hidden by default
#[cfg(not(target_os = "macos"))]
pub fn create_recording_overlay(app_handle: &AppHandle) {
    // On Linux (Wayland), monitor detection often fails, but we don't need exact coordinates
    // for Layer Shell as we use anchors. On other platforms, we require a monitor.
    #[cfg(not(target_os = "linux"))]
    {
        let position = calculate_overlay_position(app_handle, OVERLAY_WIDTH, OVERLAY_HEIGHT);
        if position.is_none() {
            debug!("Failed to determine overlay position, not creating overlay window");
            return;
        }
    }

    // Position starts unset — update_overlay_position() sets the correct
    // LogicalPosition before the overlay is shown.
    let mut builder = WebviewWindowBuilder::new(
        app_handle,
        "recording_overlay",
        tauri::WebviewUrl::App("src/overlay/index.html".into()),
    )
    .title("Recording")
    .resizable(false)
    .inner_size(OVERLAY_WIDTH, OVERLAY_HEIGHT)
    .shadow(false)
    .maximizable(false)
    .minimizable(false)
    .closable(false)
    .accept_first_mouse(true)
    .decorations(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .transparent(true)
    .focusable(false)
    .focused(false)
    .visible(false);

    if let Some(data_dir) = crate::portable::data_dir() {
        builder = builder.data_directory(data_dir.join("webview"));
    }

    #[allow(unused_variables)]
    match builder.build() {
        Ok(window) => {
            #[cfg(target_os = "linux")]
            {
                // Try to initialize GTK layer shell, ignore errors if compositor doesn't support it
                if init_gtk_layer_shell(&window) {
                    debug!("GTK layer shell initialized for overlay window");
                } else {
                    debug!("GTK layer shell not available, falling back to regular window");
                }
            }

            debug!("Recording overlay window created successfully (hidden)");
        }
        Err(e) => {
            debug!("Failed to create recording overlay window: {}", e);
        }
    }
}

/// Creates the recording overlay panel and keeps it hidden by default (macOS)
#[cfg(target_os = "macos")]
pub fn create_recording_overlay(app_handle: &AppHandle) {
    if let Some((x, y)) = calculate_overlay_position(app_handle, OVERLAY_WIDTH, OVERLAY_HEIGHT) {
        // PanelBuilder creates a Tauri window then converts it to NSPanel.
        // The window remains registered, so get_webview_window() still works.
        match PanelBuilder::<_, RecordingOverlayPanel>::new(app_handle, "recording_overlay")
            .url(WebviewUrl::App("src/overlay/index.html".into()))
            .title("Recording")
            .position(tauri::Position::Logical(tauri::LogicalPosition { x, y }))
            .level(PanelLevel::Status)
            .size(tauri::Size::Logical(tauri::LogicalSize {
                width: OVERLAY_WIDTH,
                height: OVERLAY_HEIGHT,
            }))
            .has_shadow(false)
            .transparent(true)
            .no_activate(true)
            .corner_radius(0.0)
            .style_mask(StyleMask::empty().borderless().nonactivating_panel())
            // accept_first_mouse: the panel is never key, so without it the
            // first click on the orb would be swallowed instead of starting a
            // drag. Clicks still never activate the app (nonactivating panel).
            .with_window(|w| {
                w.decorations(false)
                    .transparent(true)
                    .focusable(false)
                    .accept_first_mouse(true)
            })
            .collection_behavior(
                CollectionBehavior::new()
                    .can_join_all_spaces()
                    .full_screen_auxiliary(),
            )
            .build()
        {
            Ok(panel) => {
                panel.hide();
                // Click-through everywhere by default; the orb's hover poller
                // lifts this only while the cursor is over the blob itself.
                if let Some(window) = app_handle.get_webview_window("recording_overlay") {
                    let _ = window.set_ignore_cursor_events(true);
                }
            }
            Err(e) => {
                log::error!("Failed to create recording overlay panel: {}", e);
            }
        }
    }
}

fn show_overlay_state(app_handle: &AppHandle, state: &str) {
    // Whether the overlay shows at all is governed by show_overlay; position
    // only chooses Top vs Bottom placement. Checked here (off the main thread)
    // so the common overlay-disabled case never pays for a main-thread hop.
    let settings = settings::get_settings(app_handle);
    if !settings.show_overlay {
        return;
    }

    // The rest queries monitors and the cursor and mutates window geometry. On
    // Linux the monitor/cursor lookups hit GDK/Xlib on the process's shared X11
    // connection, which is only safe from the GTK main thread — running them on
    // a background thread corrupts the connection and hard-crashes the app
    // (issue #227). Hop to the main thread on every platform to keep the
    // geometry path uniform (a no-op cost on Windows, and it also keeps macOS's
    // NSScreen access main-thread-correct). run_on_main_thread runs the closure
    // inline when already on the main thread, so this never deadlocks.
    let handle = app_handle.clone();
    let state = state.to_string();
    let _ = app_handle
        .run_on_main_thread(move || show_overlay_state_on_main(&handle, &state, &settings));
}

fn show_overlay_state_on_main(app_handle: &AppHandle, state: &str, settings: &AppSettings) {
    let design = settings.overlay_design;
    OVERLAY_IS_STREAMING.store(state == "streaming", Ordering::Relaxed);
    // Size the overlay for this state and design, then position it.
    let (width, height) = overlay_dimensions(state, design);
    if let Some(overlay_window) = app_handle.get_webview_window("recording_overlay") {
        // Invalidate any delayed hide still in flight from a previous session
        // (see `hide_recording_overlay`).
        OVERLAY_SHOW_GENERATION.fetch_add(1, Ordering::SeqCst);

        #[cfg(target_os = "linux")]
        let shown_with_layer_shell = if LAYER_SHELL_ACTIVE.load(Ordering::SeqCst) {
            match overlay_window.gtk_window() {
                Ok(gtk_window) => configure_layer_shell_surface(
                    &gtk_window,
                    settings.overlay_position,
                    design,
                    settings.overlay_shape,
                    width,
                    height,
                ),
                Err(error) => log::error!("Failed to access GTK overlay window: {error}"),
            }
            let _ = overlay_window.show();
            true
        } else {
            false
        };
        #[cfg(not(target_os = "linux"))]
        let shown_with_layer_shell = false;

        if !shown_with_layer_shell {
            let size_started = std::time::Instant::now();
            #[cfg(not(target_os = "windows"))]
            let _ =
                overlay_window.set_size(tauri::Size::Logical(tauri::LogicalSize { width, height }));
            let size_elapsed = size_started.elapsed();

            let pos_started = std::time::Instant::now();
            #[cfg(not(target_os = "windows"))]
            let set_pos_elapsed =
                if let Some((x, y)) = calculate_overlay_position(app_handle, width, height) {
                    let set_pos_started = std::time::Instant::now();
                    let _ = overlay_window
                        .set_position(tauri::Position::Logical(tauri::LogicalPosition { x, y }));
                    remember_orb_box((x, y), (width, height), settings);
                    set_pos_started.elapsed()
                } else {
                    std::time::Duration::ZERO
                };
            #[cfg(target_os = "windows")]
            let set_pos_elapsed = {
                let set_pos_started = std::time::Instant::now();
                if let Err(error) =
                    place_windows_overlay(app_handle, &overlay_window, width, height)
                {
                    log::error!("Failed to place recording overlay: {error}");
                }
                set_pos_started.elapsed()
            };
            let pos_calc_elapsed = pos_started.elapsed() - set_pos_elapsed;

            let show_started = std::time::Instant::now();
            let _ = overlay_window.show();
            let show_elapsed = show_started.elapsed();

            // On Windows, aggressively re-assert "topmost" in the native Z-order after showing
            #[cfg(target_os = "windows")]
            force_overlay_topmost(&overlay_window);

            // Re-assert bounds after show(): the pre-show move crosses the DPI
            // boundary, and tao's WM_DPICHANGED reflow clobbers the first placement.
            #[cfg(target_os = "windows")]
            if let Err(error) = place_windows_overlay(app_handle, &overlay_window, width, height) {
                log::error!("Failed to re-assert recording overlay position: {error}");
            }

            log::debug!(
                "overlay '{}': set_size={:?} pos_calc={:?} set_pos={:?} show={:?}",
                state,
                size_elapsed,
                pos_calc_elapsed,
                set_pos_elapsed,
                show_elapsed
            );
        }

        let _ = overlay_window.emit("show-overlay", state);
        OVERLAY_SHOWN.store(true, Ordering::SeqCst);
        #[cfg(target_os = "macos")]
        start_orb_hover_poll(app_handle);
    }
}

/// Notify the visible recording overlay that the input stream has delivered its
/// first sample chunk. Audio feedback uses the same backend readiness signal,
/// but this targeted event is skipped when overlays are disabled.
pub fn emit_recording_ready(app_handle: &AppHandle) {
    if !OVERLAY_ENABLED.load(Ordering::Relaxed) {
        return;
    }

    // Showing the overlay is also queued onto the main thread. Queue readiness
    // there as well so a very fast always-on stream cannot overtake show-overlay
    // and then get reset back to the arming state by the frontend.
    let handle = app_handle.clone();
    let _ = app_handle.run_on_main_thread(move || {
        let _ = handle.emit_to("recording_overlay", "recording-ready", ());
    });
}

/// Tell the overlay webview which design to draw. It also reads the setting
/// whenever it is shown; this covers a change made while it is on screen.
pub fn emit_overlay_design(app_handle: &AppHandle, design: OverlayDesign) {
    let _ = app_handle.emit_to("recording_overlay", "overlay-design", design);
}

/// The Orb's light and silhouette, sent together so the overlay applies them
/// as one.
#[derive(Clone, serde::Serialize)]
pub struct OverlayLook {
    pub speech: OverlaySpeech,
    pub color: OverlayColor,
    pub shape: OverlayShape,
}

/// Tell the live overlay its look changed; like the design, it also rereads
/// the look from settings whenever it is shown.
pub fn emit_overlay_look(app_handle: &AppHandle, settings: &AppSettings) {
    let _ = app_handle.emit_to(
        "recording_overlay",
        "overlay-look",
        OverlayLook {
            speech: settings.overlay_speech,
            color: settings.overlay_color,
            shape: settings.overlay_shape,
        },
    );
}

/// Shows the recording overlay window with fade-in animation
pub fn show_recording_overlay(app_handle: &AppHandle) {
    show_overlay_state(app_handle, "recording");
}

/// Shows the larger streaming overlay that displays live transcription text
pub fn show_streaming_overlay(app_handle: &AppHandle) {
    show_overlay_state(app_handle, "streaming");
}

/// Shows the transcribing overlay window
pub fn show_transcribing_overlay(app_handle: &AppHandle) {
    show_overlay_state(app_handle, "transcribing");
}

/// Shows the processing overlay window
pub fn show_processing_overlay(app_handle: &AppHandle) {
    show_overlay_state(app_handle, "processing");
}

/// Re-size and re-place the overlay after a placement or design setting
/// changed, so switching Pill and Orb while it is on screen takes effect at
/// once instead of drawing one design in the other's window.
pub fn update_overlay_position(app_handle: &AppHandle) {
    // Positioning queries monitors/cursor (GDK/Xlib on Linux) and moves the
    // window, so it must run on the main thread — see show_overlay_state.
    let handle = app_handle.clone();
    let _ = app_handle.run_on_main_thread(move || update_overlay_position_on_main(&handle));
}

fn update_overlay_position_on_main(app_handle: &AppHandle) {
    let Some(overlay_window) = app_handle.get_webview_window("recording_overlay") else {
        return;
    };
    let settings = settings::get_settings(app_handle);
    let state = if OVERLAY_IS_STREAMING.load(Ordering::Relaxed) {
        "streaming"
    } else {
        "recording"
    };
    let (width, height) = overlay_dimensions(state, settings.overlay_design);

    #[cfg(target_os = "linux")]
    if LAYER_SHELL_ACTIVE.load(Ordering::SeqCst) {
        match overlay_window.gtk_window() {
            Ok(gtk_window) => configure_layer_shell_surface(
                &gtk_window,
                settings.overlay_position,
                settings.overlay_design,
                settings.overlay_shape,
                width,
                height,
            ),
            Err(error) => log::error!("Failed to access GTK overlay window: {error}"),
        }
        return;
    }

    #[cfg(target_os = "windows")]
    if let Err(error) = place_windows_overlay(app_handle, &overlay_window, width, height) {
        log::error!("Failed to update recording overlay position: {error}");
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = overlay_window.set_size(tauri::Size::Logical(tauri::LogicalSize { width, height }));
        if let Some((x, y)) = calculate_overlay_position(app_handle, width, height) {
            let _ = overlay_window
                .set_position(tauri::Position::Logical(tauri::LogicalPosition { x, y }));
            remember_orb_box((x, y), (width, height), &settings);
        }
    }
}

/// The orb is pressed (`true`) or released. The orb itself stays anchored; a
/// pull only stretches the drop, which springs back on release.
#[tauri::command]
#[specta::specta]
pub fn orb_set_held(held: bool) {
    ORB_HELD.store(held, Ordering::SeqCst);
}

#[cfg(target_os = "macos")]
static ORB_HOVER_POLLING: AtomicBool = AtomicBool::new(false);

/// Whether the cursor is on the blob (or the blob is held).
#[cfg(target_os = "macos")]
fn cursor_on_orb(app_handle: &AppHandle) -> bool {
    if ORB_HELD.load(Ordering::SeqCst) {
        return true;
    }
    let (Some((left, top, right, bottom)), Some((cx, cy))) =
        (lock_get(&ORB_HIT), input::get_cursor_position(app_handle))
    else {
        return false;
    };
    let (cx, cy) = (cx as f64, cy as f64);
    cx >= left && cx <= right && cy >= top && cy <= bottom
}

/// Take the mouse only over the blob, so the rest of the panel stays
/// click-through.
#[cfg(target_os = "macos")]
fn set_orb_hover(app_handle: &AppHandle, hovering: bool) {
    let handle = app_handle.clone();
    let _ = app_handle.run_on_main_thread(move || {
        if let Some(window) = handle.get_webview_window("recording_overlay") {
            let _ = window.set_ignore_cursor_events(!hovering);
        }
    });
}

/// The panel stays click-through (transparent slack, Live card and pill
/// included) except while the cursor is over the orb's blob. AppKit can't
/// report hover to a window that ignores the mouse, so poll the cursor while
/// the overlay is shown: 20 Hz at rest, 60 Hz while hovering.
#[cfg(target_os = "macos")]
fn start_orb_hover_poll(app_handle: &AppHandle) {
    if ORB_HOVER_POLLING.swap(true, Ordering::SeqCst) {
        return;
    }
    let app = app_handle.clone();
    std::thread::spawn(move || loop {
        let mut hovering = false;
        while OVERLAY_SHOWN.load(Ordering::SeqCst) {
            let over = cursor_on_orb(&app);
            if over != hovering {
                hovering = over;
                set_orb_hover(&app, over);
            }
            let ms = if hovering { 16 } else { 50 };
            std::thread::sleep(std::time::Duration::from_millis(ms));
        }
        if hovering {
            set_orb_hover(&app, false);
        }
        ORB_HOVER_POLLING.store(false, Ordering::SeqCst);
        // A show that landed while this thread was winding down saw the flag
        // still set and didn't start a poller; take over for it.
        if !OVERLAY_SHOWN.load(Ordering::SeqCst) || ORB_HOVER_POLLING.swap(true, Ordering::SeqCst) {
            break;
        }
    });
}

/// Generation counter bumped every time the overlay is shown. The delayed
/// `hide()` below only unmaps the window if no show happened after it was
/// scheduled, so a hide left over from a finished transcription can never
/// take down the overlay of a session that started in the meantime — e.g. a
/// press the coordinator remembered while the pipeline was busy and started
/// the instant it drained, well inside the 300 ms hide delay.
static OVERLAY_SHOW_GENERATION: AtomicU64 = AtomicU64::new(0);

/// Hides the recording overlay window with fade-out animation
pub fn hide_recording_overlay(app_handle: &AppHandle) {
    // Always hide the overlay regardless of settings - if setting was changed while recording,
    // we still want to hide it properly
    // A fading orb is no longer grabbable: the hover poller winds down and
    // hands the mouse back to whatever is underneath.
    OVERLAY_SHOWN.store(false, Ordering::SeqCst);
    ORB_HELD.store(false, Ordering::SeqCst);
    if let Some(overlay_window) = app_handle.get_webview_window("recording_overlay") {
        // Snapshot before doing anything observable, so any show that lands
        // after this point invalidates the delayed hide below.
        let scheduled_at = OVERLAY_SHOW_GENERATION.load(Ordering::SeqCst);
        // Emit event to trigger fade-out animation
        let _ = overlay_window.emit("hide-overlay", ());
        // Hide the window after a short delay to allow animation to complete,
        // unless a newer session has shown the overlay again by then.
        let window_clone = overlay_window.clone();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(300));
            if OVERLAY_SHOW_GENERATION.load(Ordering::SeqCst) != scheduled_at {
                log::debug!("Skipping stale overlay hide: a newer session is showing the overlay");
                return;
            }
            let _ = window_clone.hide();
        });
    }
}

// Cached "overlay is enabled" flag, kept in sync with show_overlay. Avoids
// reading the Tauri store on every audio callback (~24 Hz during recording).
// Defaults to false so the audio path doesn't emit until lib.rs::setup
// populates the cache from initial settings.
static OVERLAY_ENABLED: AtomicBool = AtomicBool::new(false);

/// Tracks whether gtk-layer-shell was successfully initialized (Linux only).
/// Used to skip layer-shell calls when the window is a regular fallback.
#[cfg(target_os = "linux")]
static LAYER_SHELL_ACTIVE: AtomicBool = AtomicBool::new(false);

/// Update the cached overlay-enabled flag. Called from `lib.rs` at
/// startup after settings load, and from `change_show_overlay_setting`
/// whenever the user changes whether the overlay is shown.
pub fn update_overlay_enabled_cache(enabled: bool) {
    OVERLAY_ENABLED.store(enabled, Ordering::Relaxed);
}

pub fn emit_levels(app_handle: &AppHandle, levels: &[f32]) {
    // Skip emission when the overlay is disabled. The recording_overlay
    // window is created at boot regardless of show_overlay, so without this
    // guard a hidden overlay's WebKit subprocess still
    // processes every event. Each event drives some kind of WebKit
    // C++ allocation that accumulates without bound (mechanism not
    // directly characterized; see issue #1279 for the investigation).
    // For users with `show_overlay: false` (the Linux default) this skip
    // eliminates the upstream driver of that accumulation.
    if !OVERLAY_ENABLED.load(Ordering::Relaxed) {
        return;
    }

    // Throttle to ~30 FPS. Even with the overlay enabled, the raw audio
    // callback fires far faster than the UI needs; capping emission rate
    // cuts the per-frame `eval_script`/IPC volume that drives the wry
    // memory growth in issue #1279 (upstream tauri-apps/wry#1489).
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;
    let last = LAST_MIC_LEVEL_EMIT.load(Ordering::Relaxed);
    if now.saturating_sub(last) < EMIT_THROTTLE_MS {
        return;
    }
    LAST_MIC_LEVEL_EMIT.store(now, Ordering::Relaxed);

    // Target only the overlay window. In Tauri 2 both `AppHandle::emit`
    // and `WebviewWindow::emit` broadcast to all webviews; Tauri's
    // listener filter then skips webviews with no registered listener
    // for the event, so the settings webview never received `mic-level`.
    // But the previous dual-call pattern still produced two `eval_script`
    // calls to the overlay per audio callback (one from each .emit()).
    // `emit_to` with the overlay's window label produces a single
    // eval_script call per callback, cutting the per-callback WebKit
    // dispatch work in half.
    let _ = app_handle.emit_to("recording_overlay", "mic-level", levels);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn monitor_hit_test_uses_half_open_physical_bounds() {
        let position = PhysicalPosition::new(-2560, -200);
        let size = PhysicalSize::new(2560, 1440);

        assert!(is_mouse_within_monitor((-2560, -200), &position, &size));
        assert!(is_mouse_within_monitor((-1, 1239), &position, &size));
        assert!(!is_mouse_within_monitor((0, 0), &position, &size));
        assert!(!is_mouse_within_monitor((-1, 1240), &position, &size));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn windows_cursor_hit_test_does_not_scale_physical_monitor_bounds() {
        let position = PhysicalPosition::new(1920, 0);
        let size = PhysicalSize::new(3840, 2160);
        let cursor = (5000, 1000);

        assert!(is_mouse_within_monitor(cursor, &position, &size));

        // This is the old mixed-coordinate comparison. It excludes a cursor
        // that is visibly inside a secondary display running at 150%.
        let scale = 1.5;
        let logical_position = PhysicalPosition::new(
            (position.x as f64 / scale) as i32,
            (position.y as f64 / scale) as i32,
        );
        let logical_size = PhysicalSize::new(
            (size.width as f64 / scale) as u32,
            (size.height as f64 / scale) as u32,
        );
        assert!(!is_mouse_within_monitor(
            cursor,
            &logical_position,
            &logical_size
        ));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn windows_overlay_bounds_use_destination_monitor_scale() {
        let monitor_position = PhysicalPosition::new(1920, 0);
        let monitor_size = PhysicalSize::new(3840, 2160);

        assert_eq!(
            windows_overlay_bounds(
                monitor_position,
                monitor_size,
                1.5,
                1.0,
                OVERLAY_WIDTH,
                OVERLAY_HEIGHT,
                OverlayPosition::Bottom,
                OverlayDesign::Pill,
                OverlayShape::Capsule,
            ),
            (3648, 2025, 384, 75)
        );
        assert_eq!(
            windows_overlay_bounds(
                monitor_position,
                monitor_size,
                1.5,
                1.0,
                OVERLAY_WIDTH,
                OVERLAY_HEIGHT,
                OverlayPosition::Top,
                OverlayDesign::Pill,
                OverlayShape::Capsule,
            ),
            (3648, 6, 384, 75)
        );
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn windows_overlay_bounds_support_negative_monitor_origins() {
        assert_eq!(
            windows_overlay_bounds(
                PhysicalPosition::new(-2560, -200),
                PhysicalSize::new(2560, 1440),
                1.25,
                1.0,
                OVERLAY_STREAM_WIDTH,
                OVERLAY_STREAM_HEIGHT,
                OverlayPosition::Bottom,
                OverlayDesign::Pill,
                OverlayShape::Capsule,
            ),
            (-1530, 1040, 500, 150)
        );
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn windows_overlay_bounds_grow_with_text_scale_without_moving_the_anchored_edge() {
        let monitor_position = PhysicalPosition::new(-2560, -200);
        let monitor_size = PhysicalSize::new(2560, 1440);

        let (x, y, width, height) = windows_overlay_bounds(
            monitor_position,
            monitor_size,
            1.25,
            1.1,
            OVERLAY_STREAM_WIDTH,
            OVERLAY_STREAM_HEIGHT,
            OverlayPosition::Bottom,
            OverlayDesign::Pill,
            OverlayShape::Capsule,
        );
        // 400x120 logical at 1.25 DPI x 1.1 text, still centered horizontally.
        assert_eq!((x, y, width, height), (-1555, 1025, 550, 165));
        // Bottom edge unchanged from the 1.0 case above (1040 + 150).
        assert_eq!(y + height, 1190);

        let (_, top_y, _, _) = windows_overlay_bounds(
            monitor_position,
            monitor_size,
            1.25,
            1.1,
            OVERLAY_STREAM_WIDTH,
            OVERLAY_STREAM_HEIGHT,
            OverlayPosition::Top,
            OverlayDesign::Pill,
            OverlayShape::Capsule,
        );
        // Top offset rides the DPI scale alone, so the top edge doesn't move.
        assert_eq!(top_y, -195);
    }
}
