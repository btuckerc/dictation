import React, { useEffect, useState, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  getKeyName,
  formatKeyCombination,
  normalizeKey,
} from "../../lib/utils/keyboard";
import { ResetButton } from "../ui/ResetButton";
import { SettingContainer } from "../ui/SettingContainer";
import { useSettings } from "../../hooks/useSettings";
import { useOsType } from "../../hooks/useOsType";
import { commands } from "@/bindings";
import { toast } from "sonner";
import {
  claimShortcutCapture,
  releaseShortcutCapture,
  shortcutIdentity,
} from "@/lib/utils/shortcutCapture";

interface GlobalShortcutInputProps {
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
  shortcutId: string;
  disabled?: boolean;
}

export const GlobalShortcutInput: React.FC<GlobalShortcutInputProps> = ({
  descriptionMode = "tooltip",
  grouped = false,
  shortcutId,
  disabled = false,
}) => {
  const { t } = useTranslation();
  const { getSetting, updateBinding, resetBinding, isUpdating, isLoading } =
    useSettings();
  const [keyPressed, setKeyPressed] = useState<string[]>([]);
  const [recordedKeys, setRecordedKeys] = useState<string[]>([]);
  const [editingShortcutId, setEditingShortcutId] = useState<string | null>(
    null,
  );
  const [originalBinding, setOriginalBinding] = useState<string>("");
  const shortcutRefs = useRef<Map<string, HTMLButtonElement | null>>(new Map());
  const osType = useOsType();
  const editingRef = useRef<string | null>(null);
  const originalBindingRef = useRef("");
  const suspendedRef = useRef(false);
  const phaseRef = useRef<
    "idle" | "starting" | "recording" | "cancelling" | "committing"
  >("idle");
  const mountedRef = useRef(true);
  const cancelRecordingRef = useRef<() => Promise<void>>(async () => {});

  const ownerRef = useRef(Symbol());
  const pressedRef = useRef<string[]>([]);
  const recordedRef = useRef<string[]>([]);
  const bindings = getSetting("bindings") || {};

  const finishRecording = useCallback(async () => {
    editingRef.current = null; // Unmount must not roll back a committed value.
    phaseRef.current = "cancelling";
    try {
      if (suspendedRef.current) {
        suspendedRef.current = false;
        const result = await commands.resumeAllBindings();
        if (result.status === "error") throw new Error(result.error);
      }
    } catch (error) {
      toast.error(t("settings.general.shortcut.errors.restore"));
      console.error(error);
    } finally {
      phaseRef.current = "idle";
      releaseShortcutCapture(ownerRef.current);
      originalBindingRef.current = "";
      pressedRef.current = [];
      recordedRef.current = [];
      if (mountedRef.current) {
        setEditingShortcutId(null);
        setKeyPressed([]);
        setRecordedKeys([]);
        setOriginalBinding("");
      }
    }
  }, [t]);

  const cancelRecording = useCallback(async () => {
    if (
      !editingRef.current ||
      phaseRef.current === "cancelling" ||
      phaseRef.current === "committing"
    )
      return;
    const starting = phaseRef.current === "starting";
    phaseRef.current = "cancelling";
    // The start continuation owns cleanup if native suspension is still pending.
    if (!starting) await finishRecording();
  }, [finishRecording]);

  // Never leave global shortcuts suspended when this settings row unmounts.
  useEffect(() => {
    cancelRecordingRef.current = cancelRecording;
  }, [cancelRecording]);
  useEffect(() => {
    mountedRef.current = true;
    const onBlur = () => {
      void cancelRecordingRef.current();
    };
    window.addEventListener("blur", onBlur);
    return () => {
      mountedRef.current = false;
      window.removeEventListener("blur", onBlur);
      void cancelRecordingRef.current();
    };
  }, []);

  useEffect(() => {
    // Only add event listeners when we're in editing mode
    if (editingShortcutId === null) return;

    let cleanup = false;

    // Keyboard event listeners
    const handleKeyDown = async (e: KeyboardEvent) => {
      if (cleanup || phaseRef.current !== "recording") return;
      if (e.repeat) return; // ignore auto-repeat
      e.preventDefault();

      if (e.key === "Escape") {
        void cancelRecording();
        return;
      }

      // Get the key with OS-specific naming and normalize it
      const rawKey = getKeyName(e, osType);
      const key = normalizeKey(rawKey);

      // Include modifiers held before clicking the recorder; their keydown
      // may have occurred before this component installed its listeners.
      const keys = [key];
      if (e.ctrlKey) keys.push("ctrl");
      if (e.altKey) keys.push(osType === "macos" ? "option" : "alt");
      if (e.metaKey) keys.push(osType === "macos" ? "command" : "super");
      if (e.shiftKey) keys.push("shift");
      pressedRef.current = Array.from(
        new Set([...pressedRef.current, ...keys]),
      );
      recordedRef.current = Array.from(
        new Set([...recordedRef.current, ...keys]),
      );
      setKeyPressed(pressedRef.current);
      setRecordedKeys(recordedRef.current);
    };

    const handleKeyUp = async (e: KeyboardEvent) => {
      if (cleanup || phaseRef.current !== "recording") return;
      e.preventDefault();
      if (e.key === "Escape") return;

      // Get the key with OS-specific naming and normalize it
      const rawKey = getKeyName(e, osType);
      const key = normalizeKey(rawKey);

      // Remove from currently pressed keys
      setKeyPressed((prev) => prev.filter((k) => k !== key));

      // If no keys are pressed anymore, commit the shortcut
      const updatedKeyPressed = pressedRef.current.filter((k) => k !== key);
      pressedRef.current = updatedKeyPressed;
      if (updatedKeyPressed.length === 0 && recordedRef.current.length > 0) {
        // Create the shortcut string from all recorded keys
        // Sort keys so modifiers come first, then the main key
        const modifiers = [
          "ctrl",
          "control",
          "shift",
          "alt",
          "option",
          "meta",
          "command",
          "cmd",
          "super",
          "win",
          "windows",
        ];
        const sortedKeys = [...recordedRef.current].sort((a, b) => {
          const aIsModifier = modifiers.includes(a.toLowerCase());
          const bIsModifier = modifiers.includes(b.toLowerCase());
          if (aIsModifier && !bIsModifier) return -1;
          if (!aIsModifier && bIsModifier) return 1;
          return 0;
        });
        const newShortcut = sortedKeys.join("+");

        if (
          phaseRef.current !== "recording" ||
          (editingShortcutId && !mountedRef.current)
        )
          return;
        if (editingShortcutId && bindings[editingShortcutId]) {
          const normalizedShortcut = shortcutIdentity(newShortcut);
          const conflicts = Object.entries(bindings).some(
            ([id, binding]) =>
              id !== editingShortcutId &&
              shortcutIdentity(binding?.current_binding || "") ===
                normalizedShortcut,
          );
          if (conflicts) {
            toast.error(t("settings.general.shortcut.errors.conflict"));
            await cancelRecording();
            return;
          }
          phaseRef.current = "committing";
          try {
            await updateBinding(editingShortcutId, newShortcut);
          } catch (error) {
            console.error("Failed to change binding:", error);
            toast.error(
              t("settings.general.shortcut.errors.set", {
                error: String(error),
              }),
            );

            // Reset to original binding on error
            if (originalBinding) {
              try {
                await updateBinding(editingShortcutId, originalBinding);
              } catch (resetError) {
                console.error("Failed to reset binding:", resetError);
                toast.error(t("settings.general.shortcut.errors.reset"));
              }
            }
          }

          // Re-register all bindings (the one just committed is already
          // registered; re-registering it fails cleanly and is ignored)
          await finishRecording();
        }
      }
    };

    // Add click outside handler
    const handleClickOutside = async (e: MouseEvent) => {
      if (cleanup || phaseRef.current !== "recording") return;
      const activeElement = shortcutRefs.current.get(editingShortcutId);
      if (activeElement && !activeElement.contains(e.target as Node)) {
        await cancelRecording();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("click", handleClickOutside);

    return () => {
      cleanup = true;
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("click", handleClickOutside);
    };
  }, [
    keyPressed,
    recordedKeys,
    editingShortcutId,
    bindings,
    originalBinding,
    updateBinding,
    osType,
    cancelRecording,
    finishRecording,
  ]);

  // Start recording a new shortcut
  const startRecording = async (id: string) => {
    if (
      disabled ||
      isLoading ||
      isUpdating(`binding_${id}`) ||
      phaseRef.current !== "idle" ||
      !claimShortcutCapture(ownerRef.current)
    )
      return;
    editingRef.current = id;
    originalBindingRef.current = bindings[id]?.current_binding || "";
    phaseRef.current = "starting";
    setOriginalBinding(originalBindingRef.current);
    try {
      const result = await commands.suspendAllBindings();
      if (result.status === "error") throw new Error(result.error);
      suspendedRef.current = true;
      if (phaseRef.current !== "starting" || !mountedRef.current) {
        await finishRecording();
        return;
      }
      phaseRef.current = "recording";
      pressedRef.current = [];
      recordedRef.current = [];
      setEditingShortcutId(id);
      setKeyPressed([]);
      setRecordedKeys([]);
    } catch (error) {
      toast.error(
        t("settings.general.shortcut.errors.set", { error: String(error) }),
      );
      await finishRecording();
    }
  };

  // Format the current shortcut keys being recorded
  const formatCurrentKeys = (): string => {
    if (recordedKeys.length === 0)
      return t("settings.general.shortcut.pressKeys");

    // Use the same formatting as the display to ensure consistency
    return formatKeyCombination(recordedKeys.join("+"), osType);
  };

  // Store references to shortcut elements
  const setShortcutRef = (id: string, ref: HTMLButtonElement | null) => {
    shortcutRefs.current.set(id, ref);
  };

  // If still loading, show loading state
  if (isLoading) {
    return (
      <SettingContainer
        title={t("settings.general.shortcut.title")}
        description={t("settings.general.shortcut.description")}
        descriptionMode={descriptionMode}
        grouped={grouped}
      >
        <div className="text-sm text-mid-gray">
          {t("settings.general.shortcut.loading")}
        </div>
      </SettingContainer>
    );
  }

  // If no bindings are loaded, show empty state
  if (Object.keys(bindings).length === 0) {
    return (
      <SettingContainer
        title={t("settings.general.shortcut.title")}
        description={t("settings.general.shortcut.description")}
        descriptionMode={descriptionMode}
        grouped={grouped}
      >
        <div className="text-sm text-mid-gray">
          {t("settings.general.shortcut.none")}
        </div>
      </SettingContainer>
    );
  }

  const binding = bindings[shortcutId];
  if (!binding) {
    return (
      <SettingContainer
        title={t("settings.general.shortcut.title")}
        description={t("settings.general.shortcut.notFound")}
        descriptionMode={descriptionMode}
        grouped={grouped}
      >
        <div className="text-sm text-mid-gray">
          {t("settings.general.shortcut.none")}
        </div>
      </SettingContainer>
    );
  }

  // Get translated name and description for the binding
  const translatedName = t(
    `settings.general.shortcut.bindings.${shortcutId}.name`,
    binding.name,
  );
  const translatedDescription = t(
    `settings.general.shortcut.bindings.${shortcutId}.description`,
    binding.description,
  );

  return (
    <SettingContainer
      title={translatedName}
      description={translatedDescription}
      descriptionMode={descriptionMode}
      grouped={grouped}
      disabled={disabled}
      layout="horizontal"
    >
      <div className="flex items-center space-x-1">
        {editingShortcutId === shortcutId ? (
          <button
            type="button"
            ref={(ref) => setShortcutRef(shortcutId, ref)}
            className="px-2 py-1 text-sm font-semibold border border-logo-primary bg-logo-primary/30 rounded-md"
          >
            {formatCurrentKeys()}
          </button>
        ) : (
          <button
            type="button"
            className="px-2 py-1 text-sm font-semibold bg-mid-gray/10 border border-mid-gray/80 hover:bg-logo-primary/10 rounded-md cursor-pointer hover:border-logo-primary"
            onClick={() => startRecording(shortcutId)}
            disabled={disabled || isUpdating(`binding_${shortcutId}`)}
          >
            {formatKeyCombination(binding.current_binding, osType)}
          </button>
        )}
        {editingShortcutId !== null && (
          <button
            type="button"
            className="px-2 py-1 text-xs rounded border border-mid-gray/30"
            onClick={() => void cancelRecording()}
          >
            {t("dictation.setup.cancelShortcut")}
          </button>
        )}
        <ResetButton
          ariaLabel={t("dictation.setup.resetShortcut")}
          onClick={() =>
            void resetBinding(shortcutId).catch((error) =>
              toast.error(
                t("settings.general.shortcut.errors.set", {
                  error: String(error),
                }),
              ),
            )
          }
          disabled={
            disabled ||
            editingShortcutId !== null ||
            isUpdating(`binding_${shortcutId}`)
          }
        />
      </div>
    </SettingContainer>
  );
};
