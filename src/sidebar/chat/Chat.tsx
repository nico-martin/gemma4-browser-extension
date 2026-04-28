import {
  KeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Controller, useForm } from "react-hook-form";

import {
  BackgroundMessages,
  BackgroundTasks,
  ChatMessage,
  ResponseStatus,
  ToolPermissionDecision,
} from "../../shared/types.ts";
import cn from "../utils/classnames.ts";
import ChatCommands, { ChatCommandsRef, Command } from "./ChatCommands.tsx";
import ChatToolsModal from "./ChatToolsModal.tsx";
import CopyButton from "./CopyButton.tsx";
import MessageContent from "./MessageContent.tsx";

const MAX_INPUT_HEIGHT_PX = 200;

interface FormParams {
  input: string;
}

export default function Chat() {
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const commandsRef = useRef<ChatCommandsRef>(null);
  const { control, handleSubmit, reset, setValue, watch } = useForm<FormParams>(
    {
      defaultValues: {
        input: "",
      },
    }
  );
  const [messages, setMessages] = useState<Array<ChatMessage>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [showCommands, setShowCommands] = useState<boolean>(false);
  const [toolsOpen, setToolsOpen] = useState<boolean>(false);

  const inputValue = watch("input");

  const stickToBottomRef = useRef(true);
  const isPointerDownRef = useRef(false);

  const scrollToBottom = () => {
    if (messagesContainerRef.current) {
      messagesContainerRef.current.scrollTop =
        messagesContainerRef.current.scrollHeight;
    }
  };

  const handleScroll = () => {
    const el = messagesContainerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = distanceFromBottom < 40;
  };

  useEffect(() => {
    const onDown = () => {
      isPointerDownRef.current = true;
    };
    const onUp = () => {
      isPointerDownRef.current = false;
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  useEffect(() => {
    if (!stickToBottomRef.current) return;
    if (isPointerDownRef.current) return;
    if (window.getSelection()?.toString()) return;
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
    });
  }, []);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_INPUT_HEIGHT_PX)}px`;
  }, [inputValue]);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    commandsRef.current?.handleKeyDown(e);
    if (e.defaultPrevented) return;
    if (e.key === "Enter" && !e.shiftKey && !showCommands) {
      e.preventDefault();
      handleSubmit(onSubmit)();
    }
  };

  const onSubmit = (data: FormParams) => {
    if (isLoading) return;
    setIsLoading(true);
    stickToBottomRef.current = true;
    reset();

    inputRef.current?.focus();

    chrome.runtime.sendMessage(
      {
        type: BackgroundTasks.AGENT_GENERATE_TEXT,
        prompt: data.input,
      },
      (resp) => {
        if (resp.status === ResponseStatus.ERROR) {
          alert(resp.error);
        }
        setIsLoading(false);
      }
    );
  };

  const onCancel = () => {
    chrome.runtime.sendMessage({
      type: BackgroundTasks.AGENT_CANCEL,
    });
  };

  const onPermissionDecision = useCallback(
    (toolCallId: string, decision: ToolPermissionDecision) => {
      chrome.runtime.sendMessage({
        type: BackgroundTasks.TOOL_PERMISSION_RESPOND,
        toolCallId,
        decision,
      });
    },
    []
  );

  return (
    <div className="flex flex-col h-full">
      <div
        ref={messagesContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-6 py-4 space-y-4"
      >
        {(messages || []).length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-sm text-chrome-text-secondary">
              Start a conversation by typing a message below
            </p>
          </div>
        ) : (
          messages.map((message, index) => {
            const anchor = `--msg-${index}`;
            return (
              <div key={index} className="message-row relative">
                <div
                  className={cn(
                    "message-bubble max-w-[85%] px-4 py-3",
                    message.role === "user"
                      ? "user-message ml-auto bg-chrome-accent-primary text-chrome-bg-primary"
                      : "bg-chrome-bg-secondary"
                  )}
                  style={{ anchorName: anchor } as React.CSSProperties}
                >
                  <div className="text-sm">
                    {message.role === "user" ? (
                      message.content
                    ) : (
                      <MessageContent
                        content={message.content}
                        tools={message.tools}
                        metrics={message.metrics}
                        onPermissionDecision={onPermissionDecision}
                      />
                    )}
                  </div>
                </div>
                <CopyButton
                  text={message.content}
                  align={message.role === "user" ? "left" : "right"}
                  anchor={anchor}
                />
              </div>
            );
          })
        )}
      </div>

      <div className="select-none border-t border-chrome-border px-4 py-3 bg-chrome-bg-secondary relative">
        <ChatCommands
          ref={commandsRef}
          commands={commands}
          inputValue={inputValue}
          isOpen={showCommands}
          onClose={() => setShowCommands(false)}
          onExecute={() => setShowCommands(false)}
        />
        {toolsOpen && <ChatToolsModal onClose={() => setToolsOpen(false)} />}
        <form
          onSubmit={handleSubmit(onSubmit)}
          className="rounded-lg border border-chrome-border bg-chrome-bg-primary focus-within:border-chrome-accent-primary transition-colors"
        >
          <Controller
            name="input"
            control={control}
            render={({ field }) => (
              <textarea
                {...field}
                id="chat-input"
                rows={1}
                placeholder="Type your message or / for commands..."
                onKeyDown={handleKeyDown}
                ref={(e) => {
                  field.ref(e);
                  inputRef.current = e;
                }}
                className="block w-full resize-none bg-transparent px-3 pt-2.5 pb-1 text-sm text-chrome-text-primary placeholder:text-chrome-text-disabled outline-none overflow-y-auto"
                style={{ maxHeight: MAX_INPUT_HEIGHT_PX }}
              />
            )}
          />
          <div className="flex items-center justify-between px-1.5 pb-1.5">
            <button
              type="button"
              onClick={() => setToolsOpen(true)}
              className="group cursor-pointer p-1.5"
              title="Tool permissions"
            >
              <span className="block rounded px-2 py-1 text-xs font-medium text-chrome-text-secondary transition-colors group-hover:bg-chrome-hover group-hover:text-chrome-text-primary">
                Tools
              </span>
            </button>
            {isLoading ? (
              <button
                type="button"
                onClick={onCancel}
                aria-label="Stop generating"
                title="Stop"
                className="group cursor-pointer p-1.5"
              >
                <span className="flex h-7 w-7 items-center justify-center rounded text-chrome-text-secondary transition-colors group-hover:bg-chrome-hover group-hover:text-chrome-text-primary">
                  <span className="block h-2.5 w-2.5 rounded-[2px] bg-current" />
                </span>
              </button>
            ) : (
              <button
                type="submit"
                disabled={showCommands || !inputValue.trim()}
                aria-label="Send"
                title="Send (Enter)"
                className="group cursor-pointer p-1.5 disabled:cursor-not-allowed"
              >
                <span
                  className={cn(
                    "flex h-7 w-7 items-center justify-center rounded text-base leading-none transition-colors",
                    inputValue.trim() && !showCommands
                      ? "text-chrome-accent-primary group-hover:bg-chrome-hover"
                      : "text-chrome-text-disabled"
                  )}
                >
                  ↵
                </span>
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
