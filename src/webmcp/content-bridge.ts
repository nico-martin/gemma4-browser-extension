type CallResolver = (response: { ok: boolean; result?: unknown; error?: string }) => void;

interface PendingCall {
  resolve: CallResolver;
  timeoutId: ReturnType<typeof setTimeout>;
}

const PENDING_CALL_TIMEOUT_MS = 30_000;
const pendingCalls = new Map<string, PendingCall>();

function makeId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function settlePendingCall(
  id: string,
  response: { ok: boolean; result?: unknown; error?: string }
) {
  const pending = pendingCalls.get(id);
  if (!pending) return;
  pendingCalls.delete(id);
  clearTimeout(pending.timeoutId);
  pending.resolve(response);
}

function pushTools(tools: unknown) {
  // Best-effort: the background service worker may be inactive during
  // navigation or extension reload, in which case the call rejects with
  // "Could not establish connection." We retry on the next push.
  chrome.runtime.sendMessage({ type: "webmcp:tools", tools }).catch(() => {});
}

window.addEventListener("webmcp:list-response", (e: Event) => {
  pushTools((e as CustomEvent).detail);
});

window.addEventListener("webmcp:tools-changed", (e: Event) => {
  pushTools((e as CustomEvent).detail);
});

window.addEventListener("webmcp:call-response", (e: Event) => {
  const { id, ok, result, error } = (e as CustomEvent).detail;
  settlePendingCall(id, ok ? { ok, result } : { ok, error });
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "webmcp:request-list") {
    window.dispatchEvent(new CustomEvent("webmcp:list-request"));
    sendResponse({ ok: true });
    return false;
  }
  if (msg?.type === "webmcp:call") {
    const id = makeId();
    // If the page never responds (navigates away, listener removed, hangs),
    // free the entry and resolve the SW's sendMessage so the agent doesn't
    // wait forever.
    const timeoutId = setTimeout(() => {
      settlePendingCall(id, {
        ok: false,
        error: `Timed out waiting for page tool '${msg.name}'`,
      });
    }, PENDING_CALL_TIMEOUT_MS);
    pendingCalls.set(id, { resolve: sendResponse, timeoutId });
    window.dispatchEvent(
      new CustomEvent("webmcp:call-request", {
        detail: { id, name: msg.name, args: msg.args },
      })
    );
    return true;
  }
  return false;
});

window.dispatchEvent(new CustomEvent("webmcp:list-request"));
