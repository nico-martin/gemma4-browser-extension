import { ToolCallPayload } from "./types.ts";

const parseGemmaArguments = (rawArguments: string): Record<string, any> => {
  const normalized = rawArguments
    .replace(/<\|"\|>/g, '"')
    .replace(/([{,]\s*)([a-zA-Z_]\w*)\s*:/g, '$1"$2":');

  try {
    return JSON.parse(normalized);
  } catch {
    return {};
  }
};

const extractBareGemmaToolCalls = (
  text: string
): Array<{
  name: string;
  rawArguments: string;
  start: number;
  end: number;
}> => {
  const calls: Array<{
    name: string;
    rawArguments: string;
    start: number;
    end: number;
  }> = [];

  let cursor = 0;
  while (cursor < text.length) {
    const callStart = text.indexOf("call:", cursor);
    if (callStart === -1) break;

    const nameStart = callStart + "call:".length;
    const braceStart = text.indexOf("{", nameStart);
    if (braceStart === -1) {
      cursor = nameStart;
      continue;
    }

    const name = text.slice(nameStart, braceStart).trim();
    if (!name) {
      cursor = braceStart + 1;
      continue;
    }

    let depth = 0;
    let inString = false;
    let escapeNext = false;
    let braceEnd = -1;

    for (let i = braceStart; i < text.length; i++) {
      const ch = text[i];
      if (escapeNext) {
        escapeNext = false;
        continue;
      }
      if (ch === "\\") {
        escapeNext = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;

      if (ch === "{") depth += 1;
      if (ch === "}") {
        depth -= 1;
        if (depth === 0) {
          braceEnd = i;
          break;
        }
      }
    }

    if (braceEnd === -1) {
      cursor = braceStart + 1;
      continue;
    }

    calls.push({
      name,
      rawArguments: text.slice(braceStart, braceEnd + 1),
      start: callStart,
      end: braceEnd + 1,
    });
    cursor = braceEnd + 1;
  }

  return calls;
};

export const extractToolCalls = (
  text: string
): { toolCalls: ToolCallPayload[]; message: string } => {
  const cleanedText = text.replace(/<\|end_of_text\|>/g, "");
  const jsonMatches = Array.from(
    cleanedText.matchAll(/<tool_call>([\s\S]*?)<\/tool_call>/g)
  );
  const gemmaMatches = Array.from(
    cleanedText.matchAll(/<\|tool_call>([\s\S]*?)<tool_call\|>/g)
  );
  const bareGemmaMatches = extractBareGemmaToolCalls(cleanedText);
  const toolCalls: ToolCallPayload[] = [];

  for (const match of jsonMatches) {
    try {
      const parsed = JSON.parse(match[1].trim());
      if (parsed && typeof parsed.name === "string") {
        toolCalls.push({
          name: parsed.name,
          arguments: parsed.arguments ?? {},
          id: JSON.stringify({
            name: parsed.name,
            arguments: parsed.arguments ?? {},
          }),
        });
      }
    } catch {
      console.warn("[extractToolCalls] malformed JSON tool call", match[1]);
    }
  }

  for (const match of gemmaMatches) {
    const payload = match[1].trim();
    const nameMatch = payload.match(/^call:([^{]+){/);
    const argsMatch = payload.match(/^call:[^{]+({[\s\S]*})$/);

    if (!nameMatch) {
      continue;
    }

    const name = nameMatch[1].trim();
    const args = argsMatch ? parseGemmaArguments(argsMatch[1]) : {};

    toolCalls.push({
      name,
      arguments: args,
      id: JSON.stringify({
        name,
        arguments: args,
      }),
    });
  }

  const usedBareGemmaFallback = toolCalls.length === 0;

  if (usedBareGemmaFallback) {
    for (const match of bareGemmaMatches) {
      const args = parseGemmaArguments(match.rawArguments);

      toolCalls.push({
        name: match.name,
        arguments: args,
        id: JSON.stringify({
          name: match.name,
          arguments: args,
        }),
      });
    }
  }

  let textWithoutBareCalls = text;
  if (usedBareGemmaFallback) {
    const bareRanges = bareGemmaMatches
      .sort((a, b) => b.start - a.start)
      .map(({ start, end }) => ({ start, end }));
    for (const range of bareRanges) {
      textWithoutBareCalls =
        textWithoutBareCalls.slice(0, range.start) +
        textWithoutBareCalls.slice(range.end);
    }
  }

  // Remove both complete and incomplete tool calls
  // Complete: <tool_call>...</tool_call>
  // Incomplete: <tool_call>... (no closing tag yet)
  const message = textWithoutBareCalls
    .replace(/<\|end_of_text\|>/g, "")
    .replace(/<\|tool_response>[\s\S]*?<tool_response\|>/g, "")
    .replace(/<tool_response>[\s\S]*?<\/tool_response>/g, "")
    .replace(/<\|tool_response>|<tool_response\|>/g, "")
    .replace(/<tool_response>|<\/tool_response>/g, "")
    .replace(/<\|tool_call>[\s\S]*?(?:<tool_call\|>|$)/g, "")
    .replace(/<tool_call>[\s\S]*?(?:<\/tool_call>|$)/g, "")
    .trim();

  return { toolCalls, message };
};
