import VoiceMark from "./VoiceMark";

/** Compatibility export for voice actions; microphone permission uses a mic symbol. */
export default function MicrophoneIcon({
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
    <VoiceMark
      width={width}
      height={height}
      color={color}
      className={className}
    />
  );
}
