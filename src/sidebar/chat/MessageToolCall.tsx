import { Ban, Check, ChevronLeft, ChevronRight, Wrench } from "lucide-react";
import { useState } from "react";

import { getToolLabel } from "../../shared/tools.ts";
import {
  ChatMessageTool,
  ToolPermissionDecision,
} from "../../shared/types.ts";
import { Loader } from "../theme";
import cn from "../utils/classnames.ts";

const statusLabel: Record<ChatMessageTool["status"], string> = {
  pending_permission: "approve tool call",
  running: "calling tool",
  completed: "called tool",
  denied: "denied tool",
};

export default function MessageToolCall({
  tools,
  onPermissionDecision,
  className = "",
}: {
  tools: Array<ChatMessageTool>;
  onPermissionDecision: (
    toolCallId: string,
    decision: ToolPermissionDecision
  ) => void;
  className?: string;
}) {
  const [currentToolIndex, setCurrentToolIndex] = useState(0);
  const [expanded, setExpanded] = useState<boolean>(false);

  const goToPrevious = () => {
    setCurrentToolIndex((prev) => (prev > 0 ? prev - 1 : tools.length - 1));
  };

  const goToNext = () => {
    setCurrentToolIndex((prev) => (prev < tools.length - 1 ? prev + 1 : 0));
  };

  const activeTool = tools[currentToolIndex];
  const isLoading = activeTool.status === "running";
  const isPending = activeTool.status === "pending_permission";
  const isDenied = activeTool.status === "denied";

  return (
    <div
      className={cn(
        className,
        "border border-chrome-border rounded bg-chrome-bg-tertiary p-3"
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <button
          className="flex items-center gap-2 text-xs cursor-pointer"
          onClick={() => setExpanded(!expanded)}
        >
          {isLoading ? (
            <Loader size="xs" />
          ) : isDenied ? (
            <Ban className="h-3 w-3 text-chrome-text-secondary" />
          ) : (
            <Wrench className="h-3 w-3" />
          )}
          {statusLabel[activeTool.status]}{" "}
          <b>{getToolLabel(activeTool.name)}</b>
        </button>
        {tools.length > 1 && (
          <div className="flex items-center gap-1">
            <button
              onClick={goToPrevious}
              disabled={currentToolIndex === 0}
              className={cn(
                "p-1 rounded transition-colors cursor-pointer",
                "hover:bg-chrome-hover text-chrome-text-primary"
              )}
              aria-label="Previous tool"
            >
              <ChevronLeft className="h-3 w-3" />
            </button>
            <div className="text-xs text-chrome-text-secondary">
              {currentToolIndex + 1} / {tools.length}
            </div>
            <button
              onClick={goToNext}
              disabled={currentToolIndex === tools.length - 1}
              className={cn(
                "p-1 rounded transition-colors cursor-pointer",
                "hover:bg-chrome-hover text-chrome-text-primary"
              )}
              aria-label="Next tool"
            >
              <ChevronRight className="h-3 w-3" />
            </button>
          </div>
        )}
      </div>
      {isPending && (
        <div className="mt-3 space-y-2">
          <code className="text-xs bg-chrome-bg-primary px-2 py-1 rounded block text-chrome-accent-primary font-mono overflow-hidden">
            {activeTool.functionSignature}
          </code>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() =>
                onPermissionDecision(activeTool.id, "allow_once")
              }
              className="inline-flex items-center gap-1 rounded bg-chrome-accent-primary px-2.5 py-1 text-xs font-medium text-chrome-bg-primary hover:bg-chrome-accent-hover cursor-pointer"
            >
              <Check className="h-3 w-3" /> Allow once
            </button>
            <button
              onClick={() =>
                onPermissionDecision(activeTool.id, "always_allow")
              }
              className="inline-flex items-center gap-1 rounded border border-chrome-accent-primary px-2.5 py-1 text-xs font-medium text-chrome-accent-primary hover:bg-chrome-hover cursor-pointer"
            >
              Always allow {getToolLabel(activeTool.name)}
            </button>
            <button
              onClick={() => onPermissionDecision(activeTool.id, "deny")}
              className="inline-flex items-center gap-1 rounded border border-chrome-border px-2.5 py-1 text-xs font-medium text-chrome-text-secondary hover:bg-chrome-hover cursor-pointer"
            >
              <Ban className="h-3 w-3" /> Deny
            </button>
          </div>
        </div>
      )}
      {expanded && (
        <div className="space-y-2 mt-2">
          <div>
            <div className="text-xs text-chrome-text-secondary mb-1">
              Function:
            </div>
            <code className="text-xs bg-chrome-bg-primary px-2 py-1 rounded block text-chrome-accent-primary font-mono overflow-hidden">
              {tools[currentToolIndex].functionSignature}
            </code>
          </div>
          <div>
            <div className="text-xs text-chrome-text-secondary mb-1">
              Result:
            </div>
            <div className="text-xs bg-chrome-bg-primary px-2 py-1 rounded text-chrome-text-primary overflow-hidden">
              {tools[currentToolIndex].result || "loading.."}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
