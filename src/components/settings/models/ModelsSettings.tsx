import React, { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ask } from "@tauri-apps/plugin-dialog";
import {
  AudioLines,
  ChevronDown,
  Globe,
  Languages,
  RefreshCw,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import type { ModelCardStatus } from "@/components/onboarding";
import { ModelCard } from "@/components/onboarding";
import { Dropdown } from "@/components/ui/Dropdown";
import { useModelStore } from "@/stores/modelStore";
import {
  getLanguageLabel,
  MODEL_CAPABILITY_LANGUAGES,
  supportsLanguageCode,
} from "@/lib/constants/languages.ts";
import type { ModelInfo } from "@/bindings";

// check if model supports a language based on its supported_languages list
const modelSupportsLanguage = (model: ModelInfo, langCode: string): boolean => {
  return supportsLanguageCode(model.supported_languages, langCode);
};

// Legacy models are the blob (Url-sourced) .bin/ONNX downloads, superseded by
// the catalog GGUFs. They stay runnable when already on disk, but we no longer
// advertise the download.
const isLegacyModel = (model: ModelInfo): boolean =>
  typeof model.source === "object" && "Url" in model.source;

type ModelSort =
  | "recommended"
  | "popular"
  | "balanced"
  | "accuracy"
  | "speed"
  | "size";

// Unknown scores, sizes, and download counts are 0; all sort last. Array.sort
// is stable, so ties keep the backend's recommended order.
const sortKey: Record<
  Exclude<ModelSort, "recommended">,
  (m: ModelInfo) => number
> = {
  popular: (m) => m.downloads,
  // Geometric mean rewards models that are good at both, not great at one.
  balanced: (m) => Math.sqrt(m.accuracy_score * m.speed_score),
  accuracy: (m) => m.accuracy_score,
  speed: (m) => m.speed_score,
  size: (m) => (m.size_mb > 0 ? -m.size_mb : -Number.MAX_VALUE),
};

export const ModelsSettings: React.FC = () => {
  const { t } = useTranslation();
  const [switchingModelId, setSwitchingModelId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterStreaming, setFilterStreaming] = useState(false);
  const [filterTranslation, setFilterTranslation] = useState(false);
  const [languageFilter, setLanguageFilter] = useState("all");
  const [languageDropdownOpen, setLanguageDropdownOpen] = useState(false);
  const [languageSearch, setLanguageSearch] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sortBy, setSortBy] = useState<ModelSort>("recommended");
  const activeFilterCount =
    Number(filterStreaming) +
    Number(filterTranslation) +
    Number(languageFilter !== "all");
  const languageDropdownRef = useRef<HTMLDivElement>(null);
  const languageSearchInputRef = useRef<HTMLInputElement>(null);
  const {
    models,
    currentModel,
    downloadingModels,
    downloadProgress,
    downloadStats,
    verifyingModels,
    extractingModels,
    loading,
    isRescanning,
    downloadModel,
    cancelDownload,
    selectModel,
    deleteModel,
    rescanLocalModels,
  } = useModelStore();

  // click outside handler for language dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        languageDropdownRef.current &&
        !languageDropdownRef.current.contains(event.target as Node)
      ) {
        setLanguageDropdownOpen(false);
        setLanguageSearch("");
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // focus search input when dropdown opens
  useEffect(() => {
    if (languageDropdownOpen && languageSearchInputRef.current) {
      languageSearchInputRef.current.focus();
    }
  }, [languageDropdownOpen]);

  // filtered languages for dropdown (exclude "auto")
  const filteredLanguages = useMemo(() => {
    return MODEL_CAPABILITY_LANGUAGES.filter((lang) =>
      lang.label.toLowerCase().includes(languageSearch.toLowerCase()),
    );
  }, [languageSearch]);

  // Get selected language label
  const selectedLanguageLabel = useMemo(() => {
    if (languageFilter === "all") {
      return t("settings.models.filters.allLanguages");
    }
    return getLanguageLabel(languageFilter) || "";
  }, [languageFilter, t]);

  const getModelStatus = (modelId: string): ModelCardStatus => {
    if (modelId in extractingModels) {
      return "extracting";
    }
    if (modelId in verifyingModels) {
      return "verifying";
    }
    if (modelId in downloadingModels) {
      return "downloading";
    }
    if (switchingModelId === modelId) {
      return "switching";
    }
    const model = models.find((m: ModelInfo) => m.id === modelId);
    // A stale persisted selection must never make a missing model look Active.
    // Catalog models without files should offer their recovery action instead.
    if (!model?.is_downloaded) {
      return "downloadable";
    }
    if (modelId === currentModel) {
      return "active";
    }
    return "available";
  };

  const getDownloadProgress = (modelId: string): number | undefined => {
    const progress = downloadProgress[modelId];
    return progress?.percentage;
  };

  const getDownloadSpeed = (modelId: string): number | undefined => {
    const stats = downloadStats[modelId];
    return stats?.speed;
  };

  const handleModelSelect = async (modelId: string) => {
    setSwitchingModelId(modelId);
    try {
      await selectModel(modelId);
    } finally {
      setSwitchingModelId(null);
    }
  };

  const handleModelDownload = async (modelId: string) => {
    await downloadModel(modelId);
  };

  const handleModelDelete = async (modelId: string) => {
    const model = models.find((m: ModelInfo) => m.id === modelId);
    const modelName = model?.name || modelId;
    const isActive = modelId === currentModel;

    const confirmed = await ask(
      isActive
        ? t("settings.models.deleteActiveConfirm", { modelName })
        : t("settings.models.deleteConfirm", { modelName }),
      {
        title: t("settings.models.deleteTitle"),
        kind: "warning",
      },
    );

    if (confirmed) {
      try {
        await deleteModel(modelId);
      } catch (err) {
        console.error(`Failed to delete model ${modelId}:`, err);
      }
    }
  };

  const handleModelCancel = async (modelId: string) => {
    try {
      await cancelDownload(modelId);
    } catch (err) {
      console.error(`Failed to cancel download for ${modelId}:`, err);
    }
  };

  // Filter models by search query (name + description), language filter, and
  // toggles, then order by the selected sort.
  const filteredModels = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const matches = models.filter((model: ModelInfo) => {
      // Hide deprecated legacy (.bin/ONNX) downloads unless already on disk.
      if (isLegacyModel(model) && !model.is_downloaded) return false;
      if (languageFilter !== "all") {
        if (!modelSupportsLanguage(model, languageFilter)) return false;
      }
      if (filterStreaming && !model.supports_streaming) return false;
      if (filterTranslation && !model.supports_translation) return false;

      if (q) {
        const haystack = `${model.name} ${model.description}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
    if (sortBy === "recommended") return matches;
    const key = sortKey[sortBy];
    return matches.sort((a, b) => key(b) - key(a));
  }, [
    models,
    languageFilter,
    filterStreaming,
    filterTranslation,
    searchQuery,
    sortBy,
  ]);

  const sortOptions = (
    ["recommended", "popular", "balanced", "accuracy", "speed", "size"] as const
  ).map((value) => ({
    value,
    label: t(`settings.models.sort.${value}`),
    description: t(`settings.models.sort.${value}Description`),
  }));

  // Split filtered models into downloaded (including custom) and available sections
  const { downloadedModels, availableModels } = useMemo(() => {
    const downloaded: ModelInfo[] = [];
    const available: ModelInfo[] = [];

    for (const model of filteredModels) {
      if (
        model.is_custom ||
        model.is_downloaded ||
        model.id in downloadingModels ||
        model.id in extractingModels
      ) {
        downloaded.push(model);
      } else {
        available.push(model);
      }
    }

    return {
      downloadedModels: downloaded,
      availableModels: available,
    };
  }, [filteredModels, downloadingModels, extractingModels, currentModel]);

  if (loading) {
    return (
      <div className="max-w-3xl w-full mx-auto">
        <div className="flex items-center justify-center py-16">
          <div className="w-8 h-8 border-2 border-logo-primary border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl w-full mx-auto space-y-4">
      <h1 className="text-xl font-semibold">{t("settings.models.title")}</h1>

      {/* Search bar — filter the catalog by name or description */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text/40 pointer-events-none" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={t("settings.models.searchPlaceholder")}
          className="w-full pl-9 pr-3 py-2 text-sm bg-mid-gray/10 border border-mid-gray/40 rounded-lg focus:outline-none focus:ring-1 focus:ring-logo-primary placeholder:text-text/40"
        />
      </div>

      <div className="space-y-6">
        {/* Downloaded Models Section — header always visible so filter stays accessible */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-text/60">
              {t("settings.models.yourModels")}
            </h2>
            <div className="flex items-center gap-2">
              {/* Rescan local sources for models added outside Dictation */}
              <button
                type="button"
                onClick={() => rescanLocalModels()}
                disabled={isRescanning}
                title={t("settings.models.rescan.tooltip")}
                aria-label={t("settings.models.rescan.tooltip")}
                className="flex items-center justify-center w-8 h-8 text-sm font-medium rounded-lg bg-mid-gray/10 text-text/60 hover:bg-mid-gray/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <RefreshCw
                  className={`w-3.5 h-3.5 ${isRescanning ? "animate-spin" : ""}`}
                />
              </button>

              {/* Vertical divider separating action from filters */}
              <div className="h-4 w-px bg-mid-gray/30 mx-0.5" />
              <Dropdown
                options={sortOptions}
                selectedValue={sortBy}
                onSelect={(value) => setSortBy(value as ModelSort)}
                className="w-52"
                menuClassName="right-0 w-72 max-h-96!"
              />
              <button
                type="button"
                onClick={() => {
                  setFiltersOpen((open) => !open);
                  setLanguageDropdownOpen(false);
                  setLanguageSearch("");
                }}
                aria-expanded={filtersOpen}
                aria-controls="model-filters"
                aria-label={
                  activeFilterCount
                    ? t("settings.models.filters.activeCount", {
                        count: activeFilterCount,
                      })
                    : t("settings.models.filters.label")
                }
                className={`flex items-center justify-center gap-1.5 h-8 px-2 text-sm font-medium rounded-lg transition-colors ${
                  filtersOpen
                    ? "bg-logo-primary/20 text-logo-primary"
                    : "bg-mid-gray/10 text-text/60 hover:bg-mid-gray/20"
                }`}
              >
                <SlidersHorizontal className="w-3.5 h-3.5" />
                <span>{t("settings.models.filters.label")}</span>
                <span className="w-3 text-xs tabular-nums" aria-hidden="true">
                  {activeFilterCount || ""}
                </span>
              </button>
            </div>
          </div>
          {filtersOpen && (
            <div
              id="model-filters"
              role="group"
              aria-label={t("settings.models.filters.label")}
              className="flex flex-wrap items-center gap-2 rounded-lg border border-mid-gray/20 bg-mid-gray/5 p-3"
            >
              <button
                type="button"
                onClick={() => setFilterStreaming((enabled) => !enabled)}
                title={t("settings.models.filters.streaming")}
                aria-label={t("settings.models.filters.streaming")}
                aria-pressed={filterStreaming}
                className={`flex items-center justify-center gap-1.5 h-8 px-3 text-sm font-medium rounded-lg transition-colors ${
                  filterStreaming
                    ? "bg-logo-primary/20 text-logo-primary hover:bg-logo-primary/30"
                    : "bg-mid-gray/10 text-text/60 hover:bg-mid-gray/20"
                }`}
              >
                <AudioLines className="w-3.5 h-3.5" />
                <span>{t("settings.models.filters.streamingLabel")}</span>
              </button>
              <button
                type="button"
                onClick={() => setFilterTranslation((enabled) => !enabled)}
                title={t("settings.models.filters.translation")}
                aria-label={t("settings.models.filters.translation")}
                aria-pressed={filterTranslation}
                className={`flex items-center justify-center gap-1.5 h-8 px-3 text-sm font-medium rounded-lg transition-colors ${
                  filterTranslation
                    ? "bg-logo-primary/20 text-logo-primary hover:bg-logo-primary/30"
                    : "bg-mid-gray/10 text-text/60 hover:bg-mid-gray/20"
                }`}
              >
                <Languages className="w-3.5 h-3.5" />
                <span>{t("settings.models.filters.translationLabel")}</span>
              </button>
              {/* Language filter dropdown */}
              <div className="relative" ref={languageDropdownRef}>
                <button
                  type="button"
                  onClick={() => setLanguageDropdownOpen(!languageDropdownOpen)}
                  aria-expanded={languageDropdownOpen}
                  aria-label={t("settings.models.filters.languageLabel", {
                    language: selectedLanguageLabel,
                  })}
                  className={`flex items-center gap-1.5 h-8 px-3 text-sm font-medium rounded-lg transition-colors ${
                    languageFilter !== "all"
                      ? "bg-logo-primary/20 text-logo-primary"
                      : "bg-mid-gray/10 text-text/60 hover:bg-mid-gray/20"
                  }`}
                >
                  <Globe className="w-3.5 h-3.5" />
                  <span className="max-w-[120px] truncate">
                    {selectedLanguageLabel}
                  </span>
                  <ChevronDown
                    className={`w-3.5 h-3.5 transition-transform ${
                      languageDropdownOpen ? "rotate-180" : ""
                    }`}
                  />
                </button>

                {languageDropdownOpen && (
                  <div className="absolute top-full left-0 mt-1 w-56 max-w-[calc(100vw-4rem)] bg-background border border-mid-gray/80 rounded-lg shadow-lg z-50 overflow-hidden">
                    <div className="p-2 border-b border-mid-gray/40">
                      <input
                        ref={languageSearchInputRef}
                        type="text"
                        value={languageSearch}
                        onChange={(e) => setLanguageSearch(e.target.value)}
                        onKeyDown={(e) => {
                          if (
                            e.key === "Enter" &&
                            filteredLanguages.length > 0
                          ) {
                            setLanguageFilter(filteredLanguages[0].value);
                            setLanguageDropdownOpen(false);
                            setLanguageSearch("");
                          } else if (e.key === "Escape") {
                            setLanguageDropdownOpen(false);
                            setLanguageSearch("");
                          }
                        }}
                        placeholder={t(
                          "settings.general.language.searchPlaceholder",
                        )}
                        className="w-full px-2 py-1 text-sm bg-mid-gray/10 border border-mid-gray/40 rounded-md focus:outline-none focus:ring-1 focus:ring-logo-primary"
                      />
                    </div>
                    <div className="max-h-48 overflow-y-auto">
                      <button
                        type="button"
                        onClick={() => {
                          setLanguageFilter("all");
                          setLanguageDropdownOpen(false);
                          setLanguageSearch("");
                        }}
                        className={`w-full px-3 py-1.5 text-sm text-left transition-colors ${
                          languageFilter === "all"
                            ? "bg-logo-primary/20 text-logo-primary font-semibold"
                            : "hover:bg-mid-gray/10"
                        }`}
                      >
                        {t("settings.models.filters.allLanguages")}
                      </button>
                      {filteredLanguages.map((lang) => (
                        <button
                          key={lang.value}
                          type="button"
                          onClick={() => {
                            setLanguageFilter(lang.value);
                            setLanguageDropdownOpen(false);
                            setLanguageSearch("");
                          }}
                          className={`w-full px-3 py-1.5 text-sm text-left transition-colors ${
                            languageFilter === lang.value
                              ? "bg-logo-primary/20 text-logo-primary font-semibold"
                              : "hover:bg-mid-gray/10"
                          }`}
                        >
                          {lang.label}
                        </button>
                      ))}
                      {filteredLanguages.length === 0 && (
                        <div className="px-3 py-2 text-sm text-text/50 text-center">
                          {t("settings.general.language.noResults")}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
              {activeFilterCount > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setFilterStreaming(false);
                    setFilterTranslation(false);
                    setLanguageFilter("all");
                    setLanguageDropdownOpen(false);
                    setLanguageSearch("");
                  }}
                  className="h-8 px-2 text-sm text-text/70 hover:text-text rounded-lg hover:bg-mid-gray/10"
                >
                  {t("settings.models.filters.clear")}
                </button>
              )}
            </div>
          )}
          {downloadedModels.map((model: ModelInfo) => (
            <ModelCard
              key={model.id}
              model={model}
              status={getModelStatus(model.id)}
              onSelect={handleModelSelect}
              onDownload={handleModelDownload}
              onDelete={handleModelDelete}
              onCancel={handleModelCancel}
              downloadProgress={getDownloadProgress(model.id)}
              downloadSpeed={getDownloadSpeed(model.id)}
              showRecommended={false}
            />
          ))}
        </div>

        {/* Available Models Section */}
        {availableModels.length > 0 && (
          <div className="space-y-3">
            <h2 className="text-sm font-medium text-text/60">
              {t("settings.models.availableModels")}
            </h2>
            {availableModels.map((model: ModelInfo) => (
              <ModelCard
                key={model.id}
                model={model}
                status={getModelStatus(model.id)}
                onSelect={handleModelSelect}
                onDownload={handleModelDownload}
                onDelete={handleModelDelete}
                onCancel={handleModelCancel}
                downloadProgress={getDownloadProgress(model.id)}
                downloadSpeed={getDownloadSpeed(model.id)}
                showRecommended={true}
              />
            ))}
          </div>
        )}
        {filteredModels.length === 0 && (
          <div className="text-center py-8 text-text/50">
            {t("settings.models.noModelsMatch")}
          </div>
        )}
      </div>
    </div>
  );
};
