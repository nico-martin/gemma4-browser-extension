import type { TabInfo, ToolResult } from "@/shared/types";

export async function getCurrentTabInfo(): Promise<ToolResult> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab || tab.id === undefined) {
    return { ok: false, content: "", error: "No active tab" };
  }
  let hostname: string | undefined;
  try {
    hostname = tab.url ? new URL(tab.url).hostname : undefined;
  } catch {
    hostname = undefined;
  }
  const info: TabInfo = {
    id: tab.id,
    title: tab.title ?? "",
    url: tab.url ?? "",
    active: !!tab.active,
    hostname,
  };
  return { ok: true, content: JSON.stringify(info) };
}
