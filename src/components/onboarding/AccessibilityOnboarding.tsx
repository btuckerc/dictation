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
import appIcon from "../../../src-tauri/icons/128x128.png";
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
  const [repairDone, setRepairDone] = useState(false);
  const [repairBusy, setRepairBusy] = useState(false);
  const repairInFlight = useRef(false);
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
        else {
          await invoke("open_dictation_permission_settings", { permission });
          // A bounded retry handles Settings launch; no ongoing window tracking.
          for (const delay of [0, 250, 500, 750]) {
            if (delay)
              await new Promise((resolve) => setTimeout(resolve, delay));
            if (!mounted.current) break;
            if (
              await invoke<boolean>("position_beside_settings").catch(
                () => true,
              )
            )
              break;
          }
        }
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

  const repair = async () => {
    if (preview || repairInFlight.current || requesting !== null) return;
    repairInFlight.current = true;
    setRepairBusy(true);
    setError(null);
    try {
      await invoke("reset_dictation_accessibility");
      if (!mounted.current) return;
      setGranted((old) => ({ ...old, accessibility: false }));
      setReady(false);
      setRepairDone(true);
      await request("accessibility", true);
    } catch (e) {
      if (mounted.current) setError(String(e));
    } finally {
      repairInFlight.current = false;
      if (mounted.current) setRepairBusy(false);
    }
  };
  const dragApp = async () => {
    if (preview) return;
    try {
      await invoke("drag_dictation_app");
    } catch (e) {
      if (mounted.current) setError(String(e));
    }
  };
  const reveal = async () => {
    try {
      await invoke("reveal_dictation_app");
    } catch (e) {
      if (mounted.current) setError(String(e));
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
                  {attempted[permission] && permission !== "accessibility" && (
                    <p className="text-sm text-mid-gray">
                      {t(`dictation.setup.${permission}Recovery`)}
                    </p>
                  )}
                  {(permission !== "accessibility" || os !== "macos") && (
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
                  )}
                  {permission === "accessibility" && os === "macos" && (
                    <div className="flex items-center gap-3 rounded-xl bg-logo-primary/5 p-3">
                      <button
                        type="button"
                        draggable={!preview}
                        disabled={preview}
                        aria-label={t("dictation.setup.repair.drag")}
                        className="shrink-0 cursor-grab active:cursor-grabbing rounded-xl focus-visible:ring-2 focus-visible:ring-logo-primary"
                        onDragStart={(event) => {
                          event.preventDefault();
                          void dragApp();
                        }}
                        onClick={() => void request("accessibility", true)}
                      >
                        <img
                          src={appIcon}
                          width={56}
                          height={56}
                          draggable={false}
                          alt=""
                        />
                      </button>
                      <div className="space-y-2">
                        <p className="text-sm">
                          {t("dictation.setup.repair.dragHint")}
                        </p>
                        <Button
                          disabled={preview || requesting !== null}
                          onClick={() => void request("accessibility", true)}
                        >
                          {t("accessibility.openSettings")}
                        </Button>
                      </div>
                    </div>
                  )}
                  {permission === "accessibility" && os === "macos" && (
                    <details className="rounded-xl border border-mid-gray/20 p-3">
                      <summary className="cursor-pointer text-sm font-medium">
                        {t("dictation.setup.repair.title")}
                      </summary>
                      <div className="space-y-3 pt-3">
                        <p className="text-sm">
                          {t("dictation.setup.repair.explanation")}
                        </p>
                        <Button
                          variant="secondary"
                          disabled={
                            preview ||
                            repairBusy ||
                            requesting !== null ||
                            repairDone
                          }
                          onClick={() => void repair()}
                        >
                          {t(
                            repairDone
                              ? "dictation.setup.repair.resetDone"
                              : "dictation.setup.repair.action",
                          )}
                        </Button>
                        {repairDone && (
                          <p role="status" className="text-sm">
                            {t("dictation.setup.repair.next")}
                          </p>
                        )}
                        <p className="text-sm text-mid-gray">
                          {t("dictation.setup.repair.manual")}
                        </p>
                        <Button
                          variant="secondary"
                          disabled={preview || repairBusy}
                          onClick={() => void reveal()}
                        >
                          {t("dictation.setup.repair.reveal")}
                        </Button>
                      </div>
                    </details>
                  )}
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
