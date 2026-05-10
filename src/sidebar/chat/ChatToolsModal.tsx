import { useState } from "react";

import { AvailableTools, ToolName } from "../../shared/tools.ts";
import { BackgroundTasks, ResponseStatus } from "../../shared/types.ts";
import { Button, Modal } from "../theme";

interface ChatToolsModalProps {
  activeTools: ToolName[];
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

export default function ChatToolsModal({
  activeTools,
  onClose,
  onSubmit,
}: ChatToolsModalProps) {
  const [selectedTools, setSelectedTools] = useState<Set<ToolName>>(
    new Set(activeTools)
  );
  const [isSubmitting, setIsSubmitting] = useState(false);

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

    // Send AGENT_INITIALIZE with selected tools
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

  return (
    <Modal title="Configure Tools" onClose={onClose}>
      <div className="flex flex-col h-full max-h-screen w-full mb-10">
        {/* Header / Description */}
        <div className="shrink-0 p-4 border-b border-chrome-border">
          <p className="text-sm text-chrome-text-secondary">
            Select which tools the agent can use. Changes will reset the current
            conversation.
          </p>
        </div>

        {/* Scrollable Tools Section */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 scrollbar-thin">
          {Object.values(AvailableTools).map((tool) => {
            const metadata = toolMetadata[tool];

            return (
              <div
                key={tool}
                className="flex items-start gap-3 rounded-lg border border-chrome-border p-3 
                     bg-chrome-bg-primary hover:bg-chrome-bg-secondary transition"
              >
                <input
                  type="checkbox"
                  id={tool}
                  checked={selectedTools.has(tool)}
                  onChange={() => handleToggle(tool)}
                  className="mt-1 h-4 w-4 cursor-pointer rounded border 
                       bg-chrome-bg-primary border-chrome-border
                       text-chrome-accent-primary
                       focus:ring-2 focus:ring-chrome-accent-primary
                       focus:ring-offset-2 focus:ring-offset-chrome-bg-primary"
                />

                <label htmlFor={tool} className="flex-1 cursor-pointer">
                  <div className="text-sm font-medium text-chrome-text-primary">
                    {metadata.label}
                  </div>

                  <div className="mt-1 text-xs text-chrome-text-secondary">
                    {metadata.description}
                  </div>
                </label>
              </div>
            );
          })}
        </div>

        {/* Footer Buttons */}
        <div className="shrink-0 border-t border-chrome-border p-4 bg-chrome-bg-primary">
          <div className="flex flex-col sm:flex-row justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              color="secondary"
              onClick={onClose}
              disabled={isSubmitting}
              className="w-full sm:w-auto"
            >
              Cancel
            </Button>

            <Button
              type="button"
              variant="solid"
              color="primary"
              onClick={handleSubmit}
              disabled={isSubmitting}
              loading={isSubmitting}
              className="w-full sm:w-auto"
            >
              Apply Changes
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
