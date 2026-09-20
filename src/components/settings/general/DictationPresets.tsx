import { HelpTooltip } from "../../ui/HelpTooltip";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { useModelStore } from "@/stores/modelStore";
import { useSettings } from "@/hooks/useSettings";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { SettingsGroup } from "@/components/ui/SettingsGroup";
import { ShortcutInput } from "@/components/settings/ShortcutInput";

interface DictationPreset {
  id: string;
  model_id: string;
}

interface DictationPresetsProps {
  onSelected?: () => void;
  disabled?: boolean;
  onBusyChange?: (busy: boolean) => void;
}

const DEFAULT_CLEANUP_URL = "http://nous:8080/v1";
const DEFAULT_CLEANUP_MODEL = "Ornith-1.5-9B-Q5_K_M";

export const DictationPresets: React.FC<DictationPresetsProps> = ({
  onSelected,
  disabled = false,
  onBusyChange,
}) => {
  const { t } = useTranslation();
  const {
    models,
    currentModel,
    downloadingModels,
    downloadProgress,
    loadModels,
    selectModel,
    downloadModel,
    cancelDownload,
  } = useModelStore();
  const { settings, getSetting, updateSetting, refreshSettings } =
    useSettings();

  const [presets, setPresets] = useState<DictationPreset[]>([]);
  const [activeModelId, setActiveModelId] = useState<string | null>(null);
  useEffect(() => {
    onBusyChange?.(activeModelId !== null);
  }, [activeModelId, onBusyChange]);
  const [presetsError, setPresetsError] = useState<string | null>(null);
  const [cleanupError, setCleanupError] = useState<string | null>(null);
  const [cleanupBusy, setCleanupBusy] = useState(false);
  const [cleanupUrl, setCleanupUrl] = useState(DEFAULT_CLEANUP_URL);
  const [cleanupModel, setCleanupModel] = useState(DEFAULT_CLEANUP_MODEL);
  const initializedCleanup = useRef(false);
  const operation = useRef(0);
  const busy = useRef(false);
  useEffect(
    () => () => {
      operation.current += 1;
      busy.current = false;
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      invoke<DictationPreset[]>("get_dictation_presets"),
      loadModels(),
    ])
      .then(([loadedPresets]) => {
        if (!cancelled) setPresets(loadedPresets);
      })
      .catch((error: unknown) => {
        if (!cancelled) setPresetsError(String(error));
      });
    return () => {
      cancelled = true;
    };
  }, [loadModels]);

  useEffect(() => {
    if (!settings || initializedCleanup.current) return;
    const customProvider = settings.post_process_providers?.find(
      (provider) => provider.id === "custom",
    );
    setCleanupUrl(
      settings.post_process_models?.custom ||
        (customProvider?.base_url &&
          customProvider.base_url !== "http://localhost:11434/v1")
        ? customProvider?.base_url || DEFAULT_CLEANUP_URL
        : DEFAULT_CLEANUP_URL,
    );
    setCleanupModel(
      settings.post_process_models?.custom || DEFAULT_CLEANUP_MODEL,
    );
    initializedCleanup.current = true;
  }, [settings]);

  const presetById = useMemo(
    () => new Map(presets.map((preset) => [preset.id, preset])),
    [presets],
  );

  const presetDetails = [
    {
      id: "fast",
      name: t("dictation.presets.fast.name"),
      description: t("dictation.presets.fast.description"),
    },
    {
      id: "accurate",
      name: t("dictation.presets.accurate.name"),
      description: t("dictation.presets.accurate.description"),
    },
  ];

  const handlePresetAction = async (presetId: string) => {
    const preset = presetById.get(presetId);
    if (
      !preset ||
      disabled ||
      busy.current ||
      downloadingModels[preset.model_id]
    )
      return;
    busy.current = true;
    const token = ++operation.current;
    setActiveModelId(preset.model_id);
    setPresetsError(null);
    try {
      const model = models.find(
        (candidate) => candidate.id === preset.model_id,
      );
      if (!model?.is_downloaded && !downloadingModels[preset.model_id]) {
        const downloaded = await downloadModel(preset.model_id);
        if (token !== operation.current) return;
        if (!downloaded) {
          setPresetsError(t("dictation.presets.errors.download"));
          return;
        }
        await loadModels();
      }
      if (token !== operation.current) return;
      if (currentModel !== preset.model_id) {
        const selected = await selectModel(preset.model_id);
        if (token !== operation.current) return;
        if (!selected) {
          setPresetsError(t("dictation.presets.errors.select"));
        } else {
          onSelected?.();
        }
      } else {
        onSelected?.();
      }
    } catch (error: unknown) {
      if (token === operation.current) setPresetsError(String(error));
    } finally {
      if (token === operation.current) {
        busy.current = false;
        setActiveModelId(null);
      }
    }
  };

  const handleCancel = async (modelId: string) => {
    operation.current += 1; // A late download completion must not select a cancelled preset.
    const cancelled = await cancelDownload(modelId);
    busy.current = false;
    setActiveModelId(null);
    if (!cancelled) setPresetsError(t("dictation.presets.errors.cancel"));
  };

  const handleCleanupConnect = async () => {
    const baseUrl = cleanupUrl.trim();
    const model = cleanupModel.trim();
    if (!baseUrl || !model) return;
    setCleanupBusy(true);
    setCleanupError(null);
    try {
      const url = new URL(baseUrl);
      if (!["http:", "https:"].includes(url.protocol))
        throw new Error(t("dictation.cleanup.invalidUrl"));
      // Invoke directly so a rejected write reaches this form; store helpers
      // intentionally swallow errors. Refresh the store after all writes.
      await invoke("change_post_process_base_url_setting", {
        providerId: "custom",
        baseUrl,
      });
      await invoke("change_post_process_model_setting", {
        providerId: "custom",
        model,
      });
      await invoke("set_post_process_provider", { providerId: "custom" });
      await invoke("change_post_process_enabled_setting", { enabled: true });
      await invoke("change_experimental_enabled_setting", { enabled: true });
      await refreshSettings();
    } catch (error: unknown) {
      setCleanupError(String(error));
    } finally {
      setCleanupBusy(false);
    }
  };

  const cleanupEnabled = getSetting("post_process_enabled") ?? false;

  return (
    <div className="space-y-6">
      <SettingsGroup
        title={t("dictation.presets.title")}
        description={t("dictation.presets.description")}
      >
        <div className="grid gap-3 p-4 sm:grid-cols-2">
          {presetDetails.map((preset) => {
            const modelId = presetById.get(preset.id)?.model_id;
            const model = modelId
              ? models.find((candidate) => candidate.id === modelId)
              : undefined;
            const isActive = modelId === currentModel;
            const isBusy = modelId === activeModelId;
            const progress = modelId
              ? downloadProgress[modelId]?.percentage
              : undefined;
            const isDownloading = modelId
              ? Boolean(downloadingModels[modelId])
              : false;

            return (
              <div
                key={preset.id}
                data-preset={preset.id}
                className={`rounded-lg border p-4 text-start transition-colors ${
                  isActive
                    ? "border-logo-primary"
                    : "border-mid-gray/20 bg-mid-gray/5 hover:border-logo-primary/50"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-medium text-text">{preset.name}</h3>
                      <HelpTooltip text={preset.description} />
                    </div>
                  </div>
                  {isActive && (
                    <span className="text-xs text-logo-primary">
                      {t("dictation.presets.active")}
                    </span>
                  )}
                </div>
                <div className="mt-4 flex items-center justify-between gap-2">
                  {isDownloading && progress !== undefined ? (
                    <span className="text-xs text-mid-gray">
                      {t("dictation.presets.downloading", {
                        progress: Math.round(progress),
                      })}
                    </span>
                  ) : (
                    <span className="text-xs text-mid-gray">
                      {model?.is_downloaded
                        ? t("dictation.presets.ready")
                        : t("dictation.presets.downloadSize", {
                            size: model ? Math.ceil(model.size_mb) : "—",
                          })}
                    </span>
                  )}
                  {isDownloading && modelId && (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={disabled}
                      onClick={() => void handleCancel(modelId)}
                    >
                      {t("dictation.presets.cancel")}
                    </Button>
                  )}
                  <Button
                    type="button"
                    size="sm"
                    variant={isActive ? "secondary" : "primary"}
                    disabled={
                      disabled ||
                      activeModelId !== null ||
                      isDownloading ||
                      !modelId ||
                      presets.length === 0
                    }
                    onClick={(event) => {
                      event.stopPropagation();
                      void handlePresetAction(preset.id);
                    }}
                  >
                    {isBusy
                      ? t("dictation.presets.working")
                      : isActive
                        ? t("dictation.presets.selected")
                        : model?.is_downloaded
                          ? t("dictation.presets.select")
                          : t("dictation.presets.downloadAndSelect")}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
        {presetsError && (
          <p role="alert" className="px-4 pb-4 text-sm text-red-400">
            {presetsError}
          </p>
        )}
      </SettingsGroup>

      {!onSelected && (
        <details className="settings-surface settings-disclosure">
          <summary>{t("dictation.layout.cleanup")}</summary>
          <SettingsGroup
            title={t("dictation.cleanup.title")}
            description={t("dictation.cleanup.description")}
          >
            <div className="space-y-3 p-4">
              <div className="flex items-center gap-2 text-sm text-mid-gray">
                <span>{t("dictation.cleanup.title")}</span>
                <HelpTooltip text={t("dictation.cleanup.notice")} />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Input
                  type="url"
                  value={cleanupUrl}
                  onChange={(event) => setCleanupUrl(event.target.value)}
                  placeholder={t("dictation.cleanup.urlPlaceholder")}
                  aria-label={t("dictation.cleanup.urlLabel")}
                  disabled={cleanupBusy}
                />
                <Input
                  type="text"
                  value={cleanupModel}
                  onChange={(event) => setCleanupModel(event.target.value)}
                  placeholder={t("dictation.cleanup.modelPlaceholder")}
                  aria-label={t("dictation.cleanup.modelLabel")}
                  disabled={cleanupBusy}
                />
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-mid-gray">
                  {cleanupEnabled
                    ? t("dictation.cleanup.connected")
                    : t("dictation.cleanup.notConnected")}
                </span>
                {cleanupEnabled && (
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() =>
                      void updateSetting("post_process_enabled", false)
                    }
                  >
                    {t("dictation.cleanup.disable")}
                  </Button>
                )}
                <Button
                  type="button"
                  size="sm"
                  onClick={() => void handleCleanupConnect()}
                  disabled={
                    cleanupBusy || !cleanupUrl.trim() || !cleanupModel.trim()
                  }
                >
                  {cleanupBusy
                    ? t("dictation.cleanup.connecting")
                    : t("dictation.cleanup.connect")}
                </Button>
              </div>
              {cleanupError && (
                <p className="text-sm text-red-400">{cleanupError}</p>
              )}
            </div>
            {cleanupEnabled && (
              <ShortcutInput
                shortcutId="transcribe_with_post_process"
                grouped
              />
            )}
          </SettingsGroup>
        </details>
      )}
    </div>
  );
};
