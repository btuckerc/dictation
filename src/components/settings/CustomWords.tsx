import React, { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { useSettings } from "../../hooks/useSettings";
import { Input } from "../ui/Input";
import { Button } from "../ui/Button";
import { SettingContainer } from "../ui/SettingContainer";

interface CustomWordsProps {
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
}

const normalizeCustomWord = (word: string) =>
  word
    .replace(/[<>"']/g, "")
    .replace(/\s+/g, " ")
    .trim();

const duplicateKey = (word: string) =>
  normalizeCustomWord(word).toLocaleLowerCase();

export const CustomWords: React.FC<CustomWordsProps> = React.memo(
  ({ grouped = false }) => {
    const { t } = useTranslation();
    const { getSetting, updateSetting, isUpdating } = useSettings();
    const [newWord, setNewWord] = useState("");
    const [message, setMessage] = useState<string | null>(null);
    const updateQueue = useRef(Promise.resolve());
    const customWords = getSetting("custom_words") || [];
    const normalizedWord = normalizeCustomWord(newWord);
    const queryKey = duplicateKey(newWord);
    const filteredWords = useMemo(
      () => customWords.filter((word) => duplicateKey(word).includes(queryKey)),
      [customWords, queryKey],
    );

    const handleAddWord = () => {
      if (!normalizedWord) return;
      if (normalizedWord.length > 50) {
        setMessage(t("settings.advanced.customWords.tooLong"));
        return;
      }

      const operation = updateQueue.current.then(async () => {
        const latestWords = getSetting("custom_words") || [];
        if (
          latestWords.some(
            (word) => duplicateKey(word) === duplicateKey(normalizedWord),
          )
        ) {
          setMessage(
            t("settings.advanced.customWords.duplicate", {
              word: normalizedWord,
            }),
          );
          return;
        }
        const nextWords = [...latestWords, normalizedWord];
        await updateSetting("custom_words", nextWords);
        const savedWords = getSetting("custom_words") || [];
        if (
          savedWords.length === nextWords.length &&
          savedWords.every((word, index) => word === nextWords[index])
        ) {
          setNewWord("");
          setMessage(null);
        } else {
          setMessage(t("settings.advanced.customWords.saveFailed"));
        }
      });
      updateQueue.current = operation.catch(() => undefined);
    };

    const handleRemoveWord = (wordToRemove: string) => {
      updateQueue.current = updateQueue.current
        .then(async () => {
          const latestWords = getSetting("custom_words") || [];
          await updateSetting(
            "custom_words",
            latestWords.filter((word) => word !== wordToRemove),
          );
        })
        .catch(() => undefined);
    };

    const handleKeyPress = (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleAddWord();
      }
    };

    return (
      <>
        <SettingContainer
          title={t("settings.advanced.customWords.title")}
          description={t("settings.advanced.customWords.description")}
          descriptionMode="tooltip"
          grouped={grouped}
          layout="stacked"
        >
          <div className="flex w-full items-center gap-2">
            <Input
              type="text"
              className="min-w-0 flex-1"
              value={newWord}
              onChange={(e) => {
                setNewWord(e.target.value);
                setMessage(null);
              }}
              onKeyDown={handleKeyPress}
              placeholder={t("settings.advanced.customWords.placeholder")}
              aria-describedby="custom-words-message"
            />
            <Button
              onClick={handleAddWord}
              disabled={!normalizedWord}
              variant="primary"
              size="md"
            >
              {t("settings.advanced.customWords.add")}
            </Button>
          </div>
          {message && (
            <p
              id="custom-words-message"
              role="alert"
              className="mt-2 text-sm text-red-400"
            >
              {message}
            </p>
          )}
        </SettingContainer>
        <div
          className={`px-4 py-3 ${grouped ? "" : "rounded-lg border border-mid-gray/20"}`}
        >
          <div className="mb-2 flex items-center gap-2 text-sm text-mid-gray">
            <span>
              {t("settings.advanced.customWords.count", {
                count: filteredWords.length,
              })}
            </span>
          </div>
          {filteredWords.length > 0 ? (
            <ul
              className="grid gap-1 sm:grid-cols-2"
              aria-label={t("settings.advanced.customWords.title")}
            >
              {filteredWords.map((word) => (
                <li
                  key={word}
                  className="flex min-w-0 items-center justify-between gap-2 rounded-md bg-mid-gray/10 px-3 py-2"
                >
                  <span className="min-w-0 break-words text-sm">{word}</span>
                  <button
                    type="button"
                    onClick={() => handleRemoveWord(word)}
                    disabled={isUpdating("custom_words")}
                    aria-label={t("settings.advanced.customWords.remove", {
                      word,
                    })}
                    className="shrink-0 rounded-full p-1 text-mid-gray hover:bg-red-500/10 hover:text-red-400"
                  >
                    <X size={16} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-mid-gray">
              {customWords.length === 0
                ? t("settings.advanced.customWords.empty")
                : t("settings.advanced.customWords.noMatches")}
            </p>
          )}
          {customWords.length > 0 && (
            <p className="sr-only" aria-live="polite">
              {t("settings.advanced.customWords.count", {
                count: filteredWords.length,
              })}
            </p>
          )}
        </div>
      </>
    );
  },
);
