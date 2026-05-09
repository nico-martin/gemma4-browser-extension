import { ContentTasks } from "@/shared/messages";

interface Part {
  id: string;
  tagName: string;
  sectionId: string;
  content: string;
}

const HIGHLIGHT_CLASS = "__nog_highlight__";
let highlighted: HTMLElement | null = null;

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  switch (message.type) {
    case ContentTasks.EXTRACT_PAGE:
      sendResponse(extractPage());
      break;
    case ContentTasks.HIGHLIGHT_ELEMENT:
      sendResponse(highlight(message.payload as { id: string }));
      break;
    case ContentTasks.CLEAR_HIGHLIGHTS:
      sendResponse(clearHighlights());
      break;
    default:
      sendResponse({ ok: false, error: `Unknown content task: ${message.type}` });
  }
  return true;
});

function extractPage(): { parts: Part[]; title: string; url: string } {
  const parts: Part[] = [];
  const blocks = document.querySelectorAll("h1, h2, h3, h4, h5, h6, p");
  let sectionId = "0";
  let partCounter = 0;
  blocks.forEach((el) => {
    const tag = el.tagName.toLowerCase();
    if (/^h[1-6]$/.test(tag)) {
      sectionId = String(parts.length);
    }
    const text = (el as HTMLElement).innerText.trim();
    if (!text) return;
    const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
    sentences.forEach((s) => {
      partCounter += 1;
      parts.push({
        id: `${sectionId}-${partCounter}`,
        tagName: tag,
        sectionId,
        content: s,
      });
    });
  });
  return { parts, title: document.title, url: location.href };
}

function highlight(payload: { id: string }): { ok: boolean } {
  clearHighlights();
  const el = document.querySelector<HTMLElement>(`[data-nog-id="${payload.id}"]`);
  if (!el) return { ok: false };
  el.classList.add(HIGHLIGHT_CLASS);
  el.style.backgroundColor = "yellow";
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  highlighted = el;
  return { ok: true };
}

function clearHighlights(): { ok: true } {
  if (highlighted) {
    highlighted.classList.remove(HIGHLIGHT_CLASS);
    highlighted.style.backgroundColor = "";
    highlighted = null;
  }
  return { ok: true };
}
