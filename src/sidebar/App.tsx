import { useEffect, useState } from "react";

import {
  BackgroundMessages,
  BackgroundTasks,
  ResponseStatus,
} from "../shared/types.ts";
import Chat from "./chat/Chat.tsx";
import SettingsHeader from "./components/SettingsHeader.tsx";
import { Button, Loader, Message, Slider } from "./theme";
import { formatBytes } from "./utils/format.ts";

enum AppStatus {
  IDLE,
  CHECKING,
  NEEDS_DOWNLOAD,
  DOWNLOADING,
  READY,
  ERROR,
}

export default function App() {
  const [status, setStatus] = useState<AppStatus>(AppStatus.IDLE);
  const [error, setError] = useState<string | null>(null);
  const [modelSize, setModelSize] = useState<number>(0);
  const [downloadingModels, setDownloadingModels] = useState<
    Record<string, number>
  >({});

  useEffect(() => {
    setStatus(AppStatus.CHECKING);
    const messageListener = (message: any) => {
      if (message.type === BackgroundMessages.DOWNLOAD_PROGRESS) {
        setDownloadingModels((prev) => ({
          ...prev,
          [message.modelId]: message.percentage,
        }));
      }
    };

    chrome.runtime.onMessage.addListener(messageListener);
    chrome.runtime.sendMessage(
      { type: BackgroundTasks.CHECK_MODELS },
      (
        e:
          | {
              results: Array<{
                size: number;
                cached: boolean;
                modelId: string;
              }>;
              status: ResponseStatus.SUCCESS;
            }
          | {
              error: string;
              status: ResponseStatus.ERROR;
            }
      ) => {
        if (e.status === ResponseStatus.SUCCESS) {
          setModelSize(e.results.reduce((acc, model) => acc + model.size, 0));
          if (e.results.find((r) => !r.cached)) {
            setStatus(AppStatus.NEEDS_DOWNLOAD);
          } else {
            setStatus(AppStatus.READY);
          }
        }
        if (e.status === ResponseStatus.ERROR) {
          setError(e.error);
          setStatus(AppStatus.ERROR);
        }
      }
    );

    return () => {
      chrome.runtime.onMessage.removeListener(messageListener);
    };
  }, []);

  if (status === AppStatus.ERROR) {
    return (
      <div className="flex items-center justify-center h-full w-full flex-col gap-8 px-6">
        <Message type="error" title="Setup error">
          {error}
        </Message>
      </div>
    );
  }

  if (status === AppStatus.IDLE || status === AppStatus.CHECKING) {
    return (
      <div className="flex items-center justify-center h-full w-full flex-col gap-8 px-6">
        <Loader />
      </div>
    );
  }

  if (status === AppStatus.NEEDS_DOWNLOAD || status === AppStatus.DOWNLOADING) {
    return (
      <div className="flex items-center justify-center h-full w-full flex-col gap-8 px-6">
        <div className="text-center max-w-md">
          <h1 className="text-3xl font-normal text-chrome-text-primary mb-2">
            Welcome to Gemma 4
          </h1>
          <p className="text-sm text-chrome-text-secondary mb-6">
            Download the required AI models to get started. This is a one-time
            setup.
          </p>
          <Button
            loading={status === AppStatus.DOWNLOADING}
            onClick={() => {
              setStatus(AppStatus.DOWNLOADING);
              chrome.runtime.sendMessage(
                { type: BackgroundTasks.INITIALIZE_MODELS },
                () => setStatus(AppStatus.READY)
              );
            }}
            className="w-full"
          >
            Download Models ({formatBytes(modelSize)})
          </Button>
        </div>
        <div className="w-full max-w-md flex flex-col gap-2">
          {Object.entries(downloadingModels).map(([id, progress]) => (
            <Slider
              key={id}
              text={`${id} (${progress.toFixed(0)}%)`}
              width={progress}
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="h-full w-full flex flex-col">
      <SettingsHeader />
      <main className="flex-1 overflow-y-auto bg-chrome-bg-primary">
        <Chat />
      </main>
    </div>
  );
}
