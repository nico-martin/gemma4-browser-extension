import { useEffect, useState } from "react";
import { ChatInput } from "./ChatInput";
import { BackgroundTasks, SidebarMessages } from "@/shared/messages";
import type { AgentRunChunk, ChatMessage, Source } from "@/shared/types";

export function Chat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [draft, setDraft] = useState("");
  const [draftSources, setDraftSources] = useState<Source[]>([]);

  useEffect(() => {
    const listener = (msg: { type: string; payload?: unknown }) => {
      if (msg.type === SidebarMessages.AGENT_CHUNK) {
        const chunk = msg.payload as AgentRunChunk;
        if (chunk.content) setDraft((d) => d + chunk.content);
        if (chunk.sources) setDraftSources((s) => [...s, ...chunk.sources!]);
      }
      if (msg.type === SidebarMessages.AGENT_DONE) {
        const result = msg.payload as { text: string; sources: Source[] };
        setMessages((m) => [
          ...m,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            content: result.text,
            sources: result.sources,
            createdAt: Date.now(),
          },
        ]);
        setDraft("");
        setDraftSources([]);
        setStreaming(false);
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  const send = async (content: string, includePageContext: boolean) => {
    setMessages((m) => [
      ...m,
      { id: crypto.randomUUID(), role: "user", content, createdAt: Date.now() },
    ]);
    setStreaming(true);
    await chrome.runtime.sendMessage({
      type: BackgroundTasks.AGENT_SEND_MESSAGE,
      payload: { content, includePageContext },
    });
  };

  const stop = () => {
    void chrome.runtime.sendMessage({ type: BackgroundTasks.AGENT_ABORT });
    setStreaming(false);
  };

  return (
    <section className="flex flex-1 flex-col overflow-hidden">
      <div className="flex-1 space-y-3 overflow-y-auto px-3 py-3 text-sm">
        {messages.map((m) => (
          <Bubble key={m.id} message={m} />
        ))}
        {streaming && draft && (
          <Bubble
            message={{
              id: "draft",
              role: "assistant",
              content: draft,
              sources: draftSources,
              createdAt: Date.now(),
            }}
            pending
          />
        )}
      </div>
      <ChatInput onSend={send} onStop={stop} streaming={streaming} />
    </section>
  );
}

function Bubble({ message, pending }: { message: ChatMessage; pending?: boolean }) {
  const isUser = message.role === "user";
  return (
    <div className={isUser ? "flex justify-end" : "flex justify-start"}>
      <div
        className={
          "max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 " +
          (isUser
            ? "bg-neutral-900 text-white"
            : "bg-neutral-100 text-neutral-900 " + (pending ? "animate-pulse" : ""))
        }
      >
        {message.content}
        {message.sources && message.sources.length > 0 && (
          <ul className="mt-2 list-disc pl-4 text-xs text-neutral-500">
            {message.sources.map((s, i) => (
              <li key={i}>
                {s.url ? (
                  <a href={s.url} target="_blank" rel="noreferrer" className="underline">
                    {s.title ?? s.url}
                  </a>
                ) : (
                  s.title
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
