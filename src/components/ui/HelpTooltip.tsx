import { useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { CircleHelp } from "lucide-react";
import { Tooltip } from "./Tooltip";

export function HelpTooltip({
  text,
  label,
  position = "top",
}: {
  text: string;
  label?: string;
  position?: "top" | "bottom";
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const target = useRef<HTMLButtonElement>(null);
  const id = useId();
  return (
    <>
      <button
        type="button"
        ref={target}
        aria-label={label || t("dictation.help")}
        aria-describedby={open ? id : undefined}
        className="inline-flex shrink-0 text-mid-gray hover:text-text cursor-help rounded-full"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen(true)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            setOpen(false);
          }
        }}
      >
        <CircleHelp size={14} aria-hidden="true" />
      </button>
      {open && (
        <Tooltip targetRef={target} position={position}>
          <p role="tooltip" id={id} className="text-sm leading-relaxed">
            {text}
          </p>
        </Tooltip>
      )}
    </>
  );
}
