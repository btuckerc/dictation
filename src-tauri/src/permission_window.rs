//! Best-effort positioning of our window using read-only window metadata.
#[derive(Clone, Copy, Debug)]
struct Rect {
    x: f64,
    y: f64,
    w: f64,
    h: f64,
}

fn adjacent(target: Rect, screen: Rect, width: f64, height: f64) -> Option<(f64, f64)> {
    if width > screen.w || height > screen.h {
        return None;
    }
    let gap = 16.0;
    let y = target.y.max(screen.y).min(screen.y + screen.h - height);
    let right = target.x + target.w + gap;
    if right >= screen.x && right + width <= screen.x + screen.w {
        return Some((right, y));
    }
    let left = target.x - gap - width;
    if left >= screen.x && left + width <= screen.x + screen.w {
        return Some((left, y));
    }
    None
}

#[cfg(target_os = "macos")]
pub fn position(window: &tauri::Window) -> Result<bool, String> {
    use core_foundation::{
        base::{CFType, TCFType},
        dictionary::CFDictionary,
        number::CFNumber,
        string::CFString,
    };
    use core_graphics::window::{
        copy_window_info, kCGWindowListExcludeDesktopElements, kCGWindowListOptionOnScreenOnly,
    };
    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSRunningApplication, NSScreen, NSWindow};
    use objc2_foundation::{NSPoint, NSString};

    fn value(dict: &CFDictionary, key: &str) -> Option<CFType> {
        let key = CFString::new(key);
        let raw = *dict.find(key.as_CFTypeRef())?;
        // Window metadata dictionaries retain their CFType values.
        Some(unsafe { CFType::wrap_under_get_rule(raw) })
    }
    fn number(dict: &CFDictionary, key: &str) -> Option<f64> {
        value(dict, key)?.downcast::<CFNumber>()?.to_f64()
    }
    let mtm = MainThreadMarker::new().ok_or("Window placement requires the main thread")?;
    let apps = NSRunningApplication::runningApplicationsWithBundleIdentifier(&NSString::from_str(
        "com.apple.systempreferences",
    ));
    let Some(settings) = apps.iter().next() else {
        return Ok(false);
    };
    let pid = settings.processIdentifier() as f64;
    let Some(windows) = copy_window_info(
        kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements,
        0,
    ) else {
        return Ok(false);
    };
    let target = windows.iter().find_map(|raw| {
        // CGWindowListCopyWindowInfo returns an array of CFDictionary objects.
        let dict = unsafe { CFType::wrap_under_get_rule(*raw) }.downcast::<CFDictionary>()?;
        if number(&dict, "kCGWindowOwnerPID")? != pid || number(&dict, "kCGWindowLayer")? != 0.0 {
            return None;
        }
        let bounds = value(&dict, "kCGWindowBounds")?.downcast::<CFDictionary>()?;
        let rect = Rect {
            x: number(&bounds, "X")?,
            y: number(&bounds, "Y")?,
            w: number(&bounds, "Width")?,
            h: number(&bounds, "Height")?,
        };
        (rect.w > 400.0 && rect.h > 300.0).then_some(rect)
    });
    let Some(target) = target else {
        return Ok(false);
    };
    let screens = NSScreen::screens(mtm);
    let Some(primary) = screens.iter().next() else {
        return Ok(false);
    };
    let primary_height = primary.frame().size.height;
    // CG bounds use a top-left origin in logical points. AppKit uses bottom-left.
    let screen = screens.iter().find_map(|screen| {
        let frame = screen.frame();
        let top = primary_height - frame.origin.y - frame.size.height;
        let cx = target.x + target.w / 2.0;
        let cy = target.y + target.h / 2.0;
        if cx < frame.origin.x
            || cx >= frame.origin.x + frame.size.width
            || cy < top
            || cy >= top + frame.size.height
        {
            return None;
        }
        let visible = screen.visibleFrame();
        Some(Rect {
            x: visible.origin.x,
            y: primary_height - visible.origin.y - visible.size.height,
            w: visible.size.width,
            h: visible.size.height,
        })
    });
    let Some(screen) = screen else {
        return Ok(false);
    };
    let pointer = window.ns_window().map_err(|e| e.to_string())?;
    // Tauri owns the live NSWindow throughout this main-thread invocation.
    let native = unsafe { &*pointer.cast::<NSWindow>() };
    let frame = native.frame();
    if let Some((x, y)) = adjacent(target, screen, frame.size.width, frame.size.height) {
        native.setFrameOrigin(NSPoint::new(x, primary_height - y - frame.size.height));
        Ok(true)
    } else {
        // Settings is present, but there is no safe adjacent space. Stop retries.
        Ok(true)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn uses_right_space_and_clamps_to_work_area() {
        assert_eq!(
            adjacent(
                Rect {
                    x: 100.,
                    y: -20.,
                    w: 600.,
                    h: 700.
                },
                Rect {
                    x: 0.,
                    y: 25.,
                    w: 1600.,
                    h: 875.
                },
                680.,
                570.
            ),
            Some((716., 25.))
        );
    }
    #[test]
    fn uses_left_on_negative_origin_display() {
        assert_eq!(
            adjacent(
                Rect {
                    x: -700.,
                    y: 100.,
                    w: 600.,
                    h: 700.
                },
                Rect {
                    x: -1600.,
                    y: 0.,
                    w: 1600.,
                    h: 900.
                },
                680.,
                570.
            ),
            Some((-1396., 100.))
        );
    }
    #[test]
    fn never_forces_overlapping_or_offscreen_layout() {
        assert_eq!(
            adjacent(
                Rect {
                    x: 340.,
                    y: 50.,
                    w: 600.,
                    h: 700.
                },
                Rect {
                    x: 0.,
                    y: 25.,
                    w: 1280.,
                    h: 775.
                },
                680.,
                570.
            ),
            None
        );
    }
}
