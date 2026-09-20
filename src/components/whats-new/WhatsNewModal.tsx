import React from "react";
import { useTranslation } from "react-i18next";
import { Dialog } from "../ui";
import { MarkdownContent } from "./MarkdownContent";
import type { ReleaseNote } from "./releaseNotes";
import { openUrl } from "@tauri-apps/plugin-opener";

interface WhatsNewModalProps {
  note: ReleaseNote;
  open: boolean;
  onDismiss: () => void;
}

export const WhatsNewModal: React.FC<WhatsNewModalProps> = ({
  note,
  open,
  onDismiss,
}) => {
  const { t } = useTranslation();

  const openReleases = async () => {
    try {
      await openUrl("https://github.com/btuckerc/dictation/releases");
    } catch (error) {
      console.error("Failed to open releases link:", error);
    }
  };

  return (
    <Dialog
      open={open}
      title={t("branding.whatsNewTitle", {
        version: note.version,
        defaultValue: "New in Dictation v{{version}}",
      })}
      closeLabel={t("common.close")}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onDismiss();
      }}
    >
      <MarkdownContent markdown={note.markdown} />
      <button
        type="button"
        className="mt-4 text-sm text-text/70 underline decoration-mid-gray/50 underline-offset-2 hover:text-text"
        onClick={() => void openReleases()}
      >
        {t("branding.releaseNotesLink", {
          defaultValue: "View Dictation releases",
        })}
      </button>
    </Dialog>
  );
};
