import type { ToolResult } from "@/shared/types";
import { ContentTasks } from "@/shared/messages";

const MAX_CHARS = 2000;

interface ExtractedPart {
  id: string;
  tagName: string;
  sectionId: string;
  content: string;
}

interface ExtractedPage {
  parts: ExtractedPart[];
  title: string;
  url: string;
}

export async function askWebsite(args: { query?: string; tabId?: number }): Promise<ToolResult> {
  const tabId =
    args.tabId ??
    (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0]?.id;
  if (!tabId) return { ok: false, content: "", error: "No active tab" };

  let page: ExtractedPage;
  try {
    page = await chrome.tabs.sendMessage(tabId, { type: ContentTasks.EXTRACT_PAGE });
  } catch (e) {
    return { ok: false, content: "", error: `Content script unreachable: ${(e as Error).message}` };
  }

  const filterTerms = (args.query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const ranked = page.parts
    .map((p) => ({
      part: p,
      score: filterTerms.length === 0 ? 0 : score(p.content.toLowerCase(), filterTerms),
    }))
    .sort((a, b) => b.score - a.score)
    .map(({ part }) => part);

  let totalChars = 0;
  const picked: ExtractedPart[] = [];
  for (const p of ranked) {
    if (totalChars + p.content.length > MAX_CHARS) {
      const remaining = MAX_CHARS - totalChars;
      if (remaining > 80) picked.push({ ...p, content: p.content.slice(0, remaining) + "…" });
      break;
    }
    picked.push(p);
    totalChars += p.content.length;
  }
  return {
    ok: true,
    content: JSON.stringify({ title: page.title, url: page.url, parts: picked }),
  };
}

function score(text: string, terms: string[]): number {
  let s = 0;
  for (const t of terms) if (text.includes(t)) s += 1;
  return s;
}
