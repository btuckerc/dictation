import React from "react";
import { HelpTooltip } from "./HelpTooltip";

interface SettingsGroupProps {
  title?: string;
  description?: string;
  children: React.ReactNode;
}

export const SettingsGroup: React.FC<SettingsGroupProps> = ({
  title,
  description,
  children,
}) => {
  return (
    <div className="space-y-2">
      {title && (
        <div className="px-4 flex items-center gap-2">
          <h2 className="text-xs font-medium text-mid-gray uppercase tracking-wide">
            {title}
          </h2>
          {description && <HelpTooltip text={description} />}
        </div>
      )}
      <div className="settings-surface overflow-visible">
        <div className="divide-y divide-mid-gray/20">{children}</div>
      </div>
    </div>
  );
};
