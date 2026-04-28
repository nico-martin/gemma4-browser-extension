import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import cn from "../utils/classnames.ts";

export default function CopyButton({
  text,
  align,
  anchor,
}: {
  text: string;
  align: "left" | "right";
  anchor: string;
}) {
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const onClick = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => setCopied(false), 1200);
    } catch (error) {
      console.warn("Copy failed:", error);
    }
  };

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={copied ? "Copied" : "Copy message"}
      title={copied ? "Copied" : "Copy"}
      disabled={!text}
      className={cn(
        "copy-button",
        align === "left" ? "copy-button-left" : "copy-button-right",
        "inline-flex items-center gap-1 rounded px-1.5 py-1 text-[11px] text-chrome-text-secondary transition-colors hover:bg-chrome-hover hover:text-chrome-text-primary cursor-pointer"
      )}
      style={{ positionAnchor: anchor } as React.CSSProperties}
    >
      {copied ? (
        <Check className="h-3 w-3" />
      ) : (
        <Copy className="h-3 w-3" />
      )}
    </button>
  );
}
