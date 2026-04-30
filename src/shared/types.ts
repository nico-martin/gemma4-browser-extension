export enum ResponseStatus {
  SUCCESS,
  ERROR,
  STARTED,
}

export enum BackgroundTasks {
  EXTRACT_FEATURES,
  CHECK_MODELS,
  INITIALIZE_MODELS,
  AGENT_INITIALIZE,
  AGENT_GENERATE_TEXT,
  AGENT_GET_MESSAGES,
  AGENT_CLEAR,
  WEBMCP_GET_TOOLS_FOR_ACTIVE_TAB,
}

export enum BackgroundMessages {
  MODEL_CHECK,
  DOWNLOAD_PROGRESS,
  MESSAGES_UPDATE,
  WEBMCP_TOOLS_UPDATED,
}

export interface WebMCPToolSummary {
  name: string;
  description: string;
  inputSchema?: Record<string, any>;
}

export enum ContentTasks {
  EXTRACT_PAGE_DATA,
  HIGHLIGHT_ELEMENTS,
  CLEAR_HIGHLIGHTS,
}

export type Dtype = "fp32" | "fp16" | "q4" | "q4f16";

export interface ChatMessageUser {
  role: "user";
  content: string;
}

export interface ChatMessageTool {
  name: string;
  functionSignature: string;
  id: string;
  result: string;
}

export interface AgentMetrics {
  generatedTokens: number;
  prefillTokens: number;
  prefillMs: number;
  prefillTokensPerSecond: number;
  decodeMs: number;
  totalMs: number;
  tokensPerSecond: number;
  msPerToken: number;
}

export interface ChatMessageAssistant {
  role: "assistant";
  content: string;
  tools: Array<ChatMessageTool>;
  metrics: AgentMetrics;
}

export type ChatMessage = ChatMessageUser | ChatMessageAssistant;

export interface WebsitePart {
  tagName: string;
  paragraphId: number;
  sectionId: number;
  id: string;
  content: string;
  sentences: string[];
  embeddings?: number[][];
}
