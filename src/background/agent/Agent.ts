import {
  DynamicCache,
  InterruptableStoppingCriteria,
  TextGenerationPipeline,
  TextStreamer,
  pipeline,
} from "@huggingface/transformers";

import { MODELS, TEXT_GENERATION_ID } from "../../shared/constants.ts";
import {
  AgentMetrics,
  ChatMessage,
  ChatMessageAssistant,
  ToolPermissionDecision,
  ToolPermissions,
  ToolStatus,
} from "../../shared/types.ts";
import { extractToolCalls } from "./extractToolCalls.ts";
import { ToolCallPayload } from "./types.ts";
import {
  WebMCPTool,
  executeWebMCPTool,
  webMCPToolToChatTemplateTool,
} from "./webMcp.tsx";

type Message = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  [key: string]: any;
};

type GenerationMetrics = AgentMetrics;
export type AgentRunMetrics = AgentMetrics;

let pipe: TextGenerationPipeline | null = null;
const SYSTEM_PROMPT_BASE =
  "You are a helpful assistant running inside a browser extension. " +
  "You can interact with the user's browser via the tools declared in this conversation — never claim you have no tools when declarations are present. " +
  "When the user says 'this page', 'the page', 'this site', 'this tab', 'this article', or anything similar without giving a URL, they mean their currently active tab. " +
  "Do not ask the user for a URL in that case. Call the ask_website tool to read content from the active tab. " +
  "Each tool call requires the user's approval — they will be prompted, so call tools confidently when they help fulfil the request. " +
  "If you decide to use a tool, briefly say what you are about to do before calling it.";

const buildSystemPrompt = (activeTab?: {
  title?: string;
  url?: string;
}): string => {
  if (!activeTab?.url) return SYSTEM_PROMPT_BASE;
  const title = activeTab.title || "(untitled)";
  return (
    SYSTEM_PROMPT_BASE +
    `\n\nThe user's currently active browser tab:\n- Title: ${title}\n- URL: ${activeTab.url}`
  );
};

const getActiveTabInfo = async (): Promise<
  { title?: string; url?: string } | undefined
> => {
  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      lastFocusedWindow: true,
    });
    if (!tab?.url?.startsWith("http")) return undefined;
    return { title: tab.title, url: tab.url };
  } catch {
    return undefined;
  }
};

const createInitialMessages = (): Array<Message> => [
  {
    role: "system",
    content: SYSTEM_PROMPT_BASE,
  },
];
const END_OF_TEXT_TOKEN_REGEX = /<\|end_of_text\|>/g;
const sanitizeModelText = (text: string) =>
  text.replace(END_OF_TEXT_TOKEN_REGEX, "").trim();

const PERMISSIONS_STORAGE_KEY = "toolPermissions";

const loadToolPermissions = async (): Promise<ToolPermissions> => {
  const result = await chrome.storage.local.get(PERMISSIONS_STORAGE_KEY);
  return (result[PERMISSIONS_STORAGE_KEY] as ToolPermissions) || {};
};

const saveToolPermissionAlways = async (toolName: string) => {
  const permissions = await loadToolPermissions();
  permissions[toolName] = "always_allow";
  await chrome.storage.local.set({ [PERMISSIONS_STORAGE_KEY]: permissions });
};

const getTextGenerationPipeline = async (
  onDownloadProgress: (id: string, percentage: number) => void = () => {}
): Promise<TextGenerationPipeline> => {
  if (pipe) return pipe;

  try {
    const m = MODELS[TEXT_GENERATION_ID];
    pipe = (await pipeline("text-generation", m.modelId, {
      dtype: m.dtype,
      device: "webgpu",
      progress_callback: (i) => {
        if (i.status === "progress_total") {
          onDownloadProgress(m.modelId, i.progress);
        }
      },
    })) as TextGenerationPipeline;

    return pipe;
  } catch (error) {
    console.error("Failed to initialize text generation pipeline:", error);
    throw error;
  }
};

class Agent {
  private pastKeyValues: DynamicCache | null = null;
  private messages: Array<Message> = createInitialMessages();
  private _chatMessages: Array<ChatMessage> = [];
  private chatMessagesListener: Array<
    (chatMessages: Array<ChatMessage>) => void
  > = [];
  private tools: Array<WebMCPTool> = [];
  private stoppingCriteria = new InterruptableStoppingCriteria();
  private pendingPermissions = new Map<
    string,
    (decision: ToolPermissionDecision) => void
  >();

  constructor() {}

  public cancel = () => {
    this.stoppingCriteria.interrupt();
    for (const resolve of this.pendingPermissions.values()) resolve("deny");
    this.pendingPermissions.clear();
  };

  public resolvePermission = (
    toolCallId: string,
    decision: ToolPermissionDecision
  ) => {
    const resolve = this.pendingPermissions.get(toolCallId);
    if (!resolve) return;
    this.pendingPermissions.delete(toolCallId);
    resolve(decision);
  };

  private requestPermission = (
    toolCallId: string
  ): Promise<ToolPermissionDecision> =>
    new Promise((resolve) => {
      this.pendingPermissions.set(toolCallId, resolve);
    });

  get chatMessages() {
    return this._chatMessages;
  }

  set chatMessages(chatMessages: Array<ChatMessage>) {
    this._chatMessages = chatMessages;
    this.chatMessagesListener.forEach((listener) => listener(chatMessages));
  }

  public onChatMessageUpdate(callback: (messages: Array<ChatMessage>) => void) {
    this.chatMessagesListener.push(callback);
  }

  public setTool = (tool: WebMCPTool) => {
    this.tools = [...this.tools, tool];
  };

  public getTextGenerationPipeline = getTextGenerationPipeline;

  public generateText = async (
    prompt: string,
    role: "user" | "tool" = "user",
    onResponseUpdate: (response: string) => void = () => {},
    options: { appendPromptMessage?: boolean } = {}
  ): Promise<{ text: string; metrics: GenerationMetrics }> => {
    const start = performance.now();
    let firstTokenAt: number | null = null;

    if (!this.messages.some(({ role }) => role === "system")) {
      this.messages = [...createInitialMessages(), ...this.messages];
    }

    if (options.appendPromptMessage ?? true) {
      this.messages = [...this.messages, { role, content: prompt }];
    }
    const pipe = await this.getTextGenerationPipeline();
    const conversation = [...this.messages];
    if (!this.pastKeyValues) {
      this.pastKeyValues = new DynamicCache();
    }
    let response = "";

    // Add placeholder assistant message for streaming UI updates
    this.messages.push({ role: "assistant", content: "" });

    const streamer = new TextStreamer(pipe.tokenizer, {
      skip_prompt: true,
      skip_special_tokens: false,
      callback_function: (token: string) => {
        if (firstTokenAt === null) {
          firstTokenAt = performance.now();
        }
        response = response + token;
        this.messages = this.messages.map((message, index, all) => ({
          ...message,
          content: index === all.length - 1 ? response : message.content,
        }));
        onResponseUpdate(sanitizeModelText(response));
      },
    });

    const input = pipe.tokenizer.apply_chat_template(conversation, {
      tools: this.tools.map(webMCPToolToChatTemplateTool),
      add_generation_prompt: true,
      return_dict: true,
    }) as any;

    const output: any = await pipe(conversation, {
      tools: this.tools.map(webMCPToolToChatTemplateTool),
      add_generation_prompt: true,
      past_key_values: this.pastKeyValues,
      max_new_tokens: 1024,
      do_sample: false,
      streamer,
      stopping_criteria: this.stoppingCriteria,
    });

    const promptLength = Number(input.input_ids.dims.at(-1) ?? 0);
    const finalGeneratedText = output?.[0]?.generated_text;

    if (Array.isArray(finalGeneratedText) && response.trim().length === 0) {
      const lastMessage = finalGeneratedText[finalGeneratedText.length - 1];
      if (typeof lastMessage === "string") {
        response = lastMessage;
      } else {
        const content =
          typeof lastMessage?.content === "string" ? lastMessage.content : "";
        const toolCalls = Array.isArray(lastMessage?.tool_calls)
          ? lastMessage.tool_calls
          : [];

        if (toolCalls.length > 0) {
          const renderedToolCalls = toolCalls
            .map((toolCall: any) => {
              const functionName = toolCall?.function?.name;
              const functionArguments = toolCall?.function?.arguments ?? {};
              if (typeof functionName !== "string" || !functionName.trim()) {
                return "";
              }

              const serializedArguments =
                typeof functionArguments === "string"
                  ? functionArguments
                  : JSON.stringify(functionArguments);

              return `<|tool_call>call:${functionName}${serializedArguments}<tool_call|>`;
            })
            .filter(Boolean)
            .join("");

          if (renderedToolCalls) response = renderedToolCalls;
          else if (content.length > 0) response = content;
        } else if (content.length > 0) {
          response = content;
        }
      }
    }

    const generatedIds: any = pipe.tokenizer(response, {
      add_special_tokens: false,
    }).input_ids;
    const generatedTokens = Array.isArray(generatedIds?.[0])
      ? generatedIds[0].length
      : Array.isArray(generatedIds)
        ? generatedIds.length
        : 0;

    response = sanitizeModelText(response);

    this.messages = this.messages.map((message, index, all) => ({
      ...message,
      content: index === all.length - 1 ? response : message.content,
    }));

    const end = performance.now();
    const prefillMs = Math.max(0, (firstTokenAt ?? end) - start);
    const totalMs = Math.max(0, end - start);
    const decodeMs = Math.max(0, totalMs - prefillMs);

    const metrics: GenerationMetrics = {
      generatedTokens,
      prefillTokens: promptLength,
      prefillMs,
      prefillTokensPerSecond:
        prefillMs > 0 ? promptLength / (prefillMs / 1000) : 0,
      decodeMs,
      totalMs,
      tokensPerSecond: decodeMs > 0 ? generatedTokens / (decodeMs / 1000) : 0,
      msPerToken: generatedTokens > 0 ? decodeMs / generatedTokens : 0,
    };

    return { text: response, metrics };
  };

  public runAgent = async (prompt: string): Promise<AgentRunMetrics> => {
    this.stoppingCriteria.reset();
    const activeTab = await getActiveTabInfo();
    const systemContent = buildSystemPrompt(activeTab);
    const systemIdx = this.messages.findIndex((m) => m.role === "system");
    const previousSystemContent =
      systemIdx >= 0 ? this.messages[systemIdx].content : null;
    if (systemIdx >= 0) {
      this.messages[systemIdx] = {
        ...this.messages[systemIdx],
        content: systemContent,
      };
    } else {
      this.messages = [{ role: "system", content: systemContent }, ...this.messages];
    }
    if (previousSystemContent !== systemContent) {
      // System prompt changed — KV cache prefix is no longer valid.
      void this.pastKeyValues?.dispose();
      this.pastKeyValues = null;
    }
    let roleForGeneration: "user" | "tool" = "user";
    let appendPromptMessage = true;
    const start = performance.now();
    let generatedTokens = 0;
    let prefillTokens = 0;
    let prefillMs = 0;
    let decodeMs = 0;

    this.chatMessages = [
      ...this.chatMessages,
      { role: "user", content: prompt },
    ];
    const prevChatMessages = this.chatMessages;

    const assistantMessage: ChatMessageAssistant = {
      role: "assistant",
      content: "",
      tools: [],
      metrics: {
        generatedTokens: 0,
        prefillTokens: 0,
        prefillMs: 0,
        prefillTokensPerSecond: 0,
        decodeMs: 0,
        totalMs: 0,
        tokensPerSecond: 0,
        msPerToken: 0,
      },
    };

    this.chatMessages = [...prevChatMessages, assistantMessage];

    try {
    let messageInThisAgentRun = "";
    const updateAssistantMessage = (response: string) => {
      const { toolCalls, message } = extractToolCalls(response);

      toolCalls.map((tool) => {
        if (!Boolean(assistantMessage.tools.find(({ id }) => tool.id === id))) {
          assistantMessage.tools = [
            ...assistantMessage.tools,
            {
              name: tool.name,
              functionSignature: `${tool.name}(${JSON.stringify(
                tool.arguments
              )})`,
              id: tool.id,
              result: "",
              status: "pending_permission",
            },
          ];
        }
      });

      assistantMessage.content = messageInThisAgentRun + message;

      this.chatMessages = [...prevChatMessages, assistantMessage];
    };

    while (prompt !== null) {
      const generation = await this.generateText(
        prompt,
        roleForGeneration,
        updateAssistantMessage,
        { appendPromptMessage }
      );

      const finalResponse = generation.text;
      generatedTokens += generation.metrics.generatedTokens;
      prefillTokens += generation.metrics.prefillTokens;
      prefillMs += generation.metrics.prefillMs;
      decodeMs += generation.metrics.decodeMs;
      const elapsedMs = Math.max(0, performance.now() - start);
      assistantMessage.metrics = {
        generatedTokens,
        prefillTokens,
        prefillMs,
        prefillTokensPerSecond:
          prefillMs > 0 ? prefillTokens / (prefillMs / 1000) : 0,
        decodeMs,
        totalMs: elapsedMs,
        tokensPerSecond: decodeMs > 0 ? generatedTokens / (decodeMs / 1000) : 0,
        msPerToken: generatedTokens > 0 ? decodeMs / generatedTokens : 0,
      };

      const { toolCalls, message } = extractToolCalls(finalResponse);
      messageInThisAgentRun = message;

      if (this.stoppingCriteria.interrupted || toolCalls.length === 0) {
        prompt = null;
      } else {
        const updateToolStatus = (id: string, status: ToolStatus) => {
          assistantMessage.tools = assistantMessage.tools.map((tool) =>
            tool.id === id ? { ...tool, status } : tool
          );
          this.chatMessages = [...prevChatMessages, assistantMessage];
        };
        const toolResponses = await Promise.all(
          toolCalls.map((call) => this.executeToolCall(call, updateToolStatus))
        );

        for (let i = this.messages.length - 1; i >= 0; i -= 1) {
          if (this.messages[i].role === "assistant") {
            this.messages[i] = {
              ...this.messages[i],
              content: message,
            };
            break;
          }
        }

        for (let i = this.messages.length - 1; i >= 0; i -= 1) {
          if (this.messages[i].role === "assistant") {
            this.messages[i] = {
              ...this.messages[i],
              tool_calls: toolCalls.map((call) => ({
                id: call.id,
                type: "function",
                function: {
                  name: call.name,
                  arguments: call.arguments,
                },
              })),
            };
            break;
          }
        }

        this.messages = [
          ...this.messages,
          ...toolResponses.map(({ id, name, result }) => ({
            role: "tool" as const,
            tool_call_id: id,
            name,
            content: result,
          })),
        ];

        assistantMessage.tools = assistantMessage.tools.map((tool) => {
          const response = toolResponses.find(({ id }) => id === tool.id);
          return response
            ? { ...tool, result: response.result || tool.result }
            : tool;
        });

        this.chatMessages = [...prevChatMessages, assistantMessage];
        prompt =
          "Use the tool response to answer the user's last request. Do not call tools again unless required.";
        roleForGeneration = "user";
        appendPromptMessage = true;
      }
    }
    const totalMs = Math.max(0, performance.now() - start);
    assistantMessage.metrics = {
      generatedTokens,
      prefillTokens,
      prefillMs,
      prefillTokensPerSecond:
        prefillMs > 0 ? prefillTokens / (prefillMs / 1000) : 0,
      decodeMs,
      totalMs,
      tokensPerSecond: decodeMs > 0 ? generatedTokens / (decodeMs / 1000) : 0,
      msPerToken: generatedTokens > 0 ? decodeMs / generatedTokens : 0,
    };
    this.chatMessages = [...prevChatMessages, assistantMessage];

    return {
      generatedTokens,
      prefillTokens,
      prefillMs,
      prefillTokensPerSecond:
        prefillMs > 0 ? prefillTokens / (prefillMs / 1000) : 0,
      decodeMs,
      totalMs,
      tokensPerSecond: decodeMs > 0 ? generatedTokens / (decodeMs / 1000) : 0,
      msPerToken: generatedTokens > 0 ? decodeMs / generatedTokens : 0,
    };
    } finally {
      if (this.stoppingCriteria.interrupted) {
        // KV cache was mid-write when interrupted; reusing it corrupts the next run.
        void this.pastKeyValues?.dispose();
        this.pastKeyValues = null;
      }
    }
  };

  private executeToolCall = async (
    toolCall: ToolCallPayload,
    updateStatus: (id: string, status: ToolStatus) => void
  ): Promise<{ id: string; name: string; result: string }> => {
    const toolToUse = this.tools.find((t) => t.name === toolCall.name);
    if (!toolToUse)
      throw new Error(`Tool '${toolCall.name}' not found or is disabled.`);

    const permissions = await loadToolPermissions();
    let decision: ToolPermissionDecision;
    if (permissions[toolCall.name] === "always_allow") {
      decision = "allow_once";
    } else {
      updateStatus(toolCall.id, "pending_permission");
      decision = await this.requestPermission(toolCall.id);
      if (decision === "always_allow") {
        await saveToolPermissionAlways(toolCall.name);
      }
    }

    if (decision === "deny") {
      updateStatus(toolCall.id, "denied");
      return {
        id: toolCall.id,
        name: toolCall.name,
        result:
          "The user denied permission to run this tool. Do not retry it; if needed, ask the user how to proceed without it.",
      };
    }

    updateStatus(toolCall.id, "running");
    const result = await executeWebMCPTool(toolToUse, toolCall.arguments);
    updateStatus(toolCall.id, "completed");
    return {
      id: toolCall.id,
      name: toolCall.name,
      result,
    };
  };

  public clear() {
    this.messages = createInitialMessages();
    void this.pastKeyValues?.dispose();
    this.pastKeyValues = null;
    this.chatMessages = [];
  }
}

export default Agent;
