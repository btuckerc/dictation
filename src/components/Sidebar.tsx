import VoiceMark from "./icons/VoiceMark";
import React from "react";
import { useTranslation } from "react-i18next";
import { Cog, FlaskConical, History, Info, Sparkles, Cpu } from "lucide-react";
import { useSettings } from "../hooks/useSettings";
import {
  GeneralSettings,
  AdvancedSettings,
  HistorySettings,
  DebugSettings,
  AboutSettings,
  PostProcessingSettings,
  ModelsSettings,
} from "./settings";

export type SidebarSection = keyof typeof SECTIONS_CONFIG;

interface IconProps {
  width?: number | string;
  height?: number | string;
  size?: number | string;
  className?: string;
  [key: string]: any;
}

interface SectionConfig {
  labelKey: string;
  icon: React.ComponentType<IconProps>;
  component: React.ComponentType;
  enabled: (settings: any) => boolean;
}

export const SECTIONS_CONFIG = {
  general: {
    labelKey: "sidebar.general",
    icon: VoiceMark,
    component: GeneralSettings,
    enabled: () => true,
  },
  history: {
    labelKey: "sidebar.history",
    icon: History,
    component: HistorySettings,
    enabled: () => true,
  },
  models: {
    labelKey: "sidebar.models",
    icon: Cpu,
    component: ModelsSettings,
    enabled: () => true,
  },
  advanced: {
    labelKey: "sidebar.advanced",
    icon: Cog,
    component: AdvancedSettings,
    enabled: () => true,
  },
  postprocessing: {
    labelKey: "sidebar.postProcessing",
    icon: Sparkles,
    component: PostProcessingSettings,
    enabled: () => true,
  },
  debug: {
    labelKey: "sidebar.debug",
    icon: FlaskConical,
    component: DebugSettings,
    enabled: (settings) => settings?.debug_mode ?? false,
  },
  about: {
    labelKey: "sidebar.about",
    icon: Info,
    component: AboutSettings,
    enabled: () => true,
  },
} as const satisfies Record<string, SectionConfig>;

interface SidebarProps {
  activeSection: SidebarSection;
  onSectionChange: (section: SidebarSection) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeSection,
  onSectionChange,
}) => {
  const { t } = useTranslation();
  const { settings } = useSettings();

  const primary: SidebarSection[] = ["general", "history", "models"];
  const secondary: SidebarSection[] = [
    "advanced",
    "postprocessing",
    "about",
    "debug",
  ];
  const item = (id: SidebarSection) => {
    const section = SECTIONS_CONFIG[id];
    if (!section.enabled(settings)) return null;
    const Icon = section.icon;
    return (
      <button
        type="button"
        key={id}
        aria-current={activeSection === id ? "page" : undefined}
        className={`flex gap-2 items-center px-3 py-2 w-full rounded-xl text-start transition-colors ${activeSection === id ? "bg-logo-primary/12 text-logo-primary" : "hover:bg-mid-gray/10"}`}
        onClick={() => onSectionChange(id)}
      >
        <Icon width={20} height={20} className="shrink-0" />
        <span className="text-sm font-medium truncate">
          {t(section.labelKey)}
        </span>
      </button>
    );
  };
  return (
    <nav
      aria-label={t("dictation.layout.navigation")}
      className="glass-nav flex flex-col w-40 shrink-0 h-full items-center px-2 py-3 rounded-r-2xl"
    >
      <div className="flex flex-col w-full gap-1">{primary.map(item)}</div>
      <details className="settings-disclosure w-full mt-3">
        <summary className="text-mid-gray">
          {t("dictation.layout.more")}
        </summary>
        <div className="flex flex-col gap-1">{secondary.map(item)}</div>
      </details>
    </nav>
  );
};
