import { useState } from "react";
import { useSettings } from "@/hooks/useSettings";
import { useTranslation } from "react-i18next";
import { SetupFrame } from "./SetupFrame";
import { ShortcutInput } from "../settings/ShortcutInput";
import { ShortcutActivationSetting } from "../settings/ShortcutActivation";
import { MicrophoneSelector } from "../settings/MicrophoneSelector";
import SecureInputWarning from "../SecureInputWarning";
import { Button } from "../ui/Button";

export default function ShortcutOnboarding({
  onComplete,
  onBack,
}: {
  onComplete: () => void;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const { getSetting } = useSettings();
  const mode = getSetting("shortcut_activation") || "hold_or_toggle";
  const [text, setText] = useState("");
  return (
    <SetupFrame
      step={2}
      title={t("dictation.setup.shortcutTitle")}
      description={t("dictation.setup.shortcutDescription")}
    >
      <SecureInputWarning />
      <div className="settings-surface overflow-hidden">
        <ShortcutInput
          shortcutId="transcribe"
          descriptionMode="inline"
          grouped
        />
      </div>
      <div className="space-y-2">
        <label
          htmlFor="dictation-practice"
          className="block text-sm font-medium"
        >
          {t("dictation.setup.practiceTitle")}
        </label>
        <p id="practice-hint" className="text-sm text-mid-gray">
          {t(`dictation.setup.practiceModes.${mode}`)}
        </p>
        <textarea
          id="dictation-practice"
          aria-describedby="practice-hint"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={t("dictation.setup.practicePlaceholder")}
          rows={3}
          className="w-full resize-y rounded-xl border border-mid-gray/30 bg-mid-gray/5 p-4 text-sm select-text focus:outline-none focus:ring-2 focus:ring-logo-primary"
        />
        <p className="text-xs text-mid-gray">
          {t("dictation.setup.practicePrivacy")}
        </p>
      </div>
      <details className="settings-surface settings-disclosure text-sm">
        <summary className="cursor-pointer font-medium">
          {t("dictation.setup.troubleshoot")}
        </summary>
        <p className="mt-3 text-mid-gray">
          {t("dictation.setup.shortcutRecovery")}
        </p>
        <ShortcutActivationSetting descriptionMode="inline" grouped />
        <MicrophoneSelector descriptionMode="inline" />
      </details>
      <div className="flex justify-between">
        <Button variant="secondary" onClick={onBack}>
          {t("dictation.setup.back")}
        </Button>
        <Button onClick={onComplete}>{t("dictation.setup.finish")}</Button>
      </div>
    </SetupFrame>
  );
}
