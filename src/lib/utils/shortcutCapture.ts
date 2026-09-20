// Shortcut suspension is process-wide: only one settings row may own capture.
let owner: symbol | null = null;
export function claimShortcutCapture(token: symbol): boolean {
  if (owner !== null) return false;
  owner = token;
  return true;
}
export function releaseShortcutCapture(token: symbol): void {
  if (owner === token) owner = null;
}
export function shortcutIdentity(binding: string): string {
  const aliases: Record<string, string> = {
    ctrl: "control",
    cmd: "command",
    meta: "command",
    super: "command",
    alt: "option",
    esc: "escape",
  };
  return binding
    .toLowerCase()
    .split("+")
    .map((key) => aliases[key.trim()] ?? key.trim())
    .sort()
    .join("+");
}
