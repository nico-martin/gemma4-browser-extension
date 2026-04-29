import { WebMCPTool } from "../agent/webMcp.tsx";

export const getOpenTabsTool: WebMCPTool = {
  name: "get_open_tabs",
  description:
    "Get information about all open browser tabs including their title, URL, description, and active status",
  inputSchema: {
    type: "object",
    properties: {},
    required: [],
  },
  execute: async () => {
    const MAX_TABS = 25; // Limit to avoid blowing up the context window
    const MAX_TITLE = 60;
    const MAX_URL = 120;

    try {
      const allTabs = await chrome.tabs.query({});

      // Prioritise: active tabs first, then most recent, capped
      const sorted = allTabs
        .sort((a, b) => {
          if (a.active !== b.active) return a.active ? -1 : 1;
          return (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0);
        })
        .slice(0, MAX_TABS);

      const tabInfo = sorted.map((tab) => {
        const title =
          tab.title && tab.title.length > MAX_TITLE
            ? tab.title.slice(0, MAX_TITLE) + "…"
            : tab.title;
        const url =
          tab.url && tab.url.length > MAX_URL
            ? tab.url.slice(0, MAX_URL) + "…"
            : tab.url;
        return { id: tab.id, title, url, active: tab.active };
      });

      let result = JSON.stringify(tabInfo);
      if (allTabs.length > MAX_TABS) {
        result += `\n(Showing ${MAX_TABS} of ${allTabs.length} tabs)`;
      }
      return result;
    } catch (error) {
      console.error("[tool:get_open_tabs] failed", error);
      return `Error getting tabs: ${error.toString()}`;
    }
  },
};

export const goToTabTool: WebMCPTool = {
  name: "go_to_tab",
  description:
    "Navigate to a specific browser tab by its ID and bring it to focus",
  inputSchema: {
    type: "object",
    properties: {
      tabId: {
        type: "number",
        description: "The ID of the tab to navigate to",
      },
    },
    required: ["tabId"],
  },
  execute: async (args) => {
    const tabId = args.tabId as number;
    try {
      const tab = await chrome.tabs.get(tabId);
      await chrome.windows.update(tab.windowId, { focused: true });
      await chrome.tabs.update(tabId, { active: true });

      return `Successfully navigated to tab ${tabId}: "${tab.title}"`;
    } catch (error) {
      return `Error navigating to tab ${tabId}: ${error.toString()}`;
    }
  },
};

export const openUrlTool: WebMCPTool = {
  name: "open_url",
  description: "Open a specified URL in a new browser tab",
  inputSchema: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description: "The URL to open in the new tab",
      },
      active: {
        type: "boolean",
        description: "Whether the new tab should become active (default: true)",
        default: true,
      },
    },
    required: ["url"],
  },
  execute: async (args) => {
    const url = args.url as string;
    const active = args.active !== undefined ? (args.active as boolean) : true;

    try {
      const tab = await chrome.tabs.create({
        url,
        active,
      });

      return `Successfully created new tab ${tab.id}: "${tab.title || url}" at ${tab.url}`;
    } catch (error) {
      return `Error creating tab: ${error.toString()}`;
    }
  },
};

export const closeTabTool: WebMCPTool = {
  name: "close_tab",
  description: "Close a specific browser tab by its ID",
  inputSchema: {
    type: "object",
    properties: {
      tabId: {
        type: "number",
        description: "The ID of the tab to close",
      },
    },
    required: ["tabId"],
  },
  execute: async (args) => {
    const tabId = args.tabId as number;

    try {
      // Get tab info before closing for better feedback
      const tab = await chrome.tabs.get(tabId);
      await chrome.tabs.remove(tabId);

      return `Successfully closed tab ${tabId}: "${tab.title}"`;
    } catch (error) {
      return `Error closing tab ${tabId}: ${error.toString()}`;
    }
  },
};
