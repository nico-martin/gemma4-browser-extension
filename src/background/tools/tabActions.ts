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
    try {
      const tabs = await chrome.tabs.query({});

      const tabInfoPromises = tabs.map(async (tab) => {
        let description = null;

        if (tab.id && tab.url?.startsWith("http")) {
          try {
            const results = await chrome.scripting.executeScript({
              target: { tabId: tab.id },
              func: () => {
                const metaDescription = document.querySelector(
                  'meta[name="description"]'
                );
                return metaDescription?.getAttribute("content") || null;
              },
            });
            description = results[0]?.result || null;
          } catch (error) {
            console.warn("[tool:get_open_tabs] description fetch failed", {
              tabId: tab.id,
              url: tab.url,
              error,
            });
            description = null;
          }
        }

        return {
          id: tab.id,
          title: tab.title,
          url: tab.url,
          description,
          active: tab.active,
          windowId: tab.windowId,
          index: tab.index,
        };
      });

      const tabInfo = await Promise.all(tabInfoPromises);
      return JSON.stringify(tabInfo, null, 2);
    } catch (error) {
      console.error("[tool:get_open_tabs] failed", error);
      return `Error getting tabs: ${error.toString()}`;
    }
  },
};

export const goToTabTool: WebMCPTool = {
  name: "go_to_tab",
  description:
    "Navigate to a specific browser tab by its ID and bring it to focus. The tab ID must be a valid integer.",
  inputSchema: {
    type: "object",
    properties: {
      tabId: {
        type: "number",
        description: "The ID of the tab to navigate to (must be a valid tab ID from get_open_tabs)",
      },
    },
    required: ["tabId"],
  },
  execute: async (args) => {
    const tabIdRaw = args.tabId;
    const tabId = typeof tabIdRaw === "string" ? parseInt(tabIdRaw, 10) : (tabIdRaw as number);

    if (!Number.isInteger(tabId)) {
      return `Error: tabId must be a valid integer. Received: ${tabIdRaw}`;
    }

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
      const parsed = new URL(url);
      if (!["https:", "http:"].includes(parsed.protocol)) {
        return `Error: URL scheme "${parsed.protocol}" is not allowed. Only http and https are permitted.`;
      }
    } catch {
      return `Error: Invalid URL: ${url}`;
    }

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
        description: "The ID of the tab to close (must be a valid tab ID from get_open_tabs)",
      },
    },
    required: ["tabId"],
  },
  execute: async (args) => {
    const tabIdRaw = args.tabId;
    const tabId = typeof tabIdRaw === "string" ? parseInt(tabIdRaw, 10) : (tabIdRaw as number);

    if (!Number.isInteger(tabId)) {
      return `Error: tabId must be a valid integer. Received: ${tabIdRaw}`;
    }

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
