import type { ToolResult } from "@/shared/types";
import { openUrl, waitForTabComplete } from "./openUrl";
import { askWebsite } from "./askWebsite";
import { closeTab } from "./closeTab";

export async function searchLegifrance(args: {
  query: string;
  closeAfter?: boolean;
}): Promise<ToolResult> {
  if (!args.query?.trim()) {
    return { ok: false, content: "", error: "query is required" };
  }
  const url = `https://www.legifrance.gouv.fr/search/all?query=${encodeURIComponent(args.query)}`;
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
