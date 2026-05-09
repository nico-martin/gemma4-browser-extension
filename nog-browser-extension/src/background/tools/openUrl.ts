import type { ToolResult } from "@/shared/types";

export async function openUrl(args: { url: string; active?: boolean }): Promise<ToolResult> {
  if (!args.url || !/^https?:\/\//i.test(args.url)) {
    return { ok: false, content: "", error: "Invalid URL" };
  }
  const tab = await chrome.tabs.create({ url: args.url, active: args.active ?? false });
  return { ok: true, content: JSON.stringify({ tabId: tab.id, url: tab.url }) };
}

export async function waitForTabComplete(tabId: number, timeoutMs = 10_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error("Timeout waiting for tab to load"));
    }, timeoutMs);
    const listener = (id: number, info: chrome.tabs.TabChangeInfo) => {
      if (id === tabId && info.status === "complete") {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}
