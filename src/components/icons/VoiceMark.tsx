import type { SVGProps } from "react";

type VoiceMarkProps = SVGProps<SVGSVGElement> & { size?: number | string };

/** Dictation's original five-bar mark, drawn for small interface sizes. */
export default function VoiceMark({
  size = 24,
  width = size,
  height = size,
  ...props
}: VoiceMarkProps) {
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <path d="M3.2 8.5v7M7.6 5.5v13M12 2v20M16.4 6v12M20.8 9v6" />
    </svg>
  );
}
