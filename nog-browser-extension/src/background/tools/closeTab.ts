import type { ToolResult } from "@/shared/types";

export async function closeTab(args: { tabId: number }): Promise<ToolResult> {
  if (!Number.isInteger(args.tabId)) {
    return { ok: false, content: "", error: "Invalid tabId" };
  }
  await chrome.tabs.remove(args.tabId);
  return { ok: true, content: `Closed tab ${args.tabId}` };
}
