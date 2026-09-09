// some helper functions for tool-calling based on the WebMCP API Proposal

type WebMCPProperty =
  | {
      type: "string";
      description: string;
      default?: string;
    }
  | {
      type: "number";
      description: string;
      default?: number;
    }
  | {
      type: "boolean";
      description: string;
      default?: boolean;
    };

export interface WebMCPTool {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, WebMCPProperty>;
    required: Array<string>;
  };
  execute: (args: Record<string, any>) => Promise<string>;
}

export const webMCPToolToChatTemplateTool = (
  webMCPTool: WebMCPTool
): {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, any>;
  };
} => ({
  type: "function",
  function: {
    name: webMCPTool.name,
    description: webMCPTool.description,
    parameters: webMCPTool.inputSchema,
  },
});

export const validateWebMCPToolArguments = (
  tool: WebMCPTool,
  args: Record<string, any>
): Record<string, any> => {
  const expectedArguments = tool.inputSchema.properties;

  const validArguments = Object.entries(args).filter(([key, value]) => {
    const isValidKey = key in expectedArguments;
    const expectedType = expectedArguments[key]?.type;
    const actualType = typeof value;
    const isValidType = expectedType === actualType;

    return isValidKey && isValidType;
  });

  const returnArgs: Record<string, any> = validArguments.reduce((acc, curr) => {
    return { ...acc, [curr[0]]: curr[1] };
  }, {});

  if (tool.inputSchema.required.length !== 0) {
    const missingArguments = tool.inputSchema.required.filter(
      (argument) => !(argument in returnArgs)
    );

    if (missingArguments.length) {
      throw new Error(
        `Missing required arguments: ${missingArguments.join(", ")}`
      );
    }
  }

  return returnArgs;
};

export const executeWebMCPTool = async (
  tool: WebMCPTool,
  args: Record<string, any> | string | undefined
) => {
  // Handle case where args is a JSON string instead of an object
  let parsedArgs: Record<string, any> = {};

  if (typeof args === "string") {
    try {
      parsedArgs = JSON.parse(args);
    } catch (_error) {
      parsedArgs = {};
    }
  } else if (args) {
    parsedArgs = args;
  }

  const validatedArgs = validateWebMCPToolArguments(tool, parsedArgs);
  return await tool.execute(validatedArgs);
};
