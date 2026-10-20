import { useState } from "react";

import { AvailableTools, ToolName, isRemoteTool } from "../../shared/tools.ts";
import { BackgroundTasks, ResponseStatus } from "../../shared/types.ts";
import { Button, Modal } from "../theme";

interface ChatToolsModalProps {
  activeTools: ToolName[];
  allowRemoteSearch: boolean;
  onClose: () => void;
  onSubmit: (tools: ToolName[], allowRemoteSearch: boolean) => void;
}

const toolMetadata: Record<ToolName, { label: string; description: string }> = {
  [AvailableTools.WEB_SEARCH]: {
    label: "Web Search (Parallel)",
    description:
      "Search the web and return sources to the local model, with no API key",
  },
  [AvailableTools.WEB_FETCH]: {
    label: "Fetch Web Page (Parallel)",
    description:
      "Fetch relevant content from a public web page for the local model",
  },
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
  allowRemoteSearch,
  onClose,
  onSubmit,
}: ChatToolsModalProps) {
  const [selectedTools, setSelectedTools] = useState<Set<ToolName>>(
    new Set(activeTools)
  );
  const [remoteSearchAllowed, setRemoteSearchAllowed] =
    useState(allowRemoteSearch);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleRemoteSearchConsent = (allowed: boolean) => {
    setRemoteSearchAllowed(allowed);
    if (allowed) {
      // Granting permission is an explicit action enabling the remote tools.
      setSelectedTools(
        (selected) =>
          new Set([
            ...selected,
            AvailableTools.WEB_SEARCH,
            AvailableTools.WEB_FETCH,
          ])
      );
    }
  };

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
        allowRemoteSearch: remoteSearchAllowed,
      },
      (response) => {
        setIsSubmitting(false);
        if (
          chrome.runtime.lastError ||
          response?.status !== ResponseStatus.SUCCESS
        ) {
          alert(
            chrome.runtime.lastError?.message ||
              response?.error ||
              "Failed to initialize agent with selected tools"
          );
          return;
        }
        onSubmit(
          response.tools ?? toolsArray,
          response.allowRemoteSearch === true
        );
      }
    );
  };

  return (
    <Modal
      title="Configure Tools"
      onClose={onClose}
      className="max-h-[90vh] overflow-y-auto"
    >
      <div className="space-y-4">
        <p className="text-sm text-chrome-text-secondary">
          Select which tools the agent can use. Changes will reset the current
          conversation.
        </p>

        <label className="flex items-start gap-3 rounded-lg border border-chrome-border p-3">
          <input
            type="checkbox"
            checked={remoteSearchAllowed}
            disabled={isSubmitting}
            onChange={(event) =>
              handleRemoteSearchConsent(event.target.checked)
            }
            className="mt-1"
          />
          <span>
            <span className="block text-sm font-medium">
              Allow remote web search and page fetching
            </span>
            <span className="block text-xs text-chrome-text-secondary mt-1">
              Search queries, objectives, requested URLs, the model identifier
              and a random conversation ID are sent to Parallel. Queries may
              include information from this chat or previous tool results.
              Results return to your local model; your whole chat is not
              automatically sent. Only enable this for information you are
              willing to share. No remote requests are made until you allow this
              and apply changes.
            </span>
          </span>
        </label>

        <div className="space-y-3 overflow-y-auto">
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
                  checked={
                    selectedTools.has(tool) &&
                    (remoteSearchAllowed || !isRemoteTool(tool))
                  }
                  disabled={
                    isSubmitting || (isRemoteTool(tool) && !remoteSearchAllowed)
                  }
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
            disabled={isSubmitting}
            loading={isSubmitting}
          >
            Apply Changes
          </Button>
        </div>
      </div>
    </Modal>
  );
}
