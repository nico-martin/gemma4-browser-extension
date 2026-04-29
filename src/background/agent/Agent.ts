import {
  DynamicCache,
  TextGenerationPipeline,
  TextStreamer,
  pipeline,
} from "@huggingface/transformers";

import {
  MODELS,
  DEFAULT_TEXT_GENERATION_ID,
} from "../../shared/constants.ts";
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
let currentTextGenId: string = DEFAULT_TEXT_GENERATION_ID;
// Gemma 4 E2B context is 8192 but the ONNX model + tool definitions + chat
// template overhead consume a large portion.  Keep this conservative to avoid
// "Tensor shape is too large" OrtRun errors.
const MAX_CONTEXT_TOKENS = 3072;
const MAX_NEW_TOKENS = 512;
// Input tokens must leave room for generation output
const MAX_INPUT_TOKENS = MAX_CONTEXT_TOKENS - MAX_NEW_TOKENS; // 2560
// Cap individual tool responses to prevent a single tool from blowing the budget
const MAX_TOOL_RESPONSE_CHARS = 1500;
const SYSTEM_PROMPT =
  "You are a helpful assistant with access to external tools declared in this conversation. " +
  "Never claim you do not have tools when tool declarations are present. " +
  "When asked what tools you have, list the declared tool names exactly. " +
  "If you decide to use a tool, briefly explain what you are doing before calling it.";
const createInitialMessages = (): Array<Message> => [
  {
    role: "system",
    content: SYSTEM_PROMPT,
  },
];
export function getCurrentTextGenId(): string {
  return currentTextGenId;
}

export async function switchTextGenModel(modelKey: string): Promise<void> {
  if (!MODELS[modelKey] || MODELS[modelKey].task !== "text-generation") {
    throw new Error(`Invalid text generation model: ${modelKey}`);
  }
  if (modelKey === currentTextGenId && pipe) return;
  // Dispose current pipeline
  if (pipe) {
    await pipe.dispose?.();
    pipe = null;
  }
  currentTextGenId = modelKey;
}

const END_OF_TEXT_TOKEN_REGEX = /<\|end_of_text\|>/g;
const sanitizeModelText = (text: string) =>
  text.replace(END_OF_TEXT_TOKEN_REGEX, "").trim();

const getTextGenerationPipeline = async (
  onDownloadProgress: (id: string, percentage: number) => void = () => {}
): Promise<TextGenerationPipeline> => {
  if (pipe) return pipe;

  try {
    const m = MODELS[currentTextGenId];
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

  /**
   * Measure the actual token count of the current messages + tool definitions.
   * Returns the token count that would be sent to the model.
   */
  private measureTokens(
    pipe: TextGenerationPipeline,
    toolDefs: any[],
    messages?: Message[]
  ): number {
    const msgs = messages ?? this.messages;
    const conversation = msgs.filter(
      (m) => m.role !== "assistant" || m.content !== ""
    );
    const input = pipe.tokenizer.apply_chat_template(conversation, {
      tools: toolDefs,
      add_generation_prompt: true,
      return_dict: true,
    }) as any;
    return Number(input.input_ids.dims.at(-1) ?? 0);
  }

  /**
   * Ensure messages fit within MAX_INPUT_TOKENS BEFORE calling pipe().
   * Progressively trims conversation and resets KV cache as needed.
   * Returns true if the context fits, false if even system-only is too large.
   */
  private ensureFitsContext(
    pipe: TextGenerationPipeline,
    toolDefs: any[]
  ): boolean {
    const pastSeqLen = this.pastKeyValues?.get_seq_length() ?? 0;
    let tokenCount = this.measureTokens(pipe, toolDefs);
    const effectiveLen = Math.max(tokenCount, pastSeqLen + 1);

    if (effectiveLen <= MAX_INPUT_TOKENS) return true;

    // Need to trim — reset KV cache since we're changing the conversation
    console.warn(
      `Context too long (tokens=${tokenCount}, kv_cache=${pastSeqLen}, limit=${MAX_INPUT_TOKENS}), trimming`
    );
    void this.pastKeyValues?.dispose();
    this.pastKeyValues = new DynamicCache();

    // Progressive trim: 6→4→2→system-only
    for (const keepCount of [6, 4, 2]) {
      this.trimMessages(keepCount);
      tokenCount = this.measureTokens(pipe, toolDefs);
      console.info(`After trim (keep=${keepCount}): ${tokenCount} tokens`);
      if (tokenCount <= MAX_INPUT_TOKENS) return true;
    }

    // Last resort: system message only
    this.messages = this.messages.filter((m) => m.role === "system");
    tokenCount = this.measureTokens(pipe, toolDefs);
    console.warn(`System-only: ${tokenCount} tokens`);
    return tokenCount <= MAX_INPUT_TOKENS;
  }

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

    if (!this.pastKeyValues) {
      this.pastKeyValues = new DynamicCache();
    }
    let response = "";

    const toolDefs = this.tools.map(webMCPToolToChatTemplateTool);

    // ── Ensure context fits BEFORE calling pipe() ──
    const fits = this.ensureFitsContext(pipe, toolDefs);
    const preCallTokens = this.measureTokens(pipe, toolDefs);
    const kvLen = this.pastKeyValues?.get_seq_length() ?? 0;
    console.info(
      `[Agent] pre-call: tokens=${preCallTokens}, kv_cache=${kvLen}, limit=${MAX_INPUT_TOKENS}, msgs=${this.messages.length}`
    );
    if (!fits) {
      // Even system + tools alone exceed the budget — cannot proceed
      console.error(
        "System message + tool definitions alone exceed MAX_INPUT_TOKENS. Cannot generate."
      );
      this.messages = createInitialMessages();
      void this.pastKeyValues?.dispose();
      this.pastKeyValues = null;
      const end = performance.now();
      return {
        text: "コンテキストが長すぎて処理できません。会話をリセットしました。",
        metrics: {
          generatedTokens: 0,
          prefillTokens: 0,
          prefillMs: 0,
          prefillTokensPerSecond: 0,
          decodeMs: 0,
          totalMs: Math.max(0, end - start),
          tokensPerSecond: 0,
          msPerToken: 0,
        },
      };
    }

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

    const getConversation = () =>
      this.messages.filter(
        (m) => m.role !== "assistant" || m.content !== ""
      );

    // ── pipe() call — context is guaranteed to fit ──
    let output: any;
    try {
      output = await pipe(getConversation(), {
        tools: toolDefs,
        add_generation_prompt: true,
        past_key_values: this.pastKeyValues,
        max_new_tokens: MAX_NEW_TOKENS,
        do_sample: false,
        streamer,
      });
    } catch (error: any) {
      // Safety net — should not normally be reached thanks to ensureFitsContext
      console.error("Unexpected pipe() error despite pre-check:", error);
      this.messages = createInitialMessages();
      void this.pastKeyValues?.dispose();
      this.pastKeyValues = null;
      const end = performance.now();
      return {
        text: "予期しないエラーが発生しました。会話をリセットしました。もう一度お試しください。",
        metrics: {
          generatedTokens: 0,
          prefillTokens: 0,
          prefillMs: 0,
          prefillTokensPerSecond: 0,
          decodeMs: 0,
          totalMs: Math.max(0, end - start),
          tokensPerSecond: 0,
          msPerToken: 0,
        },
      };
    }

    const promptLength = this.measureTokens(pipe, toolDefs);
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

    try {
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
          tokensPerSecond:
            decodeMs > 0 ? generatedTokens / (decodeMs / 1000) : 0,
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
            "Use the tool response to answer the user's last request. Do not call tools again unless required.";
          roleForGeneration = "user";
          appendPromptMessage = true;
        }
      }
    } catch (error: any) {
      console.error("Agent run failed:", error);
      // Graceful fail-safe: show error to user, reset state to prevent repeat failures
      const errorMsg =
        error?.message?.includes("Tensor shape") ||
        error?.message?.includes("OrtRun")
          ? "コンテキストが長すぎてエラーが発生しました。会話をリセットします。短いメッセージでもう一度お試しください。"
          : `エラーが発生しました: ${error?.message ?? "Unknown error"}`;
      assistantMessage.content = errorMsg;
      this.chatMessages = [...prevChatMessages, assistantMessage];
      // Reset to prevent cascading failures
      this.messages = createInitialMessages();
      void this.pastKeyValues?.dispose();
      this.pastKeyValues = null;
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

    let result = await executeWebMCPTool(toolToUse, toolCall.arguments);

    // Cap tool response at the source — prevent huge data from ever entering messages
    if (result.length > MAX_TOOL_RESPONSE_CHARS) {
      result =
        result.slice(0, MAX_TOOL_RESPONSE_CHARS) + "…[truncated]";
    }

    return { id: toolCall.id, name: toolCall.name, result };
  };

  private trimMessages(keepCount = 6) {
    const MAX_MESSAGE_CHARS = 2000;
    const systemMessages = this.messages.filter((m) => m.role === "system");
    const nonSystemMessages = this.messages.filter((m) => m.role !== "system");

    // Keep system messages + last few conversation turns
    const count = Math.min(nonSystemMessages.length, keepCount);
    const kept = nonSystemMessages.slice(-count);

    // Truncate very long messages (e.g., tool responses with huge page content)
    for (const m of kept) {
      if (m.content.length > MAX_MESSAGE_CHARS) {
        m.content = m.content.slice(0, MAX_MESSAGE_CHARS) + "…[truncated]";
      }
    }

    this.messages = [...systemMessages, ...kept];
  }

  public clear() {
    this.messages = createInitialMessages();
    void this.pastKeyValues?.dispose();
    this.pastKeyValues = null;
    this.chatMessages = [];
  }
}

export default Agent;
