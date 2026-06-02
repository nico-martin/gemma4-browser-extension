import {
  DynamicCache,
  TextGenerationPipeline,
  TextStreamer,
  pipeline,
} from "@huggingface/transformers";

import { MODELS, TEXT_GENERATION_ID } from "../../shared/constants.ts";
import {
  AgentMetrics,
  ChatMessage,
  ChatMessageAssistant,
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
const SYSTEM_PROMPT =
  "You are a helpful browser assistant with access to external tools for tab management, webpage content search, and browsing history retrieval. " +
  "Always use the appropriate tools to complete tasks: " +
  "- Use 'get_open_tabs' to list all open browser tabs " +
  "- Use 'go_to_tab' to switch to a specific tab by ID " +
  "- Use 'open_url' to open new URLs in tabs " +
  "- Use 'close_tab' to close tabs " +
  "- Use 'ask_website' to search for information on the current page by semantically searching page content " +
  "- Use 'highlight_website_element' to highlight found content with an element ID " +
  "- Use 'find_history' to search your browsing history semantically " +
  "Tab IDs are not sequential numbers. When the user refers to a tab by its position, number, name, or title (e.g. 'tab 1', 'the first tab', 'the YouTube tab'), ALWAYS call get_open_tabs first to find its actual id, then call go_to_tab or close_tab with that id. Never ask the user for a tab id. " +
  "get_open_tabs returns a JSON array ordered by position. 'tab 1' or 'the first tab' is simply the FIRST element of that array, 'tab 2' the second element, and so on (1-based). Take that element's numeric `id` field and immediately call go_to_tab with it. " +
  "Worked example: if get_open_tabs returns [{\"id\": 482, \"title\": \"Docs\"}, {\"id\": 517, \"title\": \"News\"}] and the user said 'go to tab 1', you call go_to_tab with tabId 482 (the id of the first element). Never reply that the request is ambiguous in this case. " +
  "When the user asks to close the active or current tab, call get_open_tabs, find the tab whose 'active' field is true, and call close_tab with its id. " +
  "You are running inside a browser sidebar. The user is always looking at a webpage while talking to you. " +
  "ALWAYS call ask_website FIRST for ANY of these — do not ask the user which page or site they mean, just call it immediately: " +
  "questions about news ('今日のニュース', 'what is the news today', 'latest news'), " +
  "questions about trends ('トレンドワード', 'trending topics', 'what is popular'), " +
  "questions about what a page or site contains ('何が書いてある', 'what does it say about X', 'tell me about X on this page'), " +
  "requests to summarize or read the page ('要約して', 'summarize this', 'what is this page about'), " +
  "ANY content question where the answer might be on the current webpage. " +
  "Rule: when in doubt, call ask_website. You are a browser assistant — always check the page first. " +
  "When a user asks about past pages or browsing history, ALWAYS use find_history. " +
  "Briefly explain what you are doing before calling each tool.";
const createInitialMessages = (): Array<Message> => [
  {
    role: "system",
    content: SYSTEM_PROMPT,
  },
];
const END_OF_TEXT_TOKEN_REGEX = /<\|end_of_text\|>/g;
const sanitizeModelText = (text: string) =>
  text.replace(END_OF_TEXT_TOKEN_REGEX, "").trim();

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

  constructor() {}

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

    const tokenized = pipe.tokenizer(response, { add_special_tokens: false });
    // input_ids is a Tensor with shape [1, seq_len]; use dims to get token count
    const generatedTokens: number =
      (tokenized.input_ids as any)?.dims?.[1] ??
      (tokenized.input_ids as any)?.dims?.[0] ??
      0;

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

    let messageInThisAgentRun = "";
    const updateAssistantMessage = (response: string) => {
      const { toolCalls, message } = extractToolCalls(response);

      toolCalls.map((tool) => {
        if (!assistantMessage.tools.find(({ id }) => tool.id === id)) {
          assistantMessage.tools = [
            ...assistantMessage.tools,
            {
              name: tool.name,
              functionSignature: `${tool.name}(${JSON.stringify(
                tool.arguments
              )})`,
              id: tool.id,
              result: "",
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

      if (toolCalls.length === 0) {
        prompt = null;
      } else {
        const toolResponses = await Promise.all(
          toolCalls.map(this.executeToolCall)
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

        assistantMessage.tools = assistantMessage.tools.map((tool) => ({
          ...tool,
          result:
            toolResponses.find(({ id }) => id === tool.id)?.result ||
            tool.result,
        }));

        this.chatMessages = [...prevChatMessages, assistantMessage];
        prompt =
          "Use the tool response above to continue the user's last request. " +
          "If completing the request needs another tool (for example, after listing tabs you still need to switch or close one), call that tool now. " +
          "Only give a final text answer once the request is fully done.";
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
  };

  private executeToolCall = async (
    toolCall: ToolCallPayload
  ): Promise<{ id: string; name: string; result: string }> => {
    const toolToUse = this.tools.find((t) => t.name === toolCall.name);
    if (!toolToUse)
      throw new Error(`Tool '${toolCall.name}' not found or is disabled.`);

    return {
      id: toolCall.id,
      name: toolCall.name,
      result: await executeWebMCPTool(toolToUse, toolCall.arguments),
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
