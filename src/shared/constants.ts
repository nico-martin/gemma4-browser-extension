import { TaskType } from "@huggingface/transformers";

import { Dtype } from "./types.ts";

export const MODELS: Record<
  string,
  { modelId: string; title: string; dtype: Dtype; task: TaskType }
> = {
  allMiniLM: {
    modelId: "onnx-community/all-MiniLM-L6-v2-ONNX",
    title: "all-MiniLM-L6-v2",
    dtype: "fp32",
    task: "feature-extraction",
  },
  granite350m: {
    modelId: "onnx-community/granite-4.0-350m-ONNX-web",
    title: "Granite-4.0 350M (fp16)",
    dtype: "fp16",
    task: "text-generation",
  },
  granite1B: {
    modelId: "onnx-community/granite-4.0-1b-ONNX-web",
    title: "Granite-4.0 1B (q4)",
    dtype: "q4",
    task: "text-generation",
  },
  granite3B: {
    modelId: "onnx-community/granite-4.0-micro-ONNX-web",
    title: "Granite-4.0 3B (q4f16)",
    dtype: "q4f16",
    task: "text-generation",
  },
  gemma4E2B: {
    modelId: "onnx-community/gemma-4-E2B-it-ONNX",
    title: "Gemma 4 E2B (q4f16)",
    dtype: "q4f16",
    task: "text-generation",
  },
  gemma4E4B: {
    modelId: "onnx-community/gemma-4-E4B-it-ONNX",
    title: "Gemma 4 E4B (q4f16)",
    dtype: "q4f16",
    task: "text-generation",
  },
};

// Default text generation model — can be overridden via UI settings
export const DEFAULT_TEXT_GENERATION_ID = "gemma4E2B";
export const TEXT_GENERATION_ID = DEFAULT_TEXT_GENERATION_ID;
export const FEATURE_EXTRACTION_ID = "allMiniLM";

// User-selectable text generation models
export const TEXT_GENERATION_MODEL_OPTIONS = Object.entries(MODELS)
  .filter(([_, m]) => m.task === "text-generation")
  .map(([key, m]) => ({ key, title: m.title, modelId: m.modelId }));

export const REQUIRED_MODEL_IDS = [
  MODELS[FEATURE_EXTRACTION_ID].modelId,
  MODELS[TEXT_GENERATION_ID].modelId,
];
