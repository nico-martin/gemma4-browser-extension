import { useState } from "react";

import { AvailableTools, ToolName } from "../../shared/tools.ts";
import {
  BackgroundTasks,
  ResponseStatus,
  WebMCPToolSummary,
} from "../../shared/types.ts";
import { Button, Modal } from "../theme";
import cn from "../utils/classnames.ts";

interface ChatToolsModalProps {
  activeTools: ToolName[];
  pageTools: WebMCPToolSummary[];
  onClose: () => void;
  onSubmit: (tools: ToolName[]) => void;
}

const toolMetadata: Record<ToolName, { label: string; description: string }> = {
  [AvailableTools.GET_OPEN_TABS]: {
    label: "Get Open Tabs",
    description: "List all currently open browser tabs",
  },
  [AvailableTools.GO_TO_TAB]: {
    label: "Go to Tab",
    description: "Navigate to a specific tab",
  },
  [AvailableTools.OPEN_URL]: {
    label: "Open URL",
    description: "Open a new URL in a tab",
  },
  [AvailableTools.CLOSE_TAB]: {
    label: "Close Tab",
    description: "Close a specific tab",
  },
  [AvailableTools.FIND_HISTORY]: {
    label: "Find History",
    description: "Search browsing history with semantic search",
  },
  [AvailableTools.ASK_WEBSITE]: {
    label: "Ask Website",
    description: "Extract and analyze website content",
  },
  [AvailableTools.HIGHLIGHT_WEBSITE_ELEMENT]: {
    label: "Highlight Website Element",
    description: "Highlight elements on a webpage",
  },
};

type Tab = "builtin" | "page";

export default function ChatToolsModal({
  activeTools,
  pageTools,
  onClose,
  onSubmit,
}: ChatToolsModalProps) {
  const [selectedTools, setSelectedTools] = useState<Set<ToolName>>(
    new Set(activeTools)
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>("builtin");

  const handleToggle = (tool: ToolName) => {
    const newSelected = new Set(selectedTools);
    if (newSelected.has(tool)) {
      newSelected.delete(tool);
    } else {
      newSelected.add(tool);
    }
    setSelectedTools(newSelected);
  };

  const handleSubmit = () => {
    setIsSubmitting(true);

    const toolsArray = Array.from(selectedTools);

    chrome.runtime.sendMessage(
      {
        type: BackgroundTasks.AGENT_INITIALIZE,
        tools: toolsArray,
      },
      (response) => {
        setIsSubmitting(false);
        if (response.status === ResponseStatus.SUCCESS) {
          onSubmit(toolsArray);
        } else {
          alert("Failed to initialize agent with selected tools");
        }
      }
    );
  };

  const tabClass = (tab: Tab) =>
    cn(
      "px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
      activeTab === tab
        ? "border-chrome-accent-primary text-chrome-text-primary"
        : "border-transparent text-chrome-text-secondary hover:text-chrome-text-primary"
    );

  return (
    <Modal title="Configure Tools" onClose={onClose}>
      <div className="space-y-4">
        <div className="flex items-center gap-2 border-b border-chrome-border">
          <button type="button" className={tabClass("builtin")} onClick={() => setActiveTab("builtin")}>
            Built-in
          </button>
          <button type="button" className={tabClass("page")} onClick={() => setActiveTab("page")}>
            Page tools{pageTools.length > 0 ? ` (${pageTools.length})` : ""}
          </button>
        </div>

        {activeTab === "builtin" && (
          <>
            <p className="text-sm text-chrome-text-secondary">
              Select which tools the agent can use. Changes will reset the current
              conversation.
            </p>

            <div className="space-y-3 overflow-y-auto max-h-96">
              {Object.values(AvailableTools).map((tool) => {
                const metadata = toolMetadata[tool];
                return (
                  <div
                    key={tool}
                    className="flex items-start gap-3 rounded-lg border border-chrome-border p-3"
                  >
                    <input
                      type="checkbox"
                      id={tool}
                      checked={selectedTools.has(tool)}
                      onChange={() => handleToggle(tool)}
                      className="mt-1 h-4 w-4 cursor-pointer rounded border transition-colors focus:ring-2 focus:ring-offset-2 focus:outline-none bg-chrome-bg-primary border-chrome-border text-chrome-accent-primary focus:border-chrome-accent-primary focus:ring-chrome-accent-primary focus:ring-offset-chrome-bg-primary"
                    />
                    <label htmlFor={tool} className="flex-1 cursor-pointer">
                      <div className="text-sm font-medium text-chrome-text-primary">
                        {metadata.label}
                      </div>
                      <div className="text-xs text-chrome-text-secondary mt-1">
                        {metadata.description}
                      </div>
                    </label>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {activeTab === "page" && (
          <>
            <p className="text-sm text-chrome-text-secondary">
              Tools the current page registered via WebMCP. These are always
              available to the agent and are not affected by built-in tool
              selection.
            </p>

            {pageTools.length === 0 ? (
              <div className="rounded-lg border border-chrome-border p-4 text-sm text-chrome-text-secondary">
                No WebMCP tools on this page.
              </div>
            ) : (
              <ul className="space-y-2 overflow-y-auto max-h-96">
                {pageTools.map((tool) => (
                  <li
                    key={tool.name}
                    className="rounded-lg border border-chrome-border p-3"
                  >
                    <div className="text-sm font-medium text-chrome-text-primary">
                      {tool.name}
                    </div>
                    {tool.description && (
                      <div className="text-xs text-chrome-text-secondary mt-1">
                        {tool.description}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        <div className="flex justify-end gap-2 pt-4 border-t border-chrome-border">
          <Button
            type="button"
            variant="ghost"
            color="secondary"
            onClick={onClose}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="solid"
            color="primary"
            onClick={handleSubmit}
            disabled={isSubmitting || activeTab !== "builtin"}
            loading={isSubmitting}
          >
            Apply Changes
          </Button>
        </div>
      </div>
    </Modal>
  );
}
