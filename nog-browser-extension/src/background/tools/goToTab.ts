import type { ToolResult } from "@/shared/types";

export async function goToTab(args: { tabId: number }): Promise<ToolResult> {
  if (!Number.isInteger(args.tabId)) {
    return { ok: false, content: "", error: "Invalid tabId" };
  }
  await chrome.tabs.update(args.tabId, { active: true });
  return { ok: true, content: `Switched to tab ${args.tabId}` };
}
