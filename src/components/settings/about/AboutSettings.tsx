import { APP_VERSION } from "@/lib/version";
import React, { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { SettingsGroup } from "../../ui/SettingsGroup";
import { SettingContainer } from "../../ui/SettingContainer";
import { Button } from "../../ui/Button";
import { AppDataDirectory } from "../AppDataDirectory";
import { AppLanguageSelector } from "../AppLanguageSelector";
import { ShowWhatsNewOnUpdate } from "../ShowWhatsNewOnUpdate";
import { ThemeSelector } from "../ThemeSelector";
import { LogDirectory } from "../debug";
import upstreamLicense from "../../../../LICENSE?raw";

const DICTATION_REPOSITORY = "https://github.com/btuckerc/dictation";
const DICTATION_ISSUES = `${DICTATION_REPOSITORY}/issues`;
const HANDY_REPOSITORY = "https://github.com/cjpais/Handy";

export const AboutSettings: React.FC = () => {
  const { t } = useTranslation();
  const [version, setVersion] = useState(APP_VERSION);

  useEffect(() => {
    const fetchVersion = async () => {
      try {
        const appVersion = await getVersion();
        setVersion(appVersion);
      } catch (error) {
        console.error("Failed to get app version:", error);
        setVersion(APP_VERSION);
      }
    };

    fetchVersion();
  }, []);

  const openExternal = async (url: string) => {
    try {
      await openUrl(url);
    } catch (error) {
      console.error("Failed to open external link:", error);
    }
  };

  return (
    <div className="max-w-3xl w-full mx-auto space-y-6">
      <SettingsGroup
        title={t("branding.aboutTitle", { defaultValue: "About Dictation" })}
      >
        <AppLanguageSelector descriptionMode="tooltip" grouped={true} />
        <ThemeSelector descriptionMode="tooltip" grouped={true} />
        <SettingContainer
          title={t("branding.versionTitle", { defaultValue: "Version" })}
          description={t("branding.versionDescription", {
            defaultValue: "Current version of Dictation",
          })}
          grouped={true}
        >
          {/* eslint-disable-next-line i18next/no-literal-string */}
          <span className="text-sm font-mono">v{version}</span>
        </SettingContainer>

        <ShowWhatsNewOnUpdate descriptionMode="tooltip" grouped={true} />

        <SettingContainer
          title={t("branding.sourceTitle", {
            defaultValue: "Source and feedback",
          })}
          description={t("branding.sourceDescription", {
            defaultValue:
              "View Dictation's source code, releases, and issue tracker",
          })}
          grouped={true}
        >
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              size="md"
              onClick={() => openExternal(DICTATION_REPOSITORY)}
            >
              {t("branding.sourceButton", { defaultValue: "View source" })}
            </Button>
            <Button
              variant="secondary"
              size="md"
              onClick={() => openExternal(DICTATION_ISSUES)}
            >
              {t("branding.feedbackButton", { defaultValue: "Give feedback" })}
            </Button>
          </div>
        </SettingContainer>

        <SettingContainer
          title={t("branding.creatorTitle", {
            defaultValue: "Created by btuckerc",
          })}
          description={t("branding.creatorDescription", {
            defaultValue:
              "Dictation is an independent fork maintained at btuckerc/dictation.",
          })}
          grouped={true}
        >
          <Button
            variant="secondary"
            size="md"
            onClick={() => openExternal(DICTATION_REPOSITORY)}
          >
            {t("branding.creatorButton", { defaultValue: "Visit project" })}
          </Button>
        </SettingContainer>

        <AppDataDirectory descriptionMode="tooltip" grouped={true} />
        <LogDirectory grouped={true} />
      </SettingsGroup>

      <SettingsGroup
        title={t("branding.acknowledgmentsTitle", {
          defaultValue: "Acknowledgments and licenses",
        })}
      >
        <SettingContainer
          title={t("branding.upstreamCreditTitle", {
            defaultValue: "Built on open source",
          })}
          description={t("branding.upstreamCreditDescription", {
            defaultValue:
              "Dictation is an independent fork of Handy by CJ Pais and contributors.",
          })}
          grouped={true}
          layout="stacked"
        >
          <div className="flex flex-wrap items-center gap-2 text-sm text-mid-gray">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => openExternal(HANDY_REPOSITORY)}
            >
              {t("branding.upstreamSourceButton", {
                defaultValue: "Upstream source",
              })}
            </Button>
            <a
              className="underline decoration-mid-gray/50 underline-offset-2 hover:text-text"
              href={`${HANDY_REPOSITORY}/blob/main/LICENSE`}
              target="_blank"
              rel="noreferrer"
              onClick={(event) => {
                event.preventDefault();
                void openExternal(`${HANDY_REPOSITORY}/blob/main/LICENSE`);
              }}
            >
              {t("branding.upstreamLicenseLink", {
                defaultValue: "MIT License",
              })}
            </a>
          </div>
          <details className="settings-disclosure mt-3 rounded-xl border border-mid-gray/20 bg-mid-gray/5">
            <summary className="text-text">
              {t("branding.fullLicenseSummary", {
                defaultValue: "View the full upstream MIT notice",
              })}
            </summary>
            <pre className="mx-4 mb-4 max-h-56 overflow-auto whitespace-pre-wrap text-xs leading-relaxed text-text/70">
              {upstreamLicense}
            </pre>
          </details>
        </SettingContainer>
        <SettingContainer
          title={t("branding.ggmlTitle", {
            defaultValue: "ggml and transcribe.cpp",
          })}
          description={t("branding.ggmlDescription", {
            defaultValue:
              "Local speech-to-text depends on these open-source projects.",
          })}
          grouped={true}
          layout="stacked"
        >
          <div className="text-sm text-mid-gray">
            {t("branding.ggmlDetails", {
              defaultValue:
                "Thanks to Georgi Gerganov and the contributors to ggml and transcribe.cpp.",
            })}
          </div>
        </SettingContainer>
      </SettingsGroup>
    </div>
  );
};
