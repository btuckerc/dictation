import { type } from "@tauri-apps/plugin-os";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useTranslation } from "react-i18next";
import { Button } from "../ui/Button";
import { useSettings } from "../../hooks/useSettings";
import { HelpTooltip } from "../ui/HelpTooltip";
import { toast } from "sonner";

const KEYBOARD_SETTINGS_URL =
  "x-apple.systempreferences:com.apple.Keyboard-Settings.extension";
const LEGACY_KEYBOARD_SETTINGS_URL =
  "x-apple.systempreferences:com.apple.preference.keyboard";

/** HandyKeys accepts fn/function; Globe is a display name, not a native binding alias. */
export function isFnShortcut(binding: string | undefined): boolean {
  const normalized = (binding || "").trim().toLowerCase();
  return normalized === "fn" || normalized === "function";
}

export function FnShortcutHelp() {
  const { t } = useTranslation();
  const { getSetting } = useSettings();
  const bindings = getSetting("bindings");
  const binding = bindings?.transcribe?.current_binding;
  const postProcessBinding =
    bindings?.transcribe_with_post_process?.current_binding;

  if (
    type() !== "macos" ||
    (!isFnShortcut(binding) && !isFnShortcut(postProcessBinding))
  )
    return null;

  const openKeyboardSettings = async () => {
    try {
      await openUrl(KEYBOARD_SETTINGS_URL);
    } catch {
      try {
        await openUrl(LEGACY_KEYBOARD_SETTINGS_URL);
      } catch {
        toast.error(t("settings.general.fnShortcut.openSettingsError"));
      }
    }
  };

  return (
    <div className="flex min-h-12 flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span className="text-xs text-mid-gray">
          {t("settings.general.fnShortcut.title")}
        </span>
        <HelpTooltip
          text={t("settings.general.fnShortcut.help")}
          label={t("settings.general.fnShortcut.helpLabel")}
        />
      </div>
      <div className="shrink-0">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="whitespace-nowrap"
          onClick={openKeyboardSettings}
        >
          {t("settings.general.fnShortcut.openSettings")}
        </Button>
      </div>
    </div>
  );
}

export default FnShortcutHelp;
