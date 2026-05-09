import type { AgentRunChunk, Source, UserProfile } from "./types";
import { acquireApiToken } from "./auth/msalConfig";

const API_BASE_URL =
  (import.meta.env.VITE_API_BASE_URL as string) ?? "https://api.nogverse.ai";

const DEFAULT_TIMEOUT_MS = 30_000;

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

interface RequestOptions extends Omit<RequestInit, "body"> {
  body?: unknown;
  timeoutMs?: number;
  skipAuth?: boolean;
  retryOn401?: boolean;
}

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { body, timeoutMs = DEFAULT_TIMEOUT_MS, skipAuth, retryOn401 = true, headers, ...rest } = opts;

  const doFetch = async (force: boolean): Promise<Response> => {
    const h = new Headers(headers);
    if (body !== undefined && !h.has("Content-Type")) h.set("Content-Type", "application/json");
    if (!skipAuth) {
      const token = await acquireApiToken({ forceRefresh: force });
      h.set("Authorization", `Bearer ${token}`);
    }
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      return await fetch(`${API_BASE_URL}${path}`, {
        ...rest,
        headers: h,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: rest.signal ?? ctrl.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  };

  let res = await doFetch(false);
  if (res.status === 401 && retryOn401 && !skipAuth) {
    res = await doFetch(true);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new ApiError(res.status, res.statusText, text || `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

export interface CreateConversationResponse {
  id: string;
  title?: string;
}

export async function createConversation(opts: { title?: string } = {}): Promise<CreateConversationResponse> {
  return request<CreateConversationResponse>("/api/conversations", {
    method: "POST",
    body: { title: opts.title ?? "NOG extension session" },
  });
}

export async function getProfile(): Promise<UserProfile> {
  return request<UserProfile>("/api/users", { method: "GET" });
}

export interface StreamMessageParams {
  conversationId: string;
  content: string;
  agentId?: string;
  signal?: AbortSignal;
  onChunk: (chunk: AgentRunChunk) => void;
}

export interface StreamMessageResult {
  text: string;
  sources: Source[];
}

/**
 * POST /api/messages with role:"user" — consumes the SSE stream returned by
 * the FastAPI StreamingResponse. Mirrors nogverse-ui-v1/src/features/chat/hooks/useChatStream.ts.
 */
export async function streamMessage(params: StreamMessageParams): Promise<StreamMessageResult> {
  const { conversationId, content, agentId, signal, onChunk } = params;
  const token = await acquireApiToken();

  const doFetch = (auth: string) =>
    fetch(`${API_BASE_URL}/api/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${auth}`,
        Accept: "text/event-stream",
      },
      body: JSON.stringify({ conversationId, content, role: "user", agentId }),
      signal,
    });

  let response = await doFetch(token);
  if (response.status === 401) {
    const fresh = await acquireApiToken({ forceRefresh: true });
    response = await doFetch(fresh);
  }
  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => "");
    throw new ApiError(response.status, response.statusText, text || "stream failed");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  const sources: Source[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const raw of lines) {
      const line = raw.trim();
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      try {
        const chunk = JSON.parse(data) as AgentRunChunk;
        onChunk(chunk);
        if (chunk.content) text += chunk.content;
        if (chunk.sources) sources.push(...chunk.sources);
      } catch {
        // Tolerate malformed lines (heartbeats, comments).
      }
    }
  }
  return { text, sources };
}
