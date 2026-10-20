export const AvailableTools = {
  GET_OPEN_TABS: "get_open_tabs",
  GO_TO_TAB: "go_to_tab",
  OPEN_URL: "open_url",
  CLOSE_TAB: "close_tab",
  FIND_HISTORY: "find_history",
  ASK_WEBSITE: "ask_website",
  HIGHLIGHT_WEBSITE_ELEMENT: "highlight_website_element",
  WEB_SEARCH: "web_search",
  WEB_FETCH: "web_fetch",
} as const;

export type ToolName = (typeof AvailableTools)[keyof typeof AvailableTools];

export const isRemoteTool = (name: string): boolean =>
  name === AvailableTools.WEB_SEARCH || name === AvailableTools.WEB_FETCH;

export const resolveActiveTools = (
  saved?: string[],
  allowRemoteSearch = false
): ToolName[] => {
  const available: string[] = Object.values(AvailableTools);
  // An explicitly empty list disables every tool. Missing settings use defaults.
  return [...new Set(saved ?? available)].filter(
    (name): name is ToolName =>
      available.includes(name) && (allowRemoteSearch || !isRemoteTool(name))
  );
};
