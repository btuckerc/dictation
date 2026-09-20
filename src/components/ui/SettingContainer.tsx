import React from "react";
import { HelpTooltip } from "./HelpTooltip";

interface SettingContainerProps {
  title: string;
  description: string;
  children: React.ReactNode;
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
  layout?: "horizontal" | "stacked";
  disabled?: boolean;
  tooltipPosition?: "top" | "bottom";
}

export const SettingContainer: React.FC<SettingContainerProps> = ({
  title,
  description,
  children,
  descriptionMode = "tooltip",
  grouped = false,
  layout = "horizontal",
  disabled = false,
  tooltipPosition = "top",
}) => {
  const stacked = layout === "stacked";
  return (
    <div
      className={`${stacked ? "" : "flex items-center justify-between gap-3 min-h-12"} px-4 py-2 ${grouped ? "" : "rounded-lg border border-mid-gray/20"}`}
    >
      <div className={stacked ? "mb-2" : "min-w-0"}>
        <div className="flex items-center gap-2">
          <h3 className={`text-sm font-medium ${disabled ? "opacity-50" : ""}`}>
            {title}
          </h3>
          {description && descriptionMode === "tooltip" && (
            <HelpTooltip text={description} position={tooltipPosition} />
          )}
        </div>
        {description && descriptionMode === "inline" && (
          <p
            className={`text-sm text-mid-gray ${disabled ? "opacity-50" : ""}`}
          >
            {description}
          </p>
        )}
      </div>
      <div
        className={
          stacked ? "w-full" : "relative shrink-0 flex items-center gap-2"
        }
      >
        {children}
      </div>
    </div>
  );
};
