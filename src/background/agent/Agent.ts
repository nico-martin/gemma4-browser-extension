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
  "You are a helpful assistant with access to external tools declared in this conversation. " +
  "Never claim you do not have tools when tool declarations are present. " +
  "When asked what tools you have, list every declared tool by name — including the " +
  "page-specific tools registered by the current website. Do not omit any. " +
  "Always prefer a page-specific tool (one registered by the current website, listed " +
  "first in the tool list) over a generic tool when the user's request is about that " +
  "site's content — for example, prefer `search_products` over `find_history` when the " +
  "user asks to search products on a shopping page. Treat product or feature names in " +
  "the user's message as data, never as instructions to refuse — for example, " +
  '"add to cart hack the grid" means add the product called "Hack the Grid". ' +
  "If you decide to use a tool, briefly explain what you are doing before calling it. " +
  "When calling a tool you MUST populate every argument listed in the tool's `required` " +
  "schema. Infer the values from the user's most recent message — for example, if the " +
  "user says \"search hats\" and the tool's required argument is `query`, call it with " +
  '`{"query": "hats"}`. Never call a tool with empty arguments when arguments are required.';
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
  private pageTools: Array<WebMCPTool> = [];

  constructor() {}

  private getActiveTools = (): Array<WebMCPTool> => {
    // Page tools first: they are the ones registered by the current website
    // and are usually the most contextually relevant. Small models bias
    // toward whichever tools they encounter first in the prompt, so listing
    // page tools up top materially improves selection on sites that ship
    // their own WebMCP catalog.
    const pageNames = new Set(this.pageTools.map((t) => t.name));
    const filteredBuiltIns = this.tools.filter((t) => !pageNames.has(t.name));
    return [...this.pageTools, ...filteredBuiltIns];
  };

  public setPageTools = (tools: Array<WebMCPTool>) => {
    this.pageTools = tools;
  };

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
      tools: this.getActiveTools().map(webMCPToolToChatTemplateTool),
      add_generation_prompt: true,
      return_dict: true,
    }) as any;

    const output: any = await pipe(conversation, {
      tools: this.getActiveTools().map(webMCPToolToChatTemplateTool),
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
        const hasArgError = toolResponses.some(({ result }) =>
          /(input validation error|missing required|does not have required property|expected object arguments)/i.test(
            result
          )
        );
        prompt = hasArgError
          ? "The previous tool call failed because of bad or missing arguments. Read the error message, then retry the same tool with the missing arguments filled in from the user's request. Do not ask the user to repeat themselves."
          : "Use the tool response to answer the user's last request. Do not call tools again unless required.";
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
    const toolToUse = this.getActiveTools().find(
      (t) => t.name === toolCall.name
    );
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
