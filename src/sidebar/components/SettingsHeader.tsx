import { useEffect, useState } from "react";

import { TEXT_GENERATION_MODEL_OPTIONS } from "../../shared/constants.ts";
import { BackgroundTasks, ResponseStatus } from "../../shared/types.ts";
import cn from "../utils/classnames.ts";

interface SettingsHeaderProps {
  className?: string;
}

export default function SettingsHeader({
  className = "",
}: SettingsHeaderProps) {
  const [currentModel, setCurrentModel] = useState<string>("");
  const [switching, setSwitching] = useState(false);

  useEffect(() => {
    chrome.runtime.sendMessage(
      { type: BackgroundTasks.GET_CURRENT_MODEL },
      (response) => {
        if (response?.status === ResponseStatus.SUCCESS) {
          setCurrentModel(response.modelKey);
        }
      }
    );
  }, []);

  const handleModelChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const modelKey = e.target.value;
    if (modelKey === currentModel || switching) return;

    setSwitching(true);
    chrome.runtime.sendMessage(
      { type: BackgroundTasks.SWITCH_MODEL, modelKey },
      (response) => {
        setSwitching(false);
        if (response?.status === ResponseStatus.SUCCESS) {
          setCurrentModel(modelKey);
        } else {
          alert(`Failed to switch model: ${response?.error ?? "Unknown error"}`);
        }
      }
    );
  };

  return (
    <header
      className={cn(
        className,
        "border-b border-chrome-border bg-chrome-bg-primary px-6 py-4"
      )}
    >
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-normal text-chrome-text-primary leading-tight">
            Gemma 4 Browser Assistant
          </h1>
          <p className="text-sm text-chrome-text-secondary mt-1">
            Powered by{" "}
            <a
              href="https://github.com/huggingface/transformers.js"
              target="_blank"
              className="text-chrome-accent-primary hover:text-chrome-accent-hover no-underline"
              rel="noreferrer"
            >
              🤗 Transformers.js
            </a>
          </p>
        </div>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <label
          htmlFor="model-select"
          className="text-xs text-chrome-text-secondary whitespace-nowrap"
        >
          Model:
        </label>
        <select
          id="model-select"
          value={currentModel}
          onChange={handleModelChange}
          disabled={switching}
          className="text-xs rounded border border-chrome-border bg-chrome-bg-primary text-chrome-text-primary px-2 py-1 focus:outline-none focus:ring-1 focus:ring-chrome-accent-primary"
        >
          {TEXT_GENERATION_MODEL_OPTIONS.map((opt) => (
            <option key={opt.key} value={opt.key}>
              {opt.title}
            </option>
          ))}
        </select>
        {switching && (
          <span className="text-xs text-chrome-text-secondary animate-pulse">
            Switching…
          </span>
        )}
      </div>
    </header>
  );
}
