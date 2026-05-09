import type { ToolResult } from "@/shared/types";
import { openUrl, waitForTabComplete } from "./openUrl";
import { askWebsite } from "./askWebsite";
import { closeTab } from "./closeTab";

export async function searchCanLII(args: {
  query: string;
  jurisdiction?: string;
  closeAfter?: boolean;
}): Promise<ToolResult> {
  if (!args.query?.trim()) {
    return { ok: false, content: "", error: "query is required" };
  }
  const params = new URLSearchParams({ search_mode: "all", text: args.query });
  if (args.jurisdiction) params.set("jId", args.jurisdiction);
  const url = `https://www.canlii.org/en/search/?${params.toString()}`;

  const open = await openUrl({ url, active: false });
  if (!open.ok) return open;
  const { tabId } = JSON.parse(open.content) as { tabId: number };

  try {
    await waitForTabComplete(tabId, 12_000);
  } catch (e) {
    if (args.closeAfter !== false) await closeTab({ tabId }).catch(() => undefined);
    return { ok: false, content: "", error: (e as Error).message };
  }

  const extract = await askWebsite({ tabId, query: args.query });
  if (args.closeAfter !== false) await closeTab({ tabId }).catch(() => undefined);
  return extract;
}
