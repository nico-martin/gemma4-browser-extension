import type { ToolName, ToolResult } from "@/shared/types";
import { askWebsite } from "./askWebsite";
import { closeTab } from "./closeTab";
import { getCurrentTabInfo } from "./getCurrentTabInfo";
import { getOpenTabs } from "./getOpenTabs";
import { goToTab } from "./goToTab";
import { openUrl } from "./openUrl";
import { searchCanLII } from "./searchCanLII";
import { searchLegifrance } from "./searchLegifrance";

type ToolFn = (args: Record<string, unknown>) => Promise<ToolResult>;

export const tools: Record<ToolName, ToolFn> = {
  ask_website: (a) => askWebsite(a as Parameters<typeof askWebsite>[0]),
  close_tab: (a) => closeTab(a as Parameters<typeof closeTab>[0]),
  get_current_tab_info: () => getCurrentTabInfo(),
  get_open_tabs: () => getOpenTabs(),
  go_to_tab: (a) => goToTab(a as Parameters<typeof goToTab>[0]),
  open_url: (a) => openUrl(a as Parameters<typeof openUrl>[0]),
  search_canlii: (a) => searchCanLII(a as Parameters<typeof searchCanLII>[0]),
  search_legifrance: (a) =>
    searchLegifrance(a as Parameters<typeof searchLegifrance>[0]),
};

export async function invokeTool(name: ToolName, args: Record<string, unknown>): Promise<ToolResult> {
  const fn = tools[name];
  if (!fn) return { ok: false, content: "", error: `Unknown tool: ${name}` };
  try {
    return await fn(args);
  } catch (e) {
    return { ok: false, content: "", error: (e as Error).message };
  }
}
