import { useState } from "react";
import { useTranslation } from "react-i18next";
import { DictationPresets } from "../settings/general/DictationPresets";
import { useModelStore } from "@/stores/modelStore";
import { Button } from "../ui/Button";
import { SetupFrame } from "./SetupFrame";

export default function Onboarding({
  onModelSelected,
  onBack,
  preview = false,
}: {
  onModelSelected: () => void;
  onBack?: () => void;
  preview?: boolean;
}) {
  const { t } = useTranslation();
  const { currentModel, models } = useModelStore();
  const [busy, setBusy] = useState(false);
  const ready = models.some(
    (model) => model.id === currentModel && model.is_downloaded,
  );
  return (
    <SetupFrame
      step={1}
      title={t("dictation.setup.modelTitle")}
      description={t("dictation.setup.modelDescription")}
    >
      <DictationPresets
        onSelected={() => {}}
        onBusyChange={setBusy}
        disabled={preview}
      />
      <p className="text-xs text-mid-gray">{t("dictation.setup.modelHint")}</p>
      <div className="flex justify-between gap-4">
        <Button
          variant="secondary"
          onClick={onBack}
          disabled={preview || busy || !onBack}
        >
          {t("dictation.setup.back")}
        </Button>
        <Button onClick={onModelSelected} disabled={preview || busy || !ready}>
          {t("dictation.setup.continue")}
        </Button>
      </div>
    </SetupFrame>
  );
}
