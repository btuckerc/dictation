import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { useSettings } from "@/hooks/useSettings";
import { useSettingsStore } from "@/stores/settingsStore";
import { applyAccent, DEFAULT_ACCENT, validAccent } from "@/lib/utils/accent";
import { SettingContainer } from "../ui/SettingContainer";

const COLORS = [
  { value: "#ffffff", name: "white" },
  { value: DEFAULT_ACCENT, name: "blue" },
  { value: "#f5d90a", name: "yellow" },
  { value: "#ff4fa3", name: "pink" },
];
export function AccentColor() {
  const { t } = useTranslation();
  const { getSetting } = useSettings();
  const storedColor = getSetting("accent_color");
  const color = validAccent(storedColor) ? storedColor : DEFAULT_ACCENT;
  const [error, setError] = useState<string | null>(null);
  // Serialize picker changes so an older write cannot replace the latest color.
  const pending = useRef(Promise.resolve());
  const change = (value: string) => {
    pending.current = pending.current.then(async () => {
      try {
        await invoke("change_dictation_accent", { color: value });
        useSettingsStore.setState((state) => ({
          settings: state.settings
            ? { ...state.settings, accent_color: value }
            : null,
        }));
        applyAccent(value);
        setError(null);
      } catch (e) {
        setError(String(e));
      }
    });
  };
  return (
    <>
      <SettingContainer
        title={t("dictation.accent.title")}
        description={t("dictation.accent.description")}
        grouped
      >
        <div className="flex items-center gap-2">
          {COLORS.map(({ value, name }) => (
            <button
              key={value}
              type="button"
              aria-label={t(`dictation.accent.colors.${name}`)}
              aria-pressed={color.toLowerCase() === value}
              className={`w-5 h-5 rounded-full border border-text/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current ${color.toLowerCase() === value ? "outline outline-2 outline-offset-2 outline-current" : ""}`}
              style={{ backgroundColor: value }}
              onClick={() => change(value)}
            />
          ))}
          <input
            type="color"
            aria-label={t("dictation.accent.custom")}
            title={t("dictation.accent.custom")}
            value={color}
            className="w-6 h-6 p-0 border-0 bg-transparent cursor-pointer"
            onChange={(event) => change(event.target.value)}
          />
        </div>
      </SettingContainer>
      {error && (
        <p role="alert" className="px-4 py-2 text-sm text-error">
          {error}
        </p>
      )}
    </>
  );
}
