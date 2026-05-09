import type { TabInfo, ToolResult } from "@/shared/types";

const MAX_TABS = 25;

export async function getOpenTabs(): Promise<ToolResult> {
  const tabs = await chrome.tabs.query({});
  const trimmed: TabInfo[] = tabs.slice(0, MAX_TABS).map((t) => ({
    id: t.id ?? -1,
    title: t.title ?? "",
    url: t.url ?? "",
    active: !!t.active,
  }));
  const truncated = tabs.length > MAX_TABS;
  return {
    ok: true,
    content: JSON.stringify({ tabs: trimmed, total: tabs.length, truncated }),
  };
}
