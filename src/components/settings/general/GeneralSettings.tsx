import { AccentColor } from "../AccentColor";
import React from "react";
import { useTranslation } from "react-i18next";
import { type } from "@tauri-apps/plugin-os";
import { MicrophoneSelector } from "../MicrophoneSelector";
import { ChannelSelector } from "../ChannelSelector";
import { ShortcutInput } from "../ShortcutInput";
import { SettingsGroup } from "../../ui/SettingsGroup";
import { OutputDeviceSelector } from "../OutputDeviceSelector";
import { ShortcutActivationSetting } from "../ShortcutActivation";
import { AudioFeedback } from "../AudioFeedback";
import { useSettings } from "../../../hooks/useSettings";
import { VolumeSlider } from "../VolumeSlider";
import { MuteWhileRecording } from "../MuteWhileRecording";
import { DictationPresets } from "./DictationPresets";
import { LiveTranscriptToggle } from "../LiveTranscriptToggle";
import { ModelSettingsCard } from "./ModelSettingsCard";
import FnShortcutHelp from "../FnShortcutHelp";

export const GeneralSettings: React.FC = () => {
  const { t } = useTranslation();
  const { audioFeedbackEnabled } = useSettings();
  const isLinux = type() === "linux";
  return (
    <div className="max-w-3xl w-full mx-auto space-y-6">
      <SettingsGroup title={t("settings.general.title")}>
        <ShortcutInput shortcutId="transcribe" grouped={true} />
        <FnShortcutHelp />
        <LiveTranscriptToggle />
        <AccentColor />
        <details className="settings-disclosure">
          <summary>{t("dictation.layout.recording")}</summary>
          <ShortcutActivationSetting descriptionMode="tooltip" grouped={true} />
          {/* Cancel shortcut remains hidden on Linux because of dynamic shortcut instability. */}
          {!isLinux && <ShortcutInput shortcutId="cancel" grouped={true} />}
        </details>
      </SettingsGroup>
      <DictationPresets />
      <details className="settings-surface settings-disclosure">
        <summary>{t("dictation.layout.model")}</summary>
        <ModelSettingsCard />
      </details>
      <SettingsGroup title={t("settings.sound.title")}>
        <MicrophoneSelector descriptionMode="tooltip" grouped={true} />
        <details className="settings-disclosure">
          <summary>{t("dictation.layout.audio")}</summary>
          <ChannelSelector descriptionMode="tooltip" grouped={true} />
          <MuteWhileRecording descriptionMode="tooltip" grouped={true} />
          <AudioFeedback descriptionMode="tooltip" grouped={true} />
          <OutputDeviceSelector
            descriptionMode="tooltip"
            grouped={true}
            disabled={!audioFeedbackEnabled}
          />
          <VolumeSlider disabled={!audioFeedbackEnabled} />
        </details>
      </SettingsGroup>
    </div>
  );
};
