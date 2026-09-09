import {
  KeyboardEvent,
  forwardRef,
  useEffect,
  useImperativeHandle,
  useState,
} from "react";

import cn from "../utils/classnames.ts";

export interface Command {
  name: string;
  description: string;
  action: () => void;
}

export interface ChatCommandsRef {
  handleKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void;
}

interface ChatCommandsProps {
  commands: Array<Command>;
  inputValue: string;
  isOpen: boolean;
  onClose?: () => void;
  onExecute?: (command: Command) => void;
}

const ChatCommands = forwardRef<ChatCommandsRef, ChatCommandsProps>(
  ({ commands, inputValue, isOpen, onClose, onExecute }, ref) => {
    const [selectedIndex, setSelectedIndex] = useState(0);

    const filteredCommands = commands.filter((cmd) =>
      cmd.name.toLowerCase().includes(inputValue.toLowerCase())
    );

    useEffect(() => {
      setSelectedIndex(0);
    }, [inputValue]);

    useImperativeHandle(ref, () => ({
      handleKeyDown: (e: KeyboardEvent<HTMLInputElement>) => {
        if (!isOpen || filteredCommands.length === 0) return;

        switch (e.key) {
          case "ArrowDown":
            e.preventDefault();
            setSelectedIndex((prev) =>
              prev < filteredCommands.length - 1 ? prev + 1 : 0
            );
            break;
          case "ArrowUp":
            e.preventDefault();
            setSelectedIndex((prev) =>
              prev > 0 ? prev - 1 : filteredCommands.length - 1
            );
            break;
          case "Enter": {
            e.preventDefault();
            const selected = filteredCommands[selectedIndex];
            if (selected) {
              selected.action();
              onExecute?.(selected);
            }
            break;
          }
          case "Escape":
            onClose?.();
            break;
        }
      },
    }));

    return (
      isOpen &&
      filteredCommands.length > 0 && (
        <div className="absolute bottom-full left-6 right-6 mb-2 bg-chrome-bg-tertiary border border-chrome-border rounded shadow-lg overflow-hidden">
          {filteredCommands.map((cmd, index) => (
            <button
              key={cmd.name}
              type="button"
              onClick={() => {
                cmd.action();
                onExecute?.(cmd);
              }}
              className={cn(
                "w-full flex items-center justify-between px-4 py-2 text-left transition-colors",
                index === selectedIndex
                  ? "bg-chrome-hover"
                  : "hover:bg-chrome-hover"
              )}
            >
              <div>
                <div className="text-sm font-medium text-chrome-text-primary">
                  {cmd.name}
                </div>
                <div className="text-xs text-chrome-text-secondary">
                  {cmd.description}
                </div>
              </div>
            </button>
          ))}
        </div>
      )
    );
  }
);

ChatCommands.displayName = "ChatCommands";

export default ChatCommands;
