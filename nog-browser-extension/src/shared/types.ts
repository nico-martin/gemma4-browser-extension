export type ToolName =
  | "open_url"
  | "ask_website"
  | "close_tab"
  | "get_open_tabs"
  | "go_to_tab"
  | "get_current_tab_info"
  | "search_legifrance"
  | "search_canlii";

export interface ToolCall {
  name: ToolName;
  args: Record<string, unknown>;
}

export interface ToolResult {
  ok: boolean;
  content: string;
  error?: string;
}

export interface Source {
  id?: string;
  title?: string;
  url?: string;
  snippet?: string;
}

export interface AgentRunChunk {
  step?: "tool_start" | "tool_end" | "content" | "sources" | "done" | string;
  tool?: string;
  content?: string;
  sources?: Source[];
  artifact?: unknown;
  runId?: string;
  done?: boolean;
  error?: string;
}

export interface UserProfile {
  userId: string;
  tenantId: string;
  email?: string;
  name?: string;
  role?: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  sources?: Source[];
  createdAt: number;
}

export interface TabInfo {
  id: number;
  title: string;
  url: string;
  active: boolean;
  hostname?: string;
}
