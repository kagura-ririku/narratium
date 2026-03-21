import { ResponseUsageMetrics } from "@/lib/models/parsed-response";
import {
  GeminiThinkingLevel,
  getGeminiGenerateContentEndpoint,
  getGeminiStreamGenerateContentEndpoint,
} from "@/utils/api-config";

interface GeminiPart {
  text?: string;
}

interface GeminiContent {
  parts?: GeminiPart[];
}

interface GeminiCandidate {
  content?: GeminiContent;
}

interface GeminiPayload {
  systemInstruction?: GeminiContent;
  contents: Array<{
    role: "user";
    parts: GeminiPart[];
  }>;
  generationConfig?: {
    temperature?: number;
    maxOutputTokens: number;
    thinkingConfig?: {
      thinkingLevel?: GeminiThinkingLevel;
      thinkingBudget?: number;
    };
  };
}

interface GeminiErrorShape {
  error?: {
    message?: string;
  };
}

export interface InvokeGeminiContentOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  systemMessage: string;
  userMessage: string;
  maxTokens: number;
  temperature?: number;
  reasoningEffort?: GeminiThinkingLevel;
}

export interface GeminiContentResult {
  raw: Record<string, any>;
  text: string;
  usage: ResponseUsageMetrics;
}

export type GeminiStreamEvent =
  | {
    type: "delta";
    delta: string;
  }
  | {
    type: "completed";
    raw: Record<string, any>;
    text: string;
    usage: ResponseUsageMetrics;
  };

const getErrorMessage = (payload: GeminiErrorShape, fallback: string) => {
  return payload.error?.message || fallback;
};

const extractTextFromCandidate = (candidate: GeminiCandidate | undefined): string => {
  const parts = Array.isArray(candidate?.content?.parts) ? candidate?.content?.parts || [] : [];
  return parts
    .map((part) => part.text || "")
    .join("");
};

const buildUsageMetrics = (
  payload: Record<string, any>,
  startedAt: number,
): ResponseUsageMetrics => {
  const usage = (payload.usageMetadata || {}) as Record<string, any>;
  const durationMs = Math.max(1, Date.now() - startedAt);
  const inputTokens = Number(usage.promptTokenCount || 0);
  const outputTokens = Number(usage.candidatesTokenCount || 0);
  const totalTokens = Number(usage.totalTokenCount || inputTokens + outputTokens);
  const reasoningTokens = Number(usage.thoughtsTokenCount || 0);
  const tokensPerSecond = outputTokens > 0
    ? Number((outputTokens / (durationMs / 1000)).toFixed(1))
    : 0;

  return {
    inputTokens,
    outputTokens,
    totalTokens,
    reasoningTokens,
    durationMs,
    tokensPerSecond,
  };
};

export const extractTextFromGeminiPayload = (payload: Record<string, any>): string => {
  const candidates = Array.isArray(payload.candidates) ? payload.candidates as GeminiCandidate[] : [];
  return candidates
    .map((candidate) => extractTextFromCandidate(candidate))
    .join("")
    .trim();
};

const getGeminiThinkingConfig = (
  model: string,
  reasoningEffort: GeminiThinkingLevel,
): NonNullable<NonNullable<GeminiPayload["generationConfig"]>["thinkingConfig"]> => {
  const normalizedModel = model.trim().replace(/^models\//i, "").toLowerCase();
  const isGemini25 = normalizedModel.startsWith("gemini-2.5");

  if (isGemini25) {
    return {
      // Gemini 2.5 still uses thinkingBudget instead of thinkingLevel.
      thinkingBudget: reasoningEffort === "medium"
        ? 8192
        : reasoningEffort === "high"
          ? 24576
          : 1024,
    };
  }

  return {
    thinkingLevel: reasoningEffort,
  };
};

const buildPayload = ({
  model,
  systemMessage,
  userMessage,
  maxTokens,
  temperature,
  reasoningEffort,
}: Omit<InvokeGeminiContentOptions, "baseUrl" | "apiKey">): GeminiPayload => {
  const generationConfig: NonNullable<GeminiPayload["generationConfig"]> = {
    maxOutputTokens: maxTokens,
  };

  if (typeof temperature === "number") {
    generationConfig.temperature = temperature;
  }

  if (reasoningEffort) {
    generationConfig.thinkingConfig = getGeminiThinkingConfig(model, reasoningEffort);
  }

  const payload: GeminiPayload = {
    contents: [
      {
        role: "user",
        parts: [
          {
            text: userMessage,
          },
        ],
      },
    ],
    generationConfig,
  };

  if (systemMessage.trim()) {
    payload.systemInstruction = {
      parts: [
        {
          text: systemMessage,
        },
      ],
    };
  }

  return payload;
};

export const invokeGeminiContent = async ({
  baseUrl,
  apiKey,
  model,
  systemMessage,
  userMessage,
  maxTokens,
  temperature,
  reasoningEffort,
}: InvokeGeminiContentOptions): Promise<GeminiContentResult> => {
  const endpoint = getGeminiGenerateContentEndpoint(baseUrl, model);
  const startedAt = Date.now();
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey.trim(),
    },
    body: JSON.stringify(buildPayload({
      model,
      systemMessage,
      userMessage,
      maxTokens,
      temperature,
      reasoningEffort,
    })),
  });

  const json = await response.json() as Record<string, any>;
  if (!response.ok) {
    throw new Error(getErrorMessage(json as GeminiErrorShape, `Gemini API request failed with status ${response.status}`));
  }

  const text = extractTextFromGeminiPayload(json);
  if (!text) {
    throw new Error("The API returned an empty response.");
  }

  return {
    raw: json,
    text,
    usage: buildUsageMetrics(json, startedAt),
  };
};

export async function* streamGeminiContent({
  baseUrl,
  apiKey,
  model,
  systemMessage,
  userMessage,
  maxTokens,
  temperature,
  reasoningEffort,
}: InvokeGeminiContentOptions): AsyncGenerator<GeminiStreamEvent, void, unknown> {
  const endpoint = getGeminiStreamGenerateContentEndpoint(baseUrl, model);
  const startedAt = Date.now();
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey.trim(),
    },
    body: JSON.stringify(buildPayload({
      model,
      systemMessage,
      userMessage,
      maxTokens,
      temperature,
      reasoningEffort,
    })),
  });

  if (!response.ok) {
    const json = await response.json() as Record<string, any>;
    throw new Error(getErrorMessage(json as GeminiErrorShape, `Gemini API request failed with status ${response.status}`));
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("Unable to read the response stream.");
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let accumulatedText = "";
  let lastPayload: Record<string, any> = {};

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
    const frames = buffer.split("\n\n");
    buffer = frames.pop() || "";

    for (const frame of frames) {
      const dataLines = frame
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .filter(Boolean);

      if (dataLines.length === 0) {
        continue;
      }

      const payload = JSON.parse(dataLines.join("\n")) as Record<string, any>;
      const chunkText = extractTextFromGeminiPayload(payload);
      if (chunkText) {
        accumulatedText += chunkText;
        yield {
          type: "delta",
          delta: chunkText,
        };
      }
      lastPayload = payload;
    }
  }

  yield {
    type: "completed",
    raw: lastPayload,
    text: accumulatedText.trim(),
    usage: buildUsageMetrics(lastPayload, startedAt),
  };
}
