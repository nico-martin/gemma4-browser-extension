import { Hammer } from "lucide-react";
import { KeyboardEvent, useEffect, useRef, useState } from "react";
import { Controller, useForm } from "react-hook-form";

import { ToolName, resolveActiveTools } from "../../shared/tools.ts";
import {
  BackgroundMessages,
  BackgroundTasks,
  ChatMessage,
  ResponseStatus,
} from "../../shared/types.ts";
import { Button, InputText } from "../theme";
import cn from "../utils/classnames.ts";
import ChatCommands, { ChatCommandsRef, Command } from "./ChatCommands.tsx";
import ChatToolsModal from "./ChatToolsModal.tsx";
import MessageContent from "./MessageContent.tsx";

interface FormParams {
  input: string;
}

export default function Chat() {
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const commandsRef = useRef<ChatCommandsRef>(null);
  const {
    control,
    formState: { errors },
    handleSubmit,
    reset,
    setValue,
    watch,
  } = useForm<FormParams>({
    defaultValues: {
      input: "",
    },
  });
  const [messages, setMessages] = useState<Array<ChatMessage>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [showCommands, setShowCommands] = useState<boolean>(false);
  const [toolsOpen, setToolsOpen] = useState<boolean>(false);

  const [activeTools, setActiveTools] = useState<ToolName[]>(() =>
    resolveActiveTools()
  );
  const [allowRemoteSearch, setAllowRemoteSearch] = useState(false);
  const [toolsLoaded, setToolsLoaded] = useState<boolean>(false);

  const inputValue = watch("input");

  useEffect(() => {
    let mounted = true;
    const loadSettings = async () => {
      try {
        const saved = await chrome.storage.local.get([
          "activeTools",
          "allowRemoteSearch",
        ]);
        if (!mounted) return;
        const allowed = saved.allowRemoteSearch === true;
        setActiveTools(
          resolveActiveTools(
            Array.isArray(saved.activeTools) ? saved.activeTools : undefined,
            allowed
          )
        );
        setAllowRemoteSearch(allowed);
        setToolsLoaded(true);
      } catch (error) {
        if (mounted) alert(`Could not load tool settings: ${String(error)}`);
      }
    };
    void loadSettings();
    const onSettingsChanged = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string
    ) => {
      if (
        area === "local" &&
        ("activeTools" in changes || "allowRemoteSearch" in changes)
      ) {
        void loadSettings();
      }
    };
    chrome.storage.onChanged.addListener(onSettingsChanged);
    return () => {
      mounted = false;
      chrome.storage.onChanged.removeListener(onSettingsChanged);
    };
  }, []);

  const scrollToBottom = () => {
    if (messagesContainerRef.current) {
      messagesContainerRef.current.scrollTop =
        messagesContainerRef.current.scrollHeight;
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const commands: Command[] = [
    {
      name: "/clear",
      description: "Clear message history",
      action: () => {
        chrome.runtime.sendMessage({
          type: BackgroundTasks.AGENT_CLEAR,
        });
        setMessages([]);
        setValue("input", "");
        setShowCommands(false);
      },
    },
  ];

  useEffect(() => {
    if (inputValue.startsWith("/")) {
      setShowCommands(true);
    } else {
      setShowCommands(false);
    }
  }, [inputValue]);

  useEffect(() => {
    // The background lazily restores stored permissions and tool choices before
    // creating an agent, including after a service-worker restart.
    chrome.runtime.sendMessage(
      { type: BackgroundTasks.AGENT_GET_MESSAGES },
      (response) => {
        if (
          chrome.runtime.lastError ||
          response?.status !== ResponseStatus.SUCCESS
        ) {
          alert(
            chrome.runtime.lastError?.message ||
              response?.error ||
              "Could not load conversation"
          );
          return;
        }
        setMessages(response.messages ?? []);
      }
    );
    const onMessages = (message: {
      type: BackgroundMessages;
      messages: ChatMessage[];
    }) => {
      if (message.type === BackgroundMessages.MESSAGES_UPDATE) {
        setMessages(message.messages);
      }
    };
    chrome.runtime.onMessage.addListener(onMessages);
    return () => chrome.runtime.onMessage.removeListener(onMessages);
  }, []);

  // Forward keyboard events to ChatCommands
  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    commandsRef.current?.handleKeyDown(e);
  };

  const onSubmit = (data: FormParams) => {
    setIsLoading(true);
    reset();

    inputRef.current?.focus();

    chrome.runtime.sendMessage(
      {
        type: BackgroundTasks.AGENT_GENERATE_TEXT,
        prompt: data.input,
      },
      (resp) => {
        if (
          chrome.runtime.lastError ||
          resp?.status !== ResponseStatus.SUCCESS
        ) {
          alert(
            chrome.runtime.lastError?.message ||
              resp?.error ||
              "Could not generate a response"
          );
        }
        setIsLoading(false);
      }
    );
  };

  return (
    <div className="flex flex-col h-full">
      <div
        ref={messagesContainerRef}
        className="flex-1 overflow-y-auto px-6 py-4 space-y-4"
      >
        {(messages || []).length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-sm text-chrome-text-secondary">
              Start a conversation by typing a message below
            </p>
          </div>
        ) : (
          messages.map((message, index) => (
            <div
              key={index}
              className={cn(
                "max-w-[85%] rounded-md px-4 py-3",
                message.role === "user"
                  ? "ml-auto bg-chrome-accent-primary text-chrome-bg-primary"
                  : "bg-chrome-bg-secondary"
              )}
            >
              <div className="text-sm">
                {message.role === "user" ? (
                  message.content
                ) : (
                  <MessageContent
                    content={message.content}
                    tools={message.tools}
                    metrics={message.metrics}
                  />
                )}
              </div>
            </div>
          ))
        )}
      </div>

      <div className="border-t border-chrome-border px-6 py-4 bg-chrome-bg-secondary relative">
        <ChatCommands
          ref={commandsRef}
          commands={commands}
          inputValue={inputValue}
          isOpen={showCommands}
          onClose={() => setShowCommands(false)}
          onExecute={() => setShowCommands(false)}
        />
        {toolsOpen && (
          <ChatToolsModal
            activeTools={activeTools}
            allowRemoteSearch={allowRemoteSearch}
            onClose={() => setToolsOpen(false)}
            onSubmit={(tools: ToolName[], allowed: boolean) => {
              setActiveTools(tools);
              setAllowRemoteSearch(allowed);
              setToolsOpen(false);
            }}
          />
        )}
        <form onSubmit={handleSubmit(onSubmit)} className="flex gap-3">
          <Button
            type="button"
            color="secondary"
            variant="solid"
            iconLeft={<Hammer />}
            onClick={() => setToolsOpen(true)}
            disabled={!toolsLoaded}
          />
          <Controller
            name="input"
            control={control}
            rules={{ required: "Message is required" }}
            render={({ field }) => (
              <InputText
                {...field}
                id="chat-input"
                label="Message"
                placeholder="Type your message or / for commands..."
                //disabled={isLoading}
                error={errors.input?.message}
                hideLabel
                className="flex-1"
                onKeyDown={handleKeyDown}
                ref={(e) => {
                  field.ref(e);
                  (inputRef as any).current = e;
                }}
              />
            )}
          />
          <Button
            type="submit"
            disabled={isLoading || showCommands || !toolsLoaded}
            color="primary"
            variant="solid"
          >
            Send
          </Button>
        </form>
      </div>
    </div>
  );
}
