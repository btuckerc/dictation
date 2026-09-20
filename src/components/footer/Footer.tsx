import { APP_VERSION } from "@/lib/version";
import React, { useState, useEffect } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { useTranslation } from "react-i18next";
import { openUrl } from "@tauri-apps/plugin-opener";

import ModelSelector from "../model-selector";
import UpdateChecker from "../update-checker";

const Footer: React.FC = () => {
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

  const openProject = async () => {
    try {
      await openUrl("https://github.com/btuckerc/dictation");
    } catch (error) {
      console.error("Failed to open project link:", error);
    }
  };

  return (
    <div className="w-full border-t border-mid-gray/20 pt-3">
      <div className="flex justify-between items-center text-xs px-4 pb-3 text-text/60">
        <div className="flex items-center gap-4">
          <ModelSelector />
        </div>

        {/* Update Status */}
        <div className="flex items-center gap-2">
          <UpdateChecker />
          <span>•</span>
          <button
            type="button"
            className="cursor-pointer hover:text-text"
            onClick={() => void openProject()}
            aria-label={t("branding.projectLinkLabel", {
              defaultValue: "Open Dictation source code",
            })}
          >
            {t("branding.appName", { defaultValue: "Dictation" })}
          </button>
          <span>•</span>
          {/* eslint-disable-next-line i18next/no-literal-string */}
          <span>v{version}</span>
        </div>
      </div>
    </div>
  );
};

export default Footer;
