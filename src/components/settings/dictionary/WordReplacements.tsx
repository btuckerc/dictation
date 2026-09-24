import React, { useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowRight, Pencil, X } from "lucide-react";
import type { WordReplacement } from "@/bindings";
import { useSettings } from "../../../hooks/useSettings";
import { Input } from "../../ui/Input";
import { Button } from "../../ui/Button";
import { SettingsGroup } from "../../ui/SettingsGroup";

export const WordReplacements: React.FC = () => {
  const { t } = useTranslation();
  const { getSetting, updateSetting, isUpdating } = useSettings();
  const id = useId();
  const form = useRef<HTMLFormElement>(null);
  const saving = useRef(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const rules = getSetting("word_replacements") ?? [];
  const pending = busy || isUpdating("word_replacements");
  const key = "settings.dictionary.replacements";

  const focusSource = () => form.current?.querySelector("input")?.focus();
  const clearDraft = () => {
    setFrom("");
    setTo("");
    setEditing(null);
    setError(null);
  };

  const persist = async (next: WordReplacement[]) => {
    if (saving.current || isUpdating("word_replacements")) return false;
    saving.current = true;
    setBusy(true);
    setError(null);
    setStatus("");
    try {
      await updateSetting("word_replacements", next);
      const saved = getSetting("word_replacements") ?? [];
      if (
        saved.length !== next.length ||
        saved.some(
          (rule, index) =>
            rule.from !== next[index].from || rule.to !== next[index].to,
        )
      ) {
        setError(t(`${key}.saveFailed`));
        return false;
      }
      return true;
    } catch {
      setError(t(`${key}.saveFailed`));
      return false;
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (saving.current || pending) return;
    const replacement = { from: from.trim(), to: to.trim() };
    if (!replacement.from || !replacement.to) {
      setError(t(`${key}.required`));
      return;
    }
    const latest = getSetting("word_replacements") ?? [];
    if (
      latest.some(
        (rule) =>
          rule.from !== editing &&
          rule.from.toLowerCase() === replacement.from.toLowerCase(),
      )
    ) {
      setError(t(`${key}.duplicate`, { word: replacement.from }));
      return;
    }
    const next =
      editing === null
        ? [...latest, replacement]
        : latest.map((rule) => (rule.from === editing ? replacement : rule));
    if (await persist(next)) {
      clearDraft();
      setStatus(t(`${key}.saved`));
      requestAnimationFrame(focusSource);
    }
  };

  const editRule = (rule: WordReplacement) => {
    setFrom(rule.from);
    setTo(rule.to);
    setEditing(rule.from);
    setError(null);
    setStatus("");
    focusSource();
    form.current?.scrollIntoView({ block: "nearest" });
  };

  const removeRule = async (source: string) => {
    const latest = getSetting("word_replacements") ?? [];
    if (await persist(latest.filter((rule) => rule.from !== source))) {
      setStatus(t(`${key}.removed`, { word: source }));
    }
  };

  return (
    <SettingsGroup
      title={t(`${key}.title`)}
      description={t(`${key}.description`)}
    >
      <div className="p-4 space-y-3">
        <form ref={form} onSubmit={save} noValidate className="space-y-3">
          <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-end gap-2">
            <div className="min-w-0 space-y-1">
              <label
                htmlFor={`${id}-from`}
                className="block text-sm font-medium"
              >
                {t(`${key}.from`)}
              </label>
              <Input
                id={`${id}-from`}
                className="w-full"
                value={from}
                disabled={pending}
                placeholder={t(`${key}.fromPlaceholder`)}
                autoComplete="off"
                spellCheck={false}
                aria-describedby={error ? `${id}-error` : undefined}
                onChange={(event) => {
                  setFrom(event.target.value);
                  setError(null);
                  setStatus("");
                }}
              />
            </div>
            <ArrowRight
              size={16}
              className="mb-3 text-mid-gray"
              aria-hidden="true"
            />
            <div className="min-w-0 space-y-1">
              <label htmlFor={`${id}-to`} className="block text-sm font-medium">
                {t(`${key}.to`)}
              </label>
              <Input
                id={`${id}-to`}
                className="w-full"
                value={to}
                disabled={pending}
                placeholder={t(`${key}.toPlaceholder`)}
                autoComplete="off"
                spellCheck={false}
                aria-describedby={error ? `${id}-error` : undefined}
                onChange={(event) => {
                  setTo(event.target.value);
                  setError(null);
                  setStatus("");
                }}
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" disabled={pending || (!from && !to)}>
              {t(
                `${key}.${pending ? "saving" : editing === null ? "add" : "save"}`,
              )}
            </Button>
            {editing !== null && (
              <Button
                type="button"
                variant="ghost"
                disabled={pending}
                onClick={() => {
                  clearDraft();
                  focusSource();
                }}
              >
                {t(`${key}.cancel`)}
              </Button>
            )}
          </div>
        </form>
        {error && (
          <p id={`${id}-error`} role="alert" className="text-sm text-red-400">
            {error}
          </p>
        )}
        <p role="status" className="sr-only">
          {status}
        </p>
      </div>
      {rules.length > 0 && (
        <div className="p-4">
          <ul aria-label={t(`${key}.title`)} className="space-y-1">
            {rules.map((rule) => (
              <li
                key={rule.from}
                className={`flex items-center gap-2 rounded-md px-3 py-2 ${editing === rule.from ? "bg-logo-primary/10" : "bg-mid-gray/10"}`}
              >
                <div className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 text-sm">
                  <span className="break-words whitespace-pre-wrap">
                    {rule.from}
                  </span>
                  <ArrowRight
                    size={14}
                    className="text-mid-gray"
                    aria-hidden="true"
                  />
                  <span className="break-words whitespace-pre-wrap font-medium">
                    {rule.to}
                  </span>
                </div>
                <button
                  type="button"
                  disabled={pending || editing !== null}
                  onClick={() => editRule(rule)}
                  aria-label={t(`${key}.edit`, { word: rule.from })}
                  className="shrink-0 rounded-md p-2 text-mid-gray hover:bg-logo-primary/10 hover:text-text focus-visible:outline-2 focus-visible:outline-logo-primary disabled:opacity-40"
                >
                  <Pencil size={15} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  disabled={pending || editing !== null}
                  onClick={() => void removeRule(rule.from)}
                  aria-label={t(`${key}.remove`, { word: rule.from })}
                  className="shrink-0 rounded-md p-2 text-mid-gray hover:bg-red-500/10 hover:text-red-400 focus-visible:outline-2 focus-visible:outline-logo-primary disabled:opacity-40"
                >
                  <X size={16} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </SettingsGroup>
  );
};
