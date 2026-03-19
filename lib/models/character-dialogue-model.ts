import { ParsedResponse } from "@/lib/models/parsed-response";
import { PromptType } from "@/lib/models/character-prompts-model";
import { ReasoningEffort } from "@/utils/api-config";

export interface DialogueMessage {
  role: "user" | "assistant" | "system" | "sample";
  content: string;
  parsedContent?: ParsedResponse;
  id: number;
}

export interface DialogueOptions {
  modelName: string;
  apiKey: string;
  baseUrl: string;
  llmType?: "openai";
  reasoningEffort?: ReasoningEffort;
  temperature?: number;
  maxTokens?: number;
  streaming?: boolean;
  language?: "zh" | "en";
  promptType?: PromptType;
  contextWindow?: number;
}
