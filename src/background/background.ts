import { ModelRegistry } from "@huggingface/transformers";

import { MODELS, REQUIRED_MODEL_IDS } from "../shared/constants.ts";
import { AvailableTools } from "../shared/tools.ts";
import {
  BackgroundMessages,
  BackgroundTasks,
  ResponseStatus,
} from "../shared/types.ts";
import Agent, {
  getCurrentTextGenId,
  switchTextGenModel,
} from "./agent/Agent.ts";
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
    agent
      .runAgent(message.prompt)
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

  if (message.type === BackgroundTasks.GET_CURRENT_MODEL) {
    sendResponse({
      status: ResponseStatus.SUCCESS,
      modelKey: getCurrentTextGenId(),
    });
    return true;
  }

  if (message.type === BackgroundTasks.SWITCH_MODEL) {
    const modelKey = message.modelKey as string;
    switchTextGenModel(modelKey)
      .then(() => {
        // Clear agent and re-create with new model
        if (currentAgent) {
          currentAgent.clear();
        }
        currentAgent = null;
        sendResponse({
          status: ResponseStatus.SUCCESS,
          modelKey,
        });
      })
      .catch((error: Error) => {
        console.error("SWITCH_MODEL failed:", error);
        sendResponse({ status: ResponseStatus.ERROR, error: error.message });
      });
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
