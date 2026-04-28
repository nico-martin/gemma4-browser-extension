import { memo } from "react";
import showdown from "showdown";

import {
  type AgentMetrics,
  type ChatMessageTool,
  type ToolPermissionDecision,
} from "../../shared/types.ts";
import { Loader } from "../theme";
import MessageToolCall from "./MessageToolCall.tsx";

const converter = new showdown.Converter();

function MessageContent({
  content,
  tools = [],
  metrics,
  onPermissionDecision,
}: {
  content: string;
  tools: Array<ChatMessageTool>;
  metrics: AgentMetrics;
  onPermissionDecision: (
    toolCallId: string,
    decision: ToolPermissionDecision
  ) => void;
}) {
  const showMetrics = metrics.tokensPerSecond > 0;

  return (
    <div className="space-y-3">
      {tools && tools.length > 0 && (
        <MessageToolCall
          tools={tools}
          onPermissionDecision={onPermissionDecision}
        />
      )}
      {Boolean(content) ? (
        <>
          <div
            className="prose prose-invert prose-li:text-sm prose-headings:text-sm prose-p:text-sm prose-headings:font-semibold prose-p:my-2 prose-ul:my-2 prose-li:my-0 prose-hr:my-4 max-w-none break-words overflow-wrap-anywhere"
            dangerouslySetInnerHTML={{
              __html: converter.makeHtml(content),
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

// Chrome IPC structurally clones messages, so every token gives identical-by-value
// but different-by-reference props. Compare by value to avoid re-renders that
// would replay dangerouslySetInnerHTML and wipe the user's text selection.
export default memo(MessageContent, (prev, next) => {
  if (prev.content !== next.content) return false;
  if (prev.onPermissionDecision !== next.onPermissionDecision) return false;
  if (prev.metrics.tokensPerSecond !== next.metrics.tokensPerSecond)
    return false;
  if (prev.tools.length !== next.tools.length) return false;
  for (let i = 0; i < prev.tools.length; i++) {
    const a = prev.tools[i];
    const b = next.tools[i];
    if (
      a.id !== b.id ||
      a.status !== b.status ||
      a.result !== b.result ||
      a.functionSignature !== b.functionSignature
    )
      return false;
  }
  return true;
});
