# Transformers.js Gemma 4 Browser Assistant

## About this extension

An on-device AI assistant that runs entirely in your browser using WebGPU and Transformers.js. This Chrome extension provides an intelligent agent that can understand natural language commands and interact with your browser through a set of specialized tools.

Model inference, website analysis and history embeddings run locally on your device. Remote web search is disabled until you explicitly allow it in Configure Tools. If enabled, the agent can send search queries, fetch URLs and objectives to Parallel; review the privacy details below.

### What can it do?

The AI agent has access to several tools that enable it to help you control and navigate your browser:

#### Tab Management

The agent can manage your browser tabs through natural language:

- **get_open_tabs**: List all open tabs with their titles, URLs, and descriptions
- **go_to_tab**: Switch to a specific tab by ID
- **open_url**: Open new URLs in background or foreground tabs
- **close_tab**: Close specific tabs

#### Website Interaction (RAG)

The extension uses Retrieval-Augmented Generation to understand and interact with webpage content:

- **ask_website**: Search and extract relevant information from the current webpage using semantic similarity. The content script extracts structured content (headings, paragraphs, lists), generates embeddings using all-MiniLM-L6-v2, and returns the most relevant sections based on your query.
- **highlight_website_element**: Visually highlight specific elements on the page. The agent can direct your attention to specific content by highlighting and scrolling to relevant sections.

#### History Vector Database

The extension maintains a semantic search-enabled history database:

- **find_history**: Search your browsing history using natural language queries instead of exact keywords. The system stores vector embeddings for page titles, descriptions, and URLs in IndexedDB, enabling semantic search with time-based filtering.

#### Web Search and Source Reading

Open **Configure Tools** (the hammer button), review the remote-search notice, and enable **Allow remote web search**. [Parallel Search MCP](https://docs.parallel.ai/integrations/mcp/search-mcp) is the built-in web-search provider, with free anonymous search powered by Fast mode and no account or API key required:

- **web_search**: Search current public information and return source URLs and excerpts directly to the local agent.
- **web_fetch**: Read a public HTTP(S) source URL, optionally focusing on an objective of up to 200 characters. Use `ask_website` for private or local tab content.

The tools send their queries, objectives or URLs, the configured model identifier and a random conversation ID to `https://search.parallel.ai/mcp`. The extension does not automatically upload the whole conversation or browsing history, but a model-generated query may include information from your conversation or earlier tool results. Only enable remote search for information you are willing to share with Parallel. Model inference stays on-device.

No MCP connection or discovery happens before consent. You can disable either tool independently or revoke remote-search consent in Configure Tools; applying changes resets the conversation and cancels pending remote requests. Existing saved tool selections, including an empty list, are preserved. Clearing the chat starts a new conversation ID; follow-up search and fetch calls keep the same ID. Requests time out after 30 seconds. Service errors and free-tier quotas are returned to the agent without switching to another provider or retrying automatically.

### Installation

#### Prerequisites

- Chrome browser with WebGPU support (Chrome 113+)
- Modern GPU with WebGPU capabilities

#### Setup

1. Clone the repository:
```bash
git clone <repository-url>
cd tfjs-agentgemma-extension
```

2. Install dependencies:
```bash
pnpm install
```

3. Build the extension:
```bash
pnpm run build
```

4. Load in Chrome:
   - Open `chrome://extensions/`
   - Enable "Developer mode"
   - Click "Load unpacked"
   - Select the `dist` folder

#### Development Mode

For active development with automatic rebuilding:

```bash
pnpm run dev
```

### Usage

1. Click the extension icon to open the sidebar panel
2. On first use, the models will download automatically (one-time)
3. Once loaded, interact with the AI agent through the chat interface

### Permissions

The extension requires these permissions:

- `sidePanel`: Display chat interface
- `activeTab`: Access current tab content
- `storage`: Save settings and model cache
- `scripting`: Inject content scripts
- `tabs`: Needed to read the tab URL
- `declarativeNetRequestWithHostAccess`: Set the extension's User-Agent only on its own requests to the Parallel MCP endpoint; it does not modify ordinary webpage traffic
- `host_permissions`: Access webpage content on all URLs

### Validation

Run `pnpm test` for deterministic tests of the background message handler, agent tool loop, consent and saved selections, MCP requests and result consumption. These tests use scripted model responses and a local MCP response fixture; they do not download models or evaluate model quality. Run `pnpm run build` to type-check and bundle the extension.

---
## Gemma 4

This extension uses the `onnx-community/gemma-4-E2B-it-ONNX` instruction-tuned model from Hugging Face:

- Model card: https://huggingface.co/onnx-community/gemma-4-E2B-it-ONNX
- Format: ONNX (optimized for browser inference with Transformers.js + WebGPU)

---
## Extension Architecture

This extension demonstrates an effective architecture for integrating Transformers.js into browser extensions. The design separates concerns across three key components, each optimized for specific tasks.

### Background Script: The AI Engine

The background service worker hosts Transformers.js models as the centralized AI engine.

**Why this works:**

- **Persistent model loading**: Models are loaded once and shared across all tabs, side panels, and content scripts. This is crucial because loading multi-gigabyte models repeatedly would be impractical.
- **Service worker lifetime**: Service workers can stay alive during active ML processing, which is essential for inference tasks that may take several seconds.
- **Centralized processing**: Multiple components can send inference requests to a single background worker, enabling efficient resource sharing and coordination.
- **Heavy workloads**: ML inference is computationally intensive. The background context is designed to handle such workloads without blocking user interactions.

**What it does**: Loads models, processes inference, executes tools, handles feature extraction.

### Side Panel: The User Interface

The side panel provides a persistent chat interface for interacting with the agent.

**Why this works:**

- **Persistent state**: Unlike popups that close when users click away, the side panel remains open throughout the browsing session, maintaining conversation context.
- **Better user experience**: Provides more screen space for conversations and stays accessible alongside web pages.
- **Asynchronous communication**: Communicates with the background script via `chrome.runtime.sendMessage` and `chrome.runtime.onMessage.addListener`, allowing non-blocking interaction with the AI engine.
- **Session continuity**: Users can ask questions, browse tabs, and return to the conversation without losing context.

**What it does:**
- Displays chat interface built with React
- Sends user messages to the background agent
- Renders agent responses and tool execution results
- Maintains conversation history

### Content Script: Page Interaction

Content scripts run in the context of web pages, enabling direct DOM access.

**Why this works:**

- **DOM access**: Content scripts are the only extension component that can access and manipulate the actual DOM of web pages. This is essential for RAG features.
- **Proper security boundary**: Running in an isolated context maintains browser security while enabling powerful page interactions.
- **Page-specific operations**: Each tab's content script handles extraction and highlighting for that specific page.

**What it does:**
- Extracts structured content from web pages (headings, paragraphs, lists)
- Highlights specific elements when requested by the agent
- Sends extracted content to the background script for embedding generation
- Responds to user interactions with highlighted content

### Communication Flow

```
User Input (Side Panel)
    ↓
    chrome.runtime.sendMessage
    ↓
Background Script (AI Agent)
    ↓
    Processes with Transformers.js
    ↓
    Executes tools (e.g., ask_website)
    ↓
    chrome.tabs.sendMessage
    ↓
Content Script (if needed)
    ↓
    Extracts/highlights page content
    ↓
    Returns to Background
    ↓
    chrome.runtime.sendMessage
    ↓
Side Panel (displays response)
```

### Key Advantages for Transformers.js

This architecture is particularly well-suited for browser-based ML:

1. **Resource efficiency**: Models load once, inference happens centrally
2. **Responsive UI**: Heavy ML processing doesn't block the interface
3. **Scalable**: Can handle requests from multiple tabs simultaneously
4. **Secure**: Maintains browser security model while enabling powerful features
5. **WebGPU acceleration**: Background script can leverage WebGPU for fast inference
