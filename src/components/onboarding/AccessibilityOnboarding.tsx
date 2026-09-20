import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { platform } from "@tauri-apps/plugin-os";
import { invoke } from "@tauri-apps/api/core";
import {
  checkAccessibilityPermission,
  requestAccessibilityPermission,
  checkMicrophonePermission,
  requestMicrophonePermission,
} from "tauri-plugin-macos-permissions-api";
import { commands } from "@/bindings";
import { useSettingsStore } from "@/stores/settingsStore";
import { Check, Keyboard, Mic } from "lucide-react";
import { Button } from "../ui/Button";
import { SetupFrame } from "./SetupFrame";

type Permission = "microphone" | "accessibility";
export default function AccessibilityOnboarding({
  onComplete,
  preview = false,
}: {
  onComplete: () => void;
  preview?: boolean;
}) {
  const { t } = useTranslation();
  const os = platform();
  const [granted, setGranted] = useState({
    microphone: false,
    accessibility: false,
  });
  const [attempted, setAttempted] = useState({
    microphone: false,
    accessibility: false,
  });
  const [requesting, setRequesting] = useState<Permission | null>(null);
  const [checking, setChecking] = useState(false);
  const [ready, setReady] = useState(false);
  const [polling, setPolling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(false);
  const inFlight = useRef(false);
  const completed = useRef(false);
  const requestInFlight = useRef(false);
  const pollUntil = useRef(0);
  const completeRef = useRef(onComplete);
  completeRef.current = onComplete;

  const check = useCallback(async () => {
    if (preview || inFlight.current || completed.current || !mounted.current)
      return;
    inFlight.current = true;
    setChecking(true);
    try {
      let microphone = true;
      let accessibility = true;
      if (os === "macos") {
        [microphone, accessibility] = await Promise.all([
          checkMicrophonePermission(),
          checkAccessibilityPermission(),
        ]);
      } else if (os === "windows") {
        const status = await commands.getWindowsMicrophonePermissionStatus();
        microphone = !status.supported || status.overall_access !== "denied";
      }
      if (!mounted.current) return;
      setGranted({ microphone, accessibility });
      setReady(false);
      setError(null);
      if (microphone && accessibility) {
        if (os === "macos") {
          // Native commands return Result objects: a resolved Promise can still fail.
          const results = await Promise.all([
            commands.initializeEnigo(),
            commands.initializeShortcuts(),
          ]);
          for (const result of results)
            if (result.status === "error") throw new Error(result.error);
        }
        if (!mounted.current) return;
        const store = useSettingsStore.getState();
        void store.refreshAudioDevices();
        void store.refreshOutputDevices();
        setReady(true);
        setPolling(false);
        return true;
      }
    } catch (e) {
      if (mounted.current) {
        setReady(false);
        setError(`${t("dictation.setup.checkFailed")} ${String(e)}`);
        pollUntil.current = 0;
      }
    } finally {
      inFlight.current = false;
      if (mounted.current) setChecking(false);
    }
  }, [os, preview, t]);

  useEffect(() => {
    mounted.current = true;
    void check();
    const onReturn = () => {
      if (!document.hidden) void check();
    };
    window.addEventListener("focus", onReturn);
    document.addEventListener("visibilitychange", onReturn);
    return () => {
      mounted.current = false;
      window.removeEventListener("focus", onReturn);
      document.removeEventListener("visibilitychange", onReturn);
    };
  }, [check, preview]);

  useEffect(() => {
    if (!polling || preview) return;
    const timer = window.setInterval(() => {
      if (Date.now() >= pollUntil.current) {
        setPolling(false);
        return;
      }
      if (!document.hidden) void check();
    }, 1000);
    return () => window.clearInterval(timer);
  }, [check, polling, preview]);

  const request = async (permission: Permission, settings = false) => {
    if (preview || requestInFlight.current) return;
    requestInFlight.current = true;
    setRequesting(permission);
    setError(null);
    setAttempted((old) => ({ ...old, [permission]: true }));
    pollUntil.current = Date.now() + 90_000;
    setPolling(true);
    try {
      if (settings || os === "windows") {
        if (os === "windows") await commands.openMicrophonePrivacySettings();
        else await invoke("open_dictation_permission_settings", { permission });
      } else if (permission === "microphone")
        await requestMicrophonePermission();
      else await requestAccessibilityPermission();
      await check();
    } catch (e) {
      if (mounted.current)
        setError(`${t("dictation.setup.requestFailed")} ${String(e)}`);
    } finally {
      requestInFlight.current = false;
      if (mounted.current) setRequesting(null);
    }
  };

  const permissions: Permission[] =
    os === "macos"
      ? ["microphone", "accessibility"]
      : os === "windows"
        ? ["microphone"]
        : [];
  return (
    <SetupFrame
      step={0}
      title={t("dictation.setup.permissionsTitle")}
      description={t("dictation.setup.permissionsDescription")}
    >
      <div className="settings-surface divide-y divide-mid-gray/20">
        {permissions.map((permission) => {
          const Icon = permission === "microphone" ? Mic : Keyboard;
          return (
            <section key={permission} className="p-5 space-y-3">
              <div className="flex gap-3 items-start">
                <Icon
                  className="w-5 h-5 mt-1 text-logo-primary shrink-0"
                  aria-hidden="true"
                />
                <div className="flex-1">
                  <h2 className="font-medium">
                    {t(`onboarding.permissions.${permission}.title`)}
                  </h2>
                  <p className="text-sm text-mid-gray">
                    {t(`dictation.setup.${permission}Why`)}
                  </p>
                </div>
                {granted[permission] && (
                  <span className="flex items-center gap-1 text-sm text-emerald-500">
                    <Check className="w-4 h-4" />
                    {t("onboarding.permissions.granted")}
                  </span>
                )}
              </div>
              {!granted[permission] && (
                <div className="pl-8 space-y-3">
                  {attempted[permission] && (
                    <p className="text-sm text-mid-gray">
                      {t(`dictation.setup.${permission}Recovery`)}
                    </p>
                  )}
                  <Button
                    disabled={preview || requesting !== null}
                    onClick={() =>
                      void request(permission, attempted[permission])
                    }
                  >
                    {requesting === permission
                      ? t("dictation.setup.opening")
                      : attempted[permission] || os === "windows"
                        ? t("accessibility.openSettings")
                        : t(`dictation.setup.allow.${permission}`)}
                  </Button>
                </div>
              )}
            </section>
          );
        })}
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      )}
      {ready && (
        <div role="status" className="text-sm text-logo-primary">
          {t("dictation.setup.permissionsReady")}
        </div>
      )}
      <div className="flex items-center justify-between gap-4">
        <p className="text-xs text-mid-gray">
          {t("dictation.setup.returnHint")}
        </p>
        <Button
          variant="secondary"
          disabled={preview || checking}
          onClick={() => void check()}
        >
          {checking
            ? t("dictation.setup.checking")
            : t("dictation.setup.checkAgain")}
        </Button>
      </div>
      <div className="flex justify-end">
        <Button
          disabled={preview || !ready || checking}
          onClick={async () => {
            if (await check()) {
              completed.current = true;
              completeRef.current();
            }
          }}
        >
          {t("dictation.setup.continue")}
        </Button>
      </div>
    </SetupFrame>
  );
}
