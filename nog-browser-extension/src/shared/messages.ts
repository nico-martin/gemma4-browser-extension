export const BackgroundTasks = {
  AGENT_SEND_MESSAGE: "AGENT_SEND_MESSAGE",
  AGENT_GET_HISTORY: "AGENT_GET_HISTORY",
  AGENT_CLEAR: "AGENT_CLEAR",
  AGENT_ABORT: "AGENT_ABORT",
  AUTH_SIGN_IN: "AUTH_SIGN_IN",
  AUTH_SIGN_OUT: "AUTH_SIGN_OUT",
  AUTH_GET_PROFILE: "AUTH_GET_PROFILE",
  TOOL_INVOKE: "TOOL_INVOKE",
} as const;

export const ContentTasks = {
  EXTRACT_PAGE: "EXTRACT_PAGE",
  HIGHLIGHT_ELEMENT: "HIGHLIGHT_ELEMENT",
  CLEAR_HIGHLIGHTS: "CLEAR_HIGHLIGHTS",
} as const;

export const SidebarMessages = {
  AGENT_CHUNK: "AGENT_CHUNK",
  AGENT_DONE: "AGENT_DONE",
  AGENT_ERROR: "AGENT_ERROR",
  HISTORY_UPDATE: "HISTORY_UPDATE",
} as const;

export type BackgroundTaskName = keyof typeof BackgroundTasks;
export type ContentTaskName = keyof typeof ContentTasks;
export type SidebarMessageName = keyof typeof SidebarMessages;
