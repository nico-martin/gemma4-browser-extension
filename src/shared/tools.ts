export const AvailableTools = {
  GET_OPEN_TABS: "get_open_tabs",
  GO_TO_TAB: "go_to_tab",
  OPEN_URL: "open_url",
  CLOSE_TAB: "close_tab",
  FIND_HISTORY: "find_history",
  ASK_WEBSITE: "ask_website",
  HIGHLIGHT_WEBSITE_ELEMENT: "highlight_website_element",
  // GOOGLE_SEARCH: "google_search", // Commented out - not implemented yet
} as const;

export type ToolName = (typeof AvailableTools)[keyof typeof AvailableTools];

export const toolMetadata: Record<
  ToolName,
  { label: string; description: string }
> = {
  [AvailableTools.GET_OPEN_TABS]: {
    label: "Get Open Tabs",
    description: "List all currently open browser tabs",
  },
  [AvailableTools.GO_TO_TAB]: {
    label: "Go to Tab",
    description: "Navigate to a specific tab",
  },
  [AvailableTools.OPEN_URL]: {
    label: "Open URL",
    description: "Open a new URL in a tab",
  },
  [AvailableTools.CLOSE_TAB]: {
    label: "Close Tab",
    description: "Close a specific tab",
  },
  [AvailableTools.FIND_HISTORY]: {
    label: "Find History",
    description: "Search browsing history with semantic search",
  },
  [AvailableTools.ASK_WEBSITE]: {
    label: "Ask Website",
    description: "Extract and analyze website content",
  },
  [AvailableTools.HIGHLIGHT_WEBSITE_ELEMENT]: {
    label: "Highlight Website Element",
    description: "Highlight elements on a webpage",
  },
};

export const getToolLabel = (name: string): string =>
  toolMetadata[name as ToolName]?.label ?? name;
