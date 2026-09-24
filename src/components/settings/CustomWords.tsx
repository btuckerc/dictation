import React, {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { useSettings } from "../../hooks/useSettings";
import { Input } from "../ui/Input";
import { Button } from "../ui/Button";
import { SettingContainer } from "../ui/SettingContainer";

interface CustomWordsProps {
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
    const wordList = useRef<HTMLUListElement>(null);
    const [scrollEdges, setScrollEdges] = useState({
      above: false,
      below: false,
    });
    const updateScrollEdges = useCallback(() => {
      const list = wordList.current;
      const above = !!list && list.scrollTop > 1;
      const below =
        !!list && list.scrollHeight - list.clientHeight - list.scrollTop > 1;
      setScrollEdges((previous) =>
        previous.above === above && previous.below === below
          ? previous
          : { above, below },
      );
    }, []);
    const customWords = getSetting("custom_words") || [];
    const normalizedWord = normalizeCustomWord(newWord);
    const queryKey = duplicateKey(newWord);
    const filteredWords = useMemo(
      () => customWords.filter((word) => duplicateKey(word).includes(queryKey)),
      [customWords, queryKey],
    );

    useLayoutEffect(() => {
      updateScrollEdges();
      const list = wordList.current;
      if (!list) return;
      const observer = new ResizeObserver(updateScrollEdges);
      observer.observe(list);
      return () => observer.disconnect();
    }, [filteredWords, updateScrollEdges]);

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
          description=""
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
              aria-label={t("settings.advanced.customWords.placeholder")}
              aria-describedby={message ? "custom-words-message" : undefined}
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
            <div className="relative">
              <ul
                ref={wordList}
                onScroll={updateScrollEdges}
                className="flex max-h-24 flex-wrap content-start gap-1.5 overflow-y-auto overscroll-contain rounded-md focus-visible:outline-2 focus-visible:outline-logo-primary"
                tabIndex={0}
                aria-label={t("settings.advanced.customWords.title")}
              >
                {filteredWords.map((word) => (
                  <li
                    key={word}
                    className="flex max-w-full min-w-0 items-center gap-1 rounded-full bg-mid-gray/10 py-0.5 pl-2.5 pr-0.5"
                  >
                    <span className="min-w-0 break-words text-sm">{word}</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveWord(word)}
                      disabled={isUpdating("custom_words")}
                      aria-label={t("settings.advanced.customWords.remove", {
                        word,
                      })}
                      className="shrink-0 rounded-full p-1 text-mid-gray hover:bg-red-500/10 hover:text-red-400 focus-visible:outline-2 focus-visible:outline-logo-primary"
                    >
                      <X size={16} aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
              {scrollEdges.above && (
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-x-0 top-0 h-3 rounded-t-md bg-gradient-to-b from-black/15 to-transparent"
                />
              )}
              {scrollEdges.below && (
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-x-0 bottom-0 h-3 rounded-b-md bg-gradient-to-t from-black/15 to-transparent"
                />
              )}
            </div>
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
