import { ModelRegistry } from "@huggingface/transformers";

import { MODELS, REQUIRED_MODEL_IDS } from "../shared/constants.ts";
import { AvailableTools } from "../shared/tools.ts";
import {
  BackgroundMessages,
  BackgroundTasks,
  ResponseStatus,
  WebMCPToolSummary,
} from "../shared/types.ts";
import Agent from "./agent/Agent.ts";
import { WebMCPTool } from "./agent/webMcp.tsx";
import {
  createAskWebsiteTool,
  highlightWebsiteElementTool,
} from "./tools/askWebsite.ts";
//import { googleSearchTool } from "./tools/search.ts";
import {
  closeTabTool,
  getOpenTabsTool,
  goToTabTool,
  openUrlTool,
} from "./tools/tabActions.ts";
import FeatureExtractor from "./utils/FeatureExtractor.ts";
import VectorHistory from "./vectorHistory/VectorHistory.ts";

import Tab = chrome.tabs.Tab;

let lastProgress: number = 0;
const onModelDownloadProgress = (modelId: string, percentage: number) => {
  const rounded = Math.round(percentage * 100) / 100;
  if (rounded === lastProgress) return;
  lastProgress = rounded;

  chrome.runtime.sendMessage({
    type: BackgroundMessages.DOWNLOAD_PROGRESS,
    modelId,
    percentage: rounded,
  });
};

const featureExtractor = new FeatureExtractor();
const vectorHistory = new VectorHistory(featureExtractor);
let currentAgent: Agent | null = null;

// Tools registered by each tab's page via the WebMCP polyfill.
const webmcpToolsByTab: Map<number, WebMCPToolSummary[]> = new Map();

const MAX_TOOL_NAME_LENGTH = 64;
const MAX_TOOL_DESCRIPTION_LENGTH = 512;
const VALID_TOOL_NAME = /^[A-Za-z0-9_-]+$/;

// Tool metadata is page-controlled and flows verbatim into the LLM prompt.
// We can't fully sandbox prompt content, but we cap length and reject obvious
// shenanigans (control chars, oversized strings, missing/invalid names).
const sanitizeWebMCPTools = (raw: unknown): WebMCPToolSummary[] => {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry): WebMCPToolSummary | null => {
      if (!entry || typeof entry !== "object") return null;
      const e = entry as Record<string, unknown>;

      const name =
        typeof e.name === "string" ? e.name.trim() : "";
      if (
        !name ||
        name.length > MAX_TOOL_NAME_LENGTH ||
        !VALID_TOOL_NAME.test(name)
      ) {
        return null;
      }

      const rawDescription =
        typeof e.description === "string" ? e.description : "";
      const description = rawDescription
        // Strip control chars (incl. NUL) so they can't terminate strings or
        // break the chat template.
        // eslint-disable-next-line no-control-regex
        .replace(/[\u0000-\u001F\u007F]/g, " ")
        .slice(0, MAX_TOOL_DESCRIPTION_LENGTH);

      const inputSchema =
        e.inputSchema && typeof e.inputSchema === "object"
          ? (e.inputSchema as Record<string, unknown>)
          : { type: "object", properties: {}, required: [] };

      return { name, description, inputSchema };
    })
    .filter((t): t is WebMCPToolSummary => t !== null);
};

const getActiveTabId = async (): Promise<number | null> => {
  const [tab] = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true,
  });
  return tab?.id ?? null;
};

const buildPageWebMCPTools = (
  tabId: number,
  summaries: WebMCPToolSummary[]
): WebMCPTool[] =>
  summaries.map((summary) => ({
    name: summary.name,
    description: summary.description,
    inputSchema: (summary.inputSchema as any) ?? {
      type: "object",
      properties: {},
      required: [],
    },
    bypassValidation: true,
    execute: async (args: Record<string, any>) => {
      try {
        const response: any = await chrome.tabs.sendMessage(tabId, {
          type: "webmcp:call",
          name: summary.name,
          args,
        });
        if (!response) {
          return `Error: no response from page for tool '${summary.name}'`;
        }
        if (response.ok) {
          const result = response.result;
          if (typeof result === "string") return result;
          try {
            return JSON.stringify(result);
          } catch {
            return String(result);
          }
        }
        return `Error: ${response.error ?? "unknown error"}`;
      } catch (error) {
        return `Error calling page tool '${summary.name}': ${error instanceof Error ? error.message : String(error)}`;
      }
    },
  }));

const broadcastActiveTabTools = async () => {
  const tabId = await getActiveTabId();
  const tools = tabId !== null ? (webmcpToolsByTab.get(tabId) ?? []) : [];
  chrome.runtime.sendMessage({
    type: BackgroundMessages.WEBMCP_TOOLS_UPDATED,
    tools,
    tabId,
  });
};

const availableTools: Record<string, () => any> = {
  [AvailableTools.GET_OPEN_TABS]: () => getOpenTabsTool,
  [AvailableTools.GO_TO_TAB]: () => goToTabTool,
  [AvailableTools.OPEN_URL]: () => openUrlTool,
  [AvailableTools.CLOSE_TAB]: () => closeTabTool,
  [AvailableTools.FIND_HISTORY]: () => vectorHistory.findHistoryTool,
  [AvailableTools.ASK_WEBSITE]: () => createAskWebsiteTool(featureExtractor),
  [AvailableTools.HIGHLIGHT_WEBSITE_ELEMENT]: () => highlightWebsiteElementTool,
  //[AvailableTools.GOOGLE_SEARCH]: () => googleSearchTool,
};

const createAgent = (toolNames?: string[]): Agent => {
  const agent = new Agent();

  const toolsToRegister = toolNames || Object.keys(availableTools);

  for (const toolName of toolsToRegister) {
    const toolFactory = availableTools[toolName];
    if (toolFactory) {
      agent.setTool(toolFactory());
    } else {
      console.warn(`[Agent] Unknown tool requested: ${toolName}`);
    }
  }

  agent.onChatMessageUpdate((messages) =>
    chrome.runtime.sendMessage({
      type: BackgroundMessages.MESSAGES_UPDATE,
      messages,
    })
  );

  return agent;
};

const getAgent = (): Agent => {
  if (!currentAgent) {
    currentAgent = createAgent();
  }
  return currentAgent;
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "webmcp:tools") {
    const tabId = sender.tab?.id;
    if (typeof tabId === "number") {
      webmcpToolsByTab.set(tabId, sanitizeWebMCPTools(message.tools));
      void broadcastActiveTabTools();
    }
    sendResponse({ ok: true });
    return false;
  }

  if (message?.type === BackgroundTasks.WEBMCP_GET_TOOLS_FOR_ACTIVE_TAB) {
    getActiveTabId().then((tabId) => {
      const tools = tabId !== null ? (webmcpToolsByTab.get(tabId) ?? []) : [];
      sendResponse({ status: ResponseStatus.SUCCESS, tools, tabId });
    });
    return true;
  }

  if (message.type === BackgroundTasks.CHECK_MODELS) {
    Promise.all(
      REQUIRED_MODEL_IDS.map(async (modelId) => {
        const model = Object.values(MODELS).find((m) => m.modelId === modelId);
        const files = await ModelRegistry.get_pipeline_files(
          model.task,
          modelId,
          {
            dtype: model.dtype,
          }
        );
        const metas = await Promise.all(
          files.map((file) => ModelRegistry.get_file_metadata(modelId, file))
        );
        const downloadSize = metas.reduce(
          (total, item) => total + (item.size ?? 0),
          0
        );
        const isCached = await ModelRegistry.is_pipeline_cached(
          model.task,
          modelId,
          {
            dtype: model.dtype,
          }
        );
        return {
          size: downloadSize,
          cached: isCached,
          modelId,
        };
      })
    )
      .then((results) => {
        sendResponse({ status: ResponseStatus.SUCCESS, results });
      })
      .catch((error: Error) => {
        console.error("CHECK_MODELS failed:", error);
        sendResponse({ status: ResponseStatus.ERROR, error: error.message });
      });
    return true;
  }

  if (message.type === BackgroundTasks.INITIALIZE_MODELS) {
    const agent = getAgent();
    Promise.all([
      featureExtractor.getFeatureExtractionPipeline(onModelDownloadProgress),
      agent.getTextGenerationPipeline(onModelDownloadProgress),
    ])
      .then(() => {
        sendResponse({ status: ResponseStatus.SUCCESS });
      })
      .catch((error: Error) => {
        console.error("INITIALIZE_MODELS failed:", error);
        sendResponse({ status: ResponseStatus.ERROR, error: error.message });
      });

    return true;
  }

  if (message.type === BackgroundTasks.AGENT_INITIALIZE) {
    const tools = message.tools as string[] | undefined;
    currentAgent = createAgent(tools);
    sendResponse({ status: ResponseStatus.SUCCESS });
    chrome.runtime.sendMessage({
      type: BackgroundMessages.MESSAGES_UPDATE,
      messages: [],
    });
    return true;
  }

  if (message.type === BackgroundTasks.AGENT_GENERATE_TEXT) {
    const agent = getAgent();
    (async () => {
      try {
        // Prefer the tabId the sidebar tells us — it's the tab whose tools
        // the user can actually see. Fall back to lastFocusedWindow lookup
        // only if the sidebar didn't provide one (older message format).
        const requestedTabId =
          typeof message.tabId === "number" ? message.tabId : null;
        const tabId = requestedTabId ?? (await getActiveTabId());
        const summaries =
          tabId !== null ? (webmcpToolsByTab.get(tabId) ?? []) : [];
        agent.setPageTools(
          tabId !== null ? buildPageWebMCPTools(tabId, summaries) : []
        );
        const metrics = await agent.runAgent(message.prompt);
        sendResponse({ status: ResponseStatus.SUCCESS, metrics });
      } catch (error: any) {
        console.error("GENERATE_TEXT failed:", error);
        sendResponse({ status: ResponseStatus.ERROR, error: error.message });
      }
    })();

    return true;
  }

  if (message.type === BackgroundTasks.AGENT_GET_MESSAGES) {
    const agent = getAgent();
    sendResponse({
      status: ResponseStatus.SUCCESS,
      messages: agent.chatMessages,
    });
    return true;
  }

  if (message.type === BackgroundTasks.AGENT_CLEAR) {
    const agent = getAgent();
    agent.clear();
    sendResponse({ status: ResponseStatus.SUCCESS });
    return true;
  }

  if (message.type === BackgroundTasks.EXTRACT_FEATURES) {
    featureExtractor
      .extractFeatures([message.text])
      .then((result) => {
        sendResponse({ status: ResponseStatus.SUCCESS, result: result[0] });
      })
      .catch((error) => {
        console.error("EXTRACT_FEATURES failed:", error);
        sendResponse({ status: ResponseStatus.ERROR, error: error.message });
      });

    return true;
  }

  return false;
});

chrome.action.onClicked.addListener(async (tab) => {
  if (tab.id) {
    await chrome.sidePanel.open({ tabId: tab.id });
  }
});

const addCurrentPageToVectorHistory = async (tabId: number, tab: Tab) => {
  const title = tab.title || "Untitled";
  let description = "";

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const metaDescription = document.querySelector(
          'meta[name="description"]'
        );
        return metaDescription?.getAttribute("content") || "";
      },
    });
    description = results[0]?.result || "";
  } catch (error) {
    console.error(`Could not extract description from tab ${tabId}:`, error);
  }

  if (!description) {
    description = tab.url || "";
  }

  // Add to vector history
  try {
    await vectorHistory.addEntry(title, description, tab.url);
  } catch (error) {
    console.error("Failed to add page to vector history:", error);
  }
};

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === "loading") {
    // Page is navigating; clear stale tools until the new page registers them.
    if (webmcpToolsByTab.has(tabId)) {
      webmcpToolsByTab.delete(tabId);
      void broadcastActiveTabTools();
    }
  }

  if (changeInfo.status !== "complete") return;
  if (!tab.url?.startsWith("http")) return;

  // Add page to vector history for later retrieval
  addCurrentPageToVectorHistory(tabId, tab);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (webmcpToolsByTab.delete(tabId)) {
    void broadcastActiveTabTools();
  }
});

chrome.tabs.onActivated.addListener(() => {
  void broadcastActiveTabTools();
});
