import { useState } from "react";
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
  const [expanded, setExpanded] = useState(false);
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
    <div className="px-4 py-2 text-sm">
      <div className="flex items-center justify-between gap-3 min-h-8">
        <div className="flex items-center gap-2 font-medium">
          <span>{t("settings.general.fnShortcut.title")}</span>
          <HelpTooltip
            text={t("settings.general.fnShortcut.help")}
            label={t("settings.general.fnShortcut.helpLabel")}
          />
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
        >
          {t("settings.general.fnShortcut.setup")}
        </Button>
      </div>
      {expanded && (
        <div className="mt-2 space-y-2 text-sm text-mid-gray">
          <p>{t("settings.general.fnShortcut.description")}</p>
          <p>{t("settings.general.fnShortcut.dictationNote")}</p>
          <p>{t("settings.general.fnShortcut.emojiNote")}</p>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={openKeyboardSettings}
          >
            {t("settings.general.fnShortcut.openSettings")}
          </Button>
        </div>
      )}
    </div>
  );
}

export default FnShortcutHelp;
