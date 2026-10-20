import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const model = vi.hoisted(() => ({
  scripts: new Map<
    string,
    { name: string; arguments: Record<string, unknown> }
  >(),
  templates: [] as any[],
  consumed: [] as any[],
}));

// Only inference is scripted. The production background listener, resolver,
// Agent.runAgent, argument validator and MCP SDK/HTTP transport run unchanged.
vi.mock("@huggingface/transformers", () => {
  const tokenizer = Object.assign(() => ({ input_ids: [[1]] }), {
    apply_chat_template: (messages: any[], options: any) => {
      model.templates.push(options.tools.map((t: any) => t.function.name));
      return { input_ids: { dims: [1, messages.length] } };
    },
  });
  const pipe = Object.assign(
    async (messages: any[], options: any) => {
      const last = messages.at(-1);
      let text = "";
      if (last.content.startsWith("Use the tool response")) {
        const tools = messages.filter((m) => m.role === "tool");
        model.consumed.push(tools);
        text = `Sources: ${tools.at(-1).content}`;
      } else {
        const call = model.scripts.get(last.content);
        text = call
          ? `<tool_call>${JSON.stringify(call)}</tool_call>`
          : "Local answer";
      }
      options.streamer.callback_function(text);
      return [{ generated_text: [{ role: "assistant", content: text }] }];
    },
    { tokenizer }
  );
  return {
    pipeline: async () => pipe,
    DynamicCache: class {
      dispose() {}
    },
    TextStreamer: class {
      callback_function: any;
      constructor(_t: any, o: any) {
        this.callback_function = o.callback_function;
      }
    },
  };
});
vi.mock("../src/background/utils/FeatureExtractor.ts", () => ({
  default: class {},
}));
vi.mock("../src/background/vectorHistory/VectorHistory.ts", () => ({
  default: class {
    findHistoryTool = { name: "find_history", execute: async () => "history" };
  },
}));

let settings: Record<string, unknown>;
let listener: (m: any, sender: any, reply: (r: any) => void) => boolean;
let storageListener: (changes: any, area: string) => void;
let requests: { url: string; headers: Headers; body: any }[];
let mode: "success" | "quota" | "toolError" | "malformed" | "hang";
let rules: any[];
let send: (type: string, args?: Record<string, unknown>) => Promise<any>;

beforeEach(async () => {
  vi.resetModules();
  settings = {};
  requests = [];
  rules = [];
  mode = "success";
  model.scripts.clear();
  model.templates.length = 0;
  model.consumed.length = 0;
  model.scripts.set("search", {
    name: "web_search",
    arguments: { query: "current browser documentation" },
  });
  model.scripts.set("fetch", {
    name: "web_fetch",
    arguments: {
      url: "https://example.com/source",
      objective: "Find the date",
    },
  });
  const event = () => ({ addListener: vi.fn() });
  vi.stubGlobal("chrome", {
    runtime: {
      id: "testextension",
      onMessage: {
        addListener: (fn: any) => {
          listener = fn;
        },
      },
      sendMessage: vi.fn(),
    },
    storage: {
      local: {
        get: vi.fn(async () => ({ ...settings })),
        set: vi.fn(async (values: any) => {
          Object.assign(settings, values);
        }),
      },
      onChanged: {
        addListener: (fn: any) => {
          storageListener = fn;
        },
      },
    },
    declarativeNetRequest: {
      RuleActionType: { MODIFY_HEADERS: "modifyHeaders" },
      HeaderOperation: { SET: "set" },
      ResourceType: { XMLHTTPREQUEST: "xmlhttprequest" },
      updateSessionRules: vi.fn(async (r: any) => {
        rules.push(r);
      }),
    },
    tabs: {
      onUpdated: event(),
      onActivated: event(),
      onRemoved: event(),
      create: vi.fn(),
      query: vi.fn(async () => []),
    },
    action: { onClicked: event() },
    sidePanel: { open: vi.fn() },
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: any, init: any) => {
      const body = init?.body ? JSON.parse(init.body) : null;
      requests.push({
        url: String(url),
        headers: new Headers(init?.headers),
        body,
      });
      if (!body) return new Response(null, { status: 405 });
      if (body.method.startsWith("notifications/"))
        return new Response(null, { status: 202 });
      const json = (result: unknown) =>
        new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }), {
          headers: { "Content-Type": "application/json" },
        });
      if (body.method === "initialize")
        return json({
          protocolVersion: body.params.protocolVersion,
          capabilities: { tools: {} },
          serverInfo: { name: "fixture", version: "1" },
        });
      if (body.method === "tools/list")
        return json({
          tools: ["web_search", "web_fetch"].map((name) => ({
            name,
            inputSchema: { type: "object" },
          })),
        });
      if (body.method === "tools/call") {
        if (mode === "hang")
          return new Promise<Response>((_resolve, reject) => {
            if (init.signal.aborted) reject(init.signal.reason);
            else
              init.signal.addEventListener(
                "abort",
                () => reject(init.signal.reason),
                { once: true }
              );
          });
        if (mode === "quota")
          return new Response("Anonymous free-tier quota exceeded", {
            status: 429,
            headers: { "Retry-After": "60" },
          });
        if (mode === "malformed")
          return new Response("not JSON", {
            headers: { "Content-Type": "application/json" },
          });
        return json({
          content: [
            {
              type: "text",
              text:
                mode === "toolError"
                  ? "Source unavailable"
                  : JSON.stringify({
                      results: [
                        {
                          title: "Browser documentation",
                          url: "https://example.com/source",
                          excerpts: ["Current source content"],
                        },
                      ],
                    }),
            },
          ],
          ...(mode === "toolError" ? { isError: true } : {}),
        });
      }
      throw new Error(`Unexpected MCP method ${body.method}`);
    })
  );
  const { BackgroundTasks } = await import("../src/shared/types.ts");
  let loaded = false;
  send = async (name, args = {}) => {
    if (!loaded) {
      await import("../src/background/background.ts");
      loaded = true;
    }
    return new Promise((resolve) =>
      listener({ type: (BackgroundTasks as any)[name], ...args }, {}, resolve)
    );
  };
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const calls = () => requests.filter((r) => r.body?.method === "tools/call");
const enable = async (tools?: string[]) =>
  send("AGENT_INITIALIZE", {
    allowRemoteSearch: true,
    ...(tools ? { tools } : {}),
  });

describe("Parallel through the background agent caller", () => {
  it("keeps a fresh no-key installation network-inert before informed consent", async () => {
    const r = await send("AGENT_GENERATE_TEXT", { prompt: "search" });
    expect(r.status).toBe(1);
    expect(requests).toEqual([]);
    expect(rules).toEqual([]);
    expect(model.templates[0]).not.toContain("web_search");
    expect(settings.allowRemoteSearch).not.toBe(true);
  });

  it("uses the anonymous default after consent, consumes sources, and keeps search/fetch/follow-up IDs", async () => {
    await enable();
    for (const prompt of ["search", "fetch", "search"]) {
      expect((await send("AGENT_GENERATE_TEXT", { prompt })).status).toBe(0);
    }
    expect(calls()).toHaveLength(3);
    const ids = calls().map((r) => r.body.params.arguments.session_id);
    expect(new Set(ids).size).toBe(1);
    expect(ids[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(calls()[1].body.params.arguments.urls).toEqual([
      "https://example.com/source",
    ]);
    expect(calls()[0].body.params.arguments.search_queries).toEqual([
      "current browser documentation",
    ]);
    expect(calls()[0].body.params.arguments.model_name).toBe(
      "onnx-community/gemma-4-E2B-it-ONNX"
    );
    expect(model.consumed.at(-1).at(-1).content).toContain(
      "https://example.com/source"
    );
    const messages = await send("AGENT_GET_MESSAGES");
    expect(messages.messages.at(-1).content).toContain(
      "Current source content"
    );
    for (const r of requests) {
      expect(r.url).toBe("https://search.parallel.ai/mcp");
      expect(r.headers.get("User-Agent")).toContain(
        "gemma4-browser-extension/0.2.1"
      );
      expect(r.headers.has("Authorization")).toBe(false);
    }
    expect(rules[0].addRules[0].condition.initiatorDomains).toEqual([
      "testextension",
    ]);
    expect(rules[0].addRules[0].condition.regexFilter).toBe(
      "^https://search\\.parallel\\.ai/mcp$"
    );
    const options = vi.mocked(fetch).mock.calls[0][1];
    expect(options?.credentials).toBe("omit");
    expect(options?.redirect).toBe("error");
  });

  it("restores saved choices and honors [] and explicit overrides", async () => {
    settings = { allowRemoteSearch: true, activeTools: [] };
    expect(
      (await send("AGENT_GENERATE_TEXT", { prompt: "search" })).status
    ).toBe(1);
    expect(requests).toHaveLength(0);
    await enable(["web_fetch"]);
    expect(
      (await send("AGENT_GENERATE_TEXT", { prompt: "search" })).status
    ).toBe(1);
    expect(
      (await send("AGENT_GENERATE_TEXT", { prompt: "fetch" })).status
    ).toBe(0);
    expect(calls().map((r) => r.body.params.name)).toEqual(["web_fetch"]);
  });

  it("never interprets a saved remote tool or broad host permissions as consent", async () => {
    settings = { activeTools: ["web_search"] };
    expect(
      (await send("AGENT_GENERATE_TEXT", { prompt: "search" })).status
    ).toBe(1);
    expect(requests).toHaveLength(0);
  });

  it("clear starts a new ID and quota retry keeps the old ID without automatic retry", async () => {
    await enable();
    mode = "quota";
    expect(
      (await send("AGENT_GENERATE_TEXT", { prompt: "search" })).status
    ).toBe(0);
    expect(calls()).toHaveLength(1);
    expect(model.consumed.at(-1).at(-1).content).toContain("quota exceeded");
    const first = calls()[0].body.params.arguments.session_id;
    mode = "success";
    await send("AGENT_GENERATE_TEXT", { prompt: "search" });
    expect(calls()[1].body.params.arguments.session_id).toBe(first);
    await send("AGENT_CLEAR");
    await send("AGENT_GENERATE_TEXT", { prompt: "search" });
    expect(calls()[2].body.params.arguments.session_id).not.toBe(first);
  });

  it.each(["toolError", "malformed"] as const)(
    "surfaces %s to the result consumer without fallback",
    async (errorMode) => {
      await enable();
      mode = errorMode;
      expect(
        (await send("AGENT_GENERATE_TEXT", { prompt: "search" })).status
      ).toBe(0);
      expect(calls()).toHaveLength(1);
      expect(model.consumed.at(-1).at(-1).content).toContain("failed");
    }
  );

  it("returns timeout errors and aborts the HTTP request", async () => {
    await enable();
    mode = "hang";
    vi.useFakeTimers();
    const run = send("AGENT_GENERATE_TEXT", { prompt: "search" });
    await vi.advanceTimersByTimeAsync(30_001);
    expect((await run).status).toBe(0);
    expect(model.consumed.at(-1).at(-1).content).toContain("timed out");
    expect(calls()).toHaveLength(1);
  });

  it("cancels in-flight requests on clear without stale results in the new chat", async () => {
    await enable();
    mode = "hang";
    const run = send("AGENT_GENERATE_TEXT", { prompt: "search" });
    await vi.waitFor(() => expect(calls()).toHaveLength(1));
    await send("AGENT_CLEAR");
    expect((await run).status).toBe(1);
    expect((await send("AGENT_GET_MESSAGES")).messages).toEqual([]);
  });

  it("revokes consent during a request and cancels it", async () => {
    await enable();
    mode = "hang";
    const run = send("AGENT_GENERATE_TEXT", { prompt: "search" });
    await vi.waitFor(() => expect(calls()).toHaveLength(1));
    settings.allowRemoteSearch = false;
    storageListener(
      { allowRemoteSearch: { oldValue: true, newValue: false } },
      "local"
    );
    expect((await run).status).toBe(1);
    expect(calls()).toHaveLength(1);
  });

  it("validates URLs and empty queries before contacting MCP", async () => {
    await enable();
    for (const url of [
      "javascript:alert(1)",
      "file:///secret",
      "https://user:pass@example.com/",
      "bad URL",
    ]) {
      model.scripts.set("bad", { name: "web_fetch", arguments: { url } });
      expect(
        (await send("AGENT_GENERATE_TEXT", { prompt: "bad" })).status
      ).toBe(0);
    }
    model.scripts.set("empty", {
      name: "web_search",
      arguments: { query: "  " },
    });
    await send("AGENT_GENERATE_TEXT", { prompt: "empty" });
    expect(requests).toHaveLength(0);
  });

  it("isolates interleaved conversations using the same tool objects", async () => {
    settings.allowRemoteSearch = true;
    const { default: Agent } = await import("../src/background/agent/Agent.ts");
    const { webSearchTool, webFetchTool } =
      await import("../src/background/tools/parallelSearch.ts");
    const a = new Agent();
    const b = new Agent();
    for (const agent of [a, b]) {
      agent.setTool(webSearchTool);
      agent.setTool(webFetchTool);
    }
    await Promise.all([a.runAgent("search"), b.runAgent("fetch")]);
    const first = calls().find((r) => r.body.params.name === "web_search")!.body
      .params.arguments.session_id;
    const second = calls().find((r) => r.body.params.name === "web_fetch")!.body
      .params.arguments.session_id;
    expect(first).not.toBe(second);
    await Promise.all([a.runAgent("fetch"), b.runAgent("search")]);
    expect(calls()[2].body.params.arguments.session_id).toBe(first);
    expect(calls()[3].body.params.arguments.session_id).toBe(second);
  });
});
