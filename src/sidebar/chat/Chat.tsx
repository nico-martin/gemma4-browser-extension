import { Hammer } from "lucide-react";
import { KeyboardEvent, useEffect, useRef, useState } from "react";
import { Controller, useForm } from "react-hook-form";

import { ToolName } from "../../shared/tools.ts";
import {
  BackgroundMessages,
  BackgroundTasks,
  ChatMessage,
  ResponseStatus,
  WebMCPToolSummary,
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

  const [activeTools, setActiveTools] = useState<ToolName[]>();
  const [toolsLoaded, setToolsLoaded] = useState<boolean>(false);
  const [pageTools, setPageTools] = useState<WebMCPToolSummary[]>([]);
  const [pageToolsTabId, setPageToolsTabId] = useState<number | null>(null);

  const inputValue = watch("input");

  useEffect(() => {
    chrome.storage.local.get(["activeTools"], (result) => {
      if (result.activeTools && Array.isArray(result.activeTools)) {
        setActiveTools(result.activeTools as ToolName[]);
      }
      setToolsLoaded(true);
    });
  }, []);

  useEffect(() => {
    if (toolsLoaded) {
      chrome.storage.local.set({ activeTools });
    }
  }, [activeTools, toolsLoaded]);

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
    chrome.runtime.sendMessage(
      {
        type: BackgroundTasks.AGENT_GET_MESSAGES,
      },
      (resp) => {
        setMessages(resp.messages);
      }
    );

    chrome.runtime.sendMessage({
      type: BackgroundTasks.AGENT_CLEAR,
    });

    chrome.runtime.onMessage.addListener((message) => {
      if (message.type === BackgroundMessages.MESSAGES_UPDATE) {
        setMessages(message.messages);
      }
      if (message.type === BackgroundMessages.WEBMCP_TOOLS_UPDATED) {
        setPageTools(message.tools ?? []);
        setPageToolsTabId(
          typeof message.tabId === "number" ? message.tabId : null
        );
      }
    });

    chrome.runtime.sendMessage(
      { type: BackgroundTasks.WEBMCP_GET_TOOLS_FOR_ACTIVE_TAB },
      (
        resp:
          | { tools?: WebMCPToolSummary[]; tabId?: number | null }
          | undefined
      ) => {
        if (resp?.tools) setPageTools(resp.tools);
        if (typeof resp?.tabId === "number") setPageToolsTabId(resp.tabId);
      }
    );
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
        tabId: pageToolsTabId,
      },
      (resp) => {
        if (resp.status === ResponseStatus.ERROR) {
          alert(resp.error);
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
            pageTools={pageTools}
            onClose={() => setToolsOpen(false)}
            onSubmit={(tools: ToolName[]) => {
              setActiveTools(tools);
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
            disabled={isLoading || showCommands}
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
