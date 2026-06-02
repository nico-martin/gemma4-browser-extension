import DOMPurify from "dompurify";
import showdown from "showdown";

import { type AgentMetrics, type ChatMessageTool } from "../../shared/types.ts";
import { Loader } from "../theme";
import MessageToolCall from "./MessageToolCall.tsx";

const converter = new showdown.Converter();

export default function MessageContent({
  content,
  tools = [],
  metrics,
}: {
  content: string;
  tools: Array<ChatMessageTool>;
  metrics: AgentMetrics;
}) {
  const showMetrics = metrics.tokensPerSecond > 0;
  const sanitizedHtml = DOMPurify.sanitize(converter.makeHtml(content));

  return (
    <div className="space-y-3">
      {tools && tools.length > 0 && <MessageToolCall tools={tools} />}
      {content ? (
        <>
          <div
            className="prose prose-invert prose-li:text-sm prose-headings:text-sm prose-p:text-sm prose-headings:font-semibold prose-p:my-2 prose-ul:my-2 prose-li:my-0 prose-hr:my-4 max-w-none break-words overflow-wrap-anywhere"
            dangerouslySetInnerHTML={{
              __html: sanitizedHtml,
            }}
          />
          {showMetrics && (
            <p className="text-[10px] text-right text-chrome-text-secondary">
              {metrics.tokensPerSecond.toFixed(2)} tok/s
            </p>
          )}
        </>
      ) : (
        <p className="flex items-center gap-3">
          <Loader size="sm" /> loading..
        </p>
      )}
    </div>
  );
}
