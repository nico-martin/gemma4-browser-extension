import { ModelRegistry } from "@huggingface/transformers";

import { MODELS, REQUIRED_MODEL_IDS } from "../shared/constants.ts";
import { AvailableTools, resolveActiveTools } from "../shared/tools.ts";
import {
  BackgroundMessages,
  BackgroundTasks,
  ResponseStatus,
} from "../shared/types.ts";
import Agent from "./agent/Agent.ts";
import {
  createAskWebsiteTool,
  highlightWebsiteElementTool,
} from "./tools/askWebsite.ts";
import { webFetchTool, webSearchTool } from "./tools/parallelSearch.ts";
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

type ToolSettings = { activeTools?: string[]; allowRemoteSearch: boolean };
let toolSettings: ToolSettings = { allowRemoteSearch: false };
const readToolSettings = async (): Promise<ToolSettings> => {
  const saved = await chrome.storage.local.get([
    "activeTools",
    "allowRemoteSearch",
  ]);
  return {
    activeTools: Array.isArray(saved.activeTools)
      ? saved.activeTools.filter(
          (name): name is string => typeof name === "string"
        )
      : undefined,
    allowRemoteSearch: saved.allowRemoteSearch === true,
  };
};
const sameSettings = (left: ToolSettings, right: ToolSettings) =>
  left.allowRemoteSearch === right.allowRemoteSearch &&
  JSON.stringify(left.activeTools) === JSON.stringify(right.activeTools);
let settingsReady = readToolSettings().then((saved) => {
  toolSettings = saved;
});
// Keep failures observable to request handlers without an unhandled startup
// rejection when no sidebar is currently open.
void settingsReady.catch(() => {});

const availableTools: Record<string, () => any> = {
  [AvailableTools.GET_OPEN_TABS]: () => getOpenTabsTool,
  [AvailableTools.GO_TO_TAB]: () => goToTabTool,
  [AvailableTools.OPEN_URL]: () => openUrlTool,
  [AvailableTools.CLOSE_TAB]: () => closeTabTool,
  [AvailableTools.FIND_HISTORY]: () => vectorHistory.findHistoryTool,
  [AvailableTools.ASK_WEBSITE]: () => createAskWebsiteTool(featureExtractor),
  [AvailableTools.HIGHLIGHT_WEBSITE_ELEMENT]: () => highlightWebsiteElementTool,
  [AvailableTools.WEB_SEARCH]: () => webSearchTool,
  [AvailableTools.WEB_FETCH]: () => webFetchTool,
};

const createAgent = (): Agent => {
  const agent = new Agent();

  const toolsToRegister = resolveActiveTools(
    toolSettings.activeTools,
    toolSettings.allowRemoteSearch
  );

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

const waitForSettings = async () => {
  let pending: Promise<void>;
  do {
    pending = settingsReady;
    await pending;
  } while (pending !== settingsReady);
};

const getAgent = async (): Promise<Agent> => {
  await waitForSettings();
  if (!currentAgent) currentAgent = createAgent();
  return currentAgent;
};

const resetAgent = () => {
  // Clear aborts in-flight remote requests before their permission is revoked.
  currentAgent?.clear();
  currentAgent = null;
  void chrome.runtime.sendMessage({
    type: BackgroundMessages.MESSAGES_UPDATE,
    messages: [],
  });
};

chrome.storage.onChanged.addListener((changes, area) => {
  if (
    area !== "local" ||
    !("activeTools" in changes || "allowRemoteSearch" in changes)
  )
    return;

  const next: ToolSettings = {
    activeTools:
      "activeTools" in changes
        ? Array.isArray(changes.activeTools.newValue)
          ? changes.activeTools.newValue.filter(
              (name): name is string => typeof name === "string"
            )
          : undefined
        : toolSettings.activeTools,
    allowRemoteSearch:
      "allowRemoteSearch" in changes
        ? changes.allowRemoteSearch.newValue === true
        : toolSettings.allowRemoteSearch,
  };
  // Our own writes already installed these settings; do not reset twice.
  if (sameSettings(next, toolSettings)) return;
  resetAgent();
  settingsReady = settingsReady
    .catch(() => {})
    .then(async () => {
      const saved = await readToolSettings();
      if (!sameSettings(saved, toolSettings)) {
        resetAgent();
        toolSettings = saved;
      }
    });
  void settingsReady.catch(() => {});
});

const initializeAgent = (message: {
  tools?: unknown;
  allowRemoteSearch?: unknown;
}): Promise<Agent> => {
  const operation = settingsReady
    .catch(async () => {
      // Never recover a failed settings read by reusing stale permission state.
      toolSettings = await readToolSettings();
    })
    .then(async () => {
      const next: ToolSettings = {
        activeTools: Array.isArray(message.tools)
          ? message.tools.filter(
              (name): name is string => typeof name === "string"
            )
          : toolSettings.activeTools,
        // Old callers that omit this field cannot grant remote-search permission.
        allowRemoteSearch:
          typeof message.allowRemoteSearch === "boolean"
            ? message.allowRemoteSearch
            : toolSettings.allowRemoteSearch,
      };
      if (!sameSettings(next, toolSettings)) {
        resetAgent();
        toolSettings = next;
        try {
          // Do not serialize undefined: absence means the default tool selection.
          await chrome.storage.local.set({
            ...(next.activeTools === undefined
              ? {}
              : { activeTools: next.activeTools }),
            allowRemoteSearch: next.allowRemoteSearch,
          });
        } catch (error) {
          // A failed persistence/readback must never leave a newly granted
          // permission active only in memory.
          toolSettings = { allowRemoteSearch: false };
          try {
            toolSettings = await readToolSettings();
          } catch {
            // Remain fail-closed until storage becomes available again.
          }
          throw error;
        }
      }
      if (!currentAgent) currentAgent = createAgent();
      return currentAgent;
    });
  settingsReady = operation.then(() => {});
  void settingsReady.catch(() => {});
  return operation;
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
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
    getAgent()
      .then((agent) =>
        Promise.all([
          featureExtractor.getFeatureExtractionPipeline(
            onModelDownloadProgress
          ),
          agent.getTextGenerationPipeline(onModelDownloadProgress),
        ])
      )
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
    initializeAgent(message)
      .then(() =>
        sendResponse({
          status: ResponseStatus.SUCCESS,
          tools: resolveActiveTools(
            toolSettings.activeTools,
            toolSettings.allowRemoteSearch
          ),
          allowRemoteSearch: toolSettings.allowRemoteSearch,
        })
      )
      .catch((error: Error) =>
        sendResponse({ status: ResponseStatus.ERROR, error: error.message })
      );
    return true;
  }

  if (message.type === BackgroundTasks.AGENT_GENERATE_TEXT) {
    getAgent()
      .then((agent) => agent.runAgent(message.prompt))
      .then((metrics) => {
        sendResponse({ status: ResponseStatus.SUCCESS, metrics });
      })
      .catch((error: Error) => {
        console.error("GENERATE_TEXT failed:", error);
        sendResponse({ status: ResponseStatus.ERROR, error: error.message });
      });
    return true;
  }

  if (message.type === BackgroundTasks.AGENT_GET_MESSAGES) {
    getAgent()
      .then((agent) =>
        sendResponse({
          status: ResponseStatus.SUCCESS,
          messages: agent.chatMessages,
        })
      )
      .catch((error: Error) =>
        sendResponse({ status: ResponseStatus.ERROR, error: error.message })
      );
    return true;
  }

  if (message.type === BackgroundTasks.AGENT_CLEAR) {
    getAgent()
      .then((agent) => {
        agent.clear();
        sendResponse({ status: ResponseStatus.SUCCESS });
      })
      .catch((error: Error) =>
        sendResponse({ status: ResponseStatus.ERROR, error: error.message })
      );
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
  if (changeInfo.status !== "complete") return;
  if (!tab.url?.startsWith("http")) return;

  // Add page to vector history for later retrieval
  addCurrentPageToVectorHistory(tabId, tab);
});
