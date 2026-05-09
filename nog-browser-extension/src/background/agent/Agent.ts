import type { AgentRunChunk, ChatMessage, Source } from "@/shared/types";
import {
  createConversation,
  streamMessage,
} from "@/shared/nogverseClient";
import { getCurrentTabInfo } from "@/background/tools/getCurrentTabInfo";
import { askWebsite } from "@/background/tools/askWebsite";

/**
 * Thin orchestrator. The real agent loop runs server-side (nogverse-api-business
 * src/services/agent_executor.py); the extension only:
 *   1. enriches the user prompt with current-tab context (lightweight),
 *   2. POSTs /api/messages and streams the SSE response,
 *   3. forwards each chunk to the side panel.
 */
export class Agent {
  private conversationId: string | null = null;
  private history: ChatMessage[] = [];
  private inflight: AbortController | null = null;

  getHistory(): ChatMessage[] {
    return this.history;
  }

  clear(): void {
    this.conversationId = null;
    this.history = [];
    this.inflight?.abort();
    this.inflight = null;
  }

  abort(): void {
    this.inflight?.abort();
    this.inflight = null;
  }

  async send(
    userContent: string,
    onChunk: (c: AgentRunChunk) => void,
    opts: { agentId?: string; includePageContext?: boolean } = {},
  ): Promise<{ text: string; sources: Source[] }> {
    if (!this.conversationId) {
      const conv = await createConversation();
      this.conversationId = conv.id;
    }

    const enriched = opts.includePageContext
      ? await prependPageContext(userContent)
      : userContent;

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: userContent,
      createdAt: Date.now(),
    };
    this.history.push(userMsg);

    this.inflight = new AbortController();
    const result = await streamMessage({
      conversationId: this.conversationId,
      content: enriched,
      agentId: opts.agentId,
      signal: this.inflight.signal,
      onChunk,
    });
    this.inflight = null;

    this.history.push({
      id: crypto.randomUUID(),
      role: "assistant",
      content: result.text,
      sources: result.sources,
      createdAt: Date.now(),
    });
    return result;
  }
}

async function prependPageContext(userContent: string): Promise<string> {
  const info = await getCurrentTabInfo();
  const page = await askWebsite({ query: userContent });
  const ctxParts: string[] = [];
  if (info.ok) ctxParts.push(`# Active tab\n${info.content}`);
  if (page.ok) ctxParts.push(`# Page excerpt\n${page.content}`);
  if (ctxParts.length === 0) return userContent;
  return `${ctxParts.join("\n\n")}\n\n# User question\n${userContent}`;
}

export const agent = new Agent();
