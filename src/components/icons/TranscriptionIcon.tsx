/** Voice becoming text: two meter bars alongside three text strokes. */
export default function TranscriptionIcon({
  width = 24,
  height = 24,
  color = "var(--color-logo-primary)",
  className = "",
}: {
  width?: number;
  height?: number;
  color?: string;
  className?: string;
}) {
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2.4"
      strokeLinecap="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <path d="M3 8v8M7.5 4v16M13 6h8M13 12h6M13 18h8" />
    </svg>
  );
}
