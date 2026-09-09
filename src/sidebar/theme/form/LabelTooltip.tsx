import { CircleQuestionMark } from "lucide-react";
import { type ReactNode } from "react";

import { Tooltip, TooltipProps } from "../index.ts";

interface LabelTooltipProps extends Omit<TooltipProps, "children"> {
  more?: { content: ReactNode; title: string };
}

export default function LabelTooltip({
  more: _more = null,
  ...tooltip
}: LabelTooltipProps) {
  return (
    <span className="absolute top-1/2 ml-1 -translate-y-1/2">
      <Tooltip {...tooltip} text={tooltip.text} className="block text-gray-400">
        <CircleQuestionMark className="block w-4" />
      </Tooltip>
    </span>
  );
}
