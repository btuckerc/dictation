import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Check } from "lucide-react";

export function SetupFrame({
  step,
  title,
  description,
  children,
}: {
  step: number;
  title: string;
  description: string;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <main className="setup-shell min-h-screen w-full px-6 py-8 flex flex-col items-center justify-center">
      <div className="w-full max-w-2xl space-y-6">
        <header className="space-y-4">
          <p className="text-sm font-semibold text-logo-primary">
            {t("dictation.appName")}
          </p>
          <ol
            aria-label={t("dictation.setup.progress")}
            className="glass-nav inline-flex rounded-full px-4 py-2 gap-4 text-xs text-mid-gray"
          >
            {["permissions", "model", "shortcut"].map((key, index) => (
              <li
                key={key}
                aria-current={step === index ? "step" : undefined}
                className={`flex items-center gap-2 ${step === index ? "text-text font-medium" : ""}`}
              >
                {step > index ? (
                  <Check
                    className="w-4 h-4 text-emerald-500"
                    aria-hidden="true"
                  />
                ) : (
                  <span className="inline-flex w-5 h-5 items-center justify-center rounded-full border border-current">
                    {index + 1}
                  </span>
                )}
                {t(`dictation.setup.steps.${key}`)}
              </li>
            ))}
          </ol>
          <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
          <p className="text-sm text-mid-gray max-w-xl">{description}</p>
        </header>
        {children}
      </div>
    </main>
  );
}
