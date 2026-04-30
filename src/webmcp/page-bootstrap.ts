import { initializeWebMCPPolyfill } from "@mcp-b/webmcp-polyfill";

initializeWebMCPPolyfill();

const testing = (navigator as any).modelContextTesting as
  | {
      listTools?: () => Array<unknown>;
      executeTool?: (name: string, argsJson: string) => Promise<unknown>;
      registerToolsChangedCallback?: (cb: () => void) => void;
    }
  | undefined;

function send(type: string, detail: unknown) {
  window.dispatchEvent(new CustomEvent(type, { detail }));
}

window.addEventListener("webmcp:list-request", () => {
  const tools = testing?.listTools?.() ?? [];
  send("webmcp:list-response", tools);
});

window.addEventListener("webmcp:call-request", async (e: Event) => {
  const { id, name, args } = (e as CustomEvent).detail;
  try {
    if (!testing?.executeTool) {
      throw new Error("modelContextTesting.executeTool is not available");
    }
    const result = await testing.executeTool(name, JSON.stringify(args ?? {}));
    send("webmcp:call-response", { id, ok: true, result });
  } catch (err) {
    send("webmcp:call-response", {
      id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

testing?.registerToolsChangedCallback?.(() => {
  const tools = testing?.listTools?.() ?? [];
  send("webmcp:tools-changed", tools);
});
