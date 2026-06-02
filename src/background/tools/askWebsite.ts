import { ContentTasks, WebsitePart } from "../../shared/types.ts";
import { WebMCPTool } from "../agent/webMcp.tsx";
import FeatureExtractor from "../utils/FeatureExtractor.ts";

class WebsiteContentManager {
  private currentPageParts: WebsitePart[] = [];
  private featureExtractor: FeatureExtractor;
  private loadingPromise: Promise<void> | null = null;
  private currentTabId: number | null = null;
  private currentUrl: string | null = null;

  constructor(featureExtractor: FeatureExtractor) {
    this.featureExtractor = featureExtractor;
    this.setupListeners();
    this.initializeCurrentTab();
  }

  private async initializeCurrentTab(): Promise<void> {
    try {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (tab?.id && tab.url?.startsWith("http")) {
        this.loadPageForTab(tab.id, tab.url);
      }
    } catch (error) {
      console.error("Failed to initialize current tab:", error);
    }
  }

  private setupListeners(): void {
    chrome.tabs.onActivated.addListener(async (activeInfo) => {
      const tab = await chrome.tabs.get(activeInfo.tabId);
      if (tab.url?.startsWith("http")) {
        this.loadPageForTab(activeInfo.tabId, tab.url);
      }
    });

    chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
      if (changeInfo.status === "complete" && tab.url?.startsWith("http")) {
        const [activeTab] = await chrome.tabs.query({
          active: true,
          currentWindow: true,
        });
        if (activeTab?.id === tabId) {
          this.loadPageForTab(tabId, tab.url);
        }
      }
    });
  }

  private async loadPageForTab(tabId: number, url: string): Promise<void> {
    if (this.currentTabId === tabId && this.currentUrl === url) {
      return;
    }

    this.currentTabId = tabId;
    this.currentUrl = url;

    this.loadCurrentPage().catch((error: unknown) => {
      // A missing content script (e.g. chrome:// pages, the web store, or a tab
      // that has not finished injecting yet) surfaces as a connection error.
      // This is an expected condition, not a failure, so do not log it as one.
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("Could not establish connection")) {
        this.currentPageParts = [];
        return;
      }
      console.error("Failed to load page content:", error);
    });
  }

  async loadCurrentPage(): Promise<void> {
    if (this.loadingPromise) {
      return this.loadingPromise;
    }

    this.loadingPromise = this._loadCurrentPageInternal();

    try {
      await this.loadingPromise;
    } finally {
      this.loadingPromise = null;
    }
  }

  private async _loadCurrentPageInternal(): Promise<void> {
    let tabId = this.currentTabId;

    if (!tabId) {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (!tab?.id) {
        throw new Error("No active tab found");
      }
      tabId = tab.id;
    }

    await new Promise((resolve) => setTimeout(resolve, 500));

    const response = await chrome.tabs.sendMessage(tabId, {
      type: ContentTasks.EXTRACT_PAGE_DATA,
    });

    const parts = response.parts as Array<WebsitePart>;

    await Promise.all(
      parts.map(async (part, i) => {
        parts[i].embeddings = part.sentences.length
          ? await this.featureExtractor.extractFeatures(part.sentences)
          : [];
      })
    );

    this.currentPageParts = parts;
  }

  private cosineSimilarity(vecA: number[], vecB: number[]): number {
    if (vecA.length !== vecB.length) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }

    if (normA === 0 || normB === 0) return 0;

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  async search(query: string, topK: number = 3): Promise<WebsitePart[]> {
    if (this.currentPageParts.length === 0) {
      await this.loadCurrentPage();
    }

    if (this.currentPageParts.length === 0) {
      throw new Error("No content available on the current page");
    }

    const queryEmbedding = await this.featureExtractor.extractFeatures([query]);
    const queryVector = queryEmbedding[0];
    const scoredParts: Array<{ part: WebsitePart; score: number }> = [];

    for (const part of this.currentPageParts) {
      if (!part.embeddings || part.embeddings.length === 0) {
        continue;
      }

      let maxSimilarity = 0;
      for (const sentenceEmbedding of part.embeddings) {
        const similarity = this.cosineSimilarity(
          queryVector,
          sentenceEmbedding
        );
        maxSimilarity = Math.max(maxSimilarity, similarity);
      }

      scoredParts.push({
        part,
        score: maxSimilarity,
      });
    }

    scoredParts.sort((a, b) => b.score - a.score);
    return scoredParts.slice(0, topK).map((item) => item.part);
  }

  getCurrentParts(): WebsitePart[] {
    return this.currentPageParts;
  }

  clear(): void {
    this.currentPageParts = [];
  }
}

let websiteContentManager: WebsiteContentManager | null = null;

export const createAskWebsiteTool = (
  featureExtractor: FeatureExtractor
): WebMCPTool => {
  websiteContentManager = new WebsiteContentManager(featureExtractor);

  return {
    name: "ask_website",
    description:
      "Search and retrieve relevant information from the current webpage using semantic similarity. This tool extracts page content and finds the most relevant sections matching the user's query. ALWAYS use this tool when a user asks about the content of the current webpage, wants to know what's on the page, asks for information found on the page, or requests a summary or excerpt from the page.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "The question or search query to find relevant information on the current page",
        },
        topK: {
          type: "number",
          description:
            "Number of most relevant content pieces to return (default: 5)",
          default: 5,
        },
      },
      required: ["query"],
    },
    execute: async (args) => {
      const query = args.query as string;
      const topK = (args.topK as number | undefined) ?? 3;

      if (!query || typeof query !== "string") {
        return `Error: query parameter must be a non-empty string. Received: ${JSON.stringify(args)}`;
      }

      if (!websiteContentManager) {
        return "Error: Website content manager not initialized";
      }

      try {
        const results = await websiteContentManager.search(query, topK);

        if (results.length === 0) {
          return "No relevant content found on the current page.";
        }

        let response = `Found ${results.length} relevant content piece(s):\n\n`;
        results.forEach((part, index) => {
          response += `[${index + 1}] ID: ${part.id} | ${part.tagName.toUpperCase()} (Section ${part.sectionId}, Part ${part.paragraphId}):\n`;
          response += `${part.content}\n\n`;
        });

        response += `\nNote: You can highlight any of these content pieces by using the highlight_website_element tool with the corresponding ID.`;

        return response;
      } catch (error) {
        return `Error searching website content: ${error.toString()}`;
      }
    },
  };
};

export const highlightWebsiteElementTool: WebMCPTool = {
  name: "highlight_website_element",
  description:
    "Highlight a specific content element on the current webpage by its ID. The page will scroll to the element and highlight it with a yellow background. Use this to show the user exactly which part of the page you're referring to.",
  inputSchema: {
    type: "object",
    properties: {
      id: {
        type: "string",
        description:
          "The ID of the content element to highlight (e.g., '1-2'). You can get these IDs from the ask_website tool results.",
      },
    },
    required: ["id"],
  },
  execute: async (args) => {
    const id = args.id as string;

    if (!id || typeof id !== "string") {
      return `Error: id parameter must be a non-empty string. Received: ${JSON.stringify(args)}`;
    }

    try {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });

      if (!tab.id) {
        return "Error: No active tab found";
      }

      await chrome.tabs.sendMessage(tab.id, {
        type: ContentTasks.HIGHLIGHT_ELEMENTS,
        payload: {
          id,
        },
      });

      return `Successfully highlighted element with ID: ${id}`;
    } catch (error) {
      return `Error highlighting element: ${error.toString()}`;
    }
  },
};

export const getWebsiteContentManager = (): WebsiteContentManager | null => {
  return websiteContentManager;
};
