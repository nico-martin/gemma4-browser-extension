import { useEffect, useState } from "react";

import {
  AvailableTools,
  ToolName,
  toolMetadata,
} from "../../shared/tools.ts";
import { ToolPermissions } from "../../shared/types.ts";
import { Button, Modal } from "../theme";

const PERMISSIONS_STORAGE_KEY = "toolPermissions";

export default function ChatToolsModal({ onClose }: { onClose: () => void }) {
  const [permissions, setPermissions] = useState<ToolPermissions>({});

  useEffect(() => {
    chrome.storage.local.get([PERMISSIONS_STORAGE_KEY], (result) => {
      setPermissions(
        (result[PERMISSIONS_STORAGE_KEY] as ToolPermissions) || {}
      );
    });
  }, []);

  const setAlways = (tool: ToolName, alwaysAllow: boolean) => {
    const next: ToolPermissions = { ...permissions };
    if (alwaysAllow) {
      next[tool] = "always_allow";
    } else {
      delete next[tool];
    }
    setPermissions(next);
    chrome.storage.local.set({ [PERMISSIONS_STORAGE_KEY]: next });
  };

  return (
    <Modal title="Tool permissions" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-chrome-text-secondary">
          The agent asks before running a tool. Set "Always allow" to skip the
          prompt for tools you trust.
        </p>

        <div className="space-y-3 overflow-y-auto">
          {Object.values(AvailableTools).map((tool) => {
            const metadata = toolMetadata[tool];
            const alwaysAllow = permissions[tool] === "always_allow";
            return (
              <div
                key={tool}
                className="flex items-start gap-3 rounded-lg border border-chrome-border p-3"
              >
                <input
                  type="checkbox"
                  id={tool}
                  checked={alwaysAllow}
                  onChange={(e) => setAlways(tool, e.target.checked)}
                  className="mt-1 h-4 w-4 cursor-pointer rounded border transition-colors focus:ring-2 focus:ring-offset-2 focus:outline-none bg-chrome-bg-primary border-chrome-border text-chrome-accent-primary focus:border-chrome-accent-primary focus:ring-chrome-accent-primary focus:ring-offset-chrome-bg-primary"
                />
                <label htmlFor={tool} className="flex-1 cursor-pointer">
                  <div className="text-sm font-medium text-chrome-text-primary">
                    {metadata.label}
                  </div>
                  <div className="text-xs text-chrome-text-secondary mt-1">
                    {metadata.description}
                  </div>
                  <div className="text-xs mt-1 text-chrome-text-secondary">
                    {alwaysAllow ? "Always allowed" : "Asks each time"}
                  </div>
                </label>
              </div>
            );
          })}
        </div>

        <div className="flex justify-end gap-2 pt-4 border-t border-chrome-border">
          <Button
            type="button"
            variant="solid"
            color="primary"
            onClick={onClose}
          >
            Done
          </Button>
        </div>
      </div>
    </Modal>
  );
}
