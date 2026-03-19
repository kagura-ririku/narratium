import { ResponseUsageMetrics } from "@/lib/models/parsed-response";
import { getOpenAIResponsesEndpoint, ReasoningEffort } from "@/utils/api-config";

interface ResponseTextPart {
  type?: string;
  text?: string;
}

interface ResponseMessage {
  type?: string;
  content?: ResponseTextPart[];
}

interface ResponsesPayload {
  model: string;
  input: Array<{
    role: "system" | "user";
    content: Array<{
      type: "input_text";
      text: string;
    }>;
  }>;
  temperature?: number;
  text?: {
    format: {
      type: "text";
    };
  };
  reasoning?: {
    effort: ReasoningEffort;
  };
}

interface ResponsesErrorShape {
  error?: {
    message?: string;
  };
  message?: string;
}

export interface InvokeOpenAIResponsesOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  systemMessage: string;
  userMessage: string;
  temperature?: number;
  reasoningEffort?: ReasoningEffort;
}

export interface OpenAIResponsesResult {
  raw: Record<string, any>;
  text: string;
  usage: ResponseUsageMetrics;
}

const getErrorMessage = (payload: ResponsesErrorShape, fallback: string) => {
  return payload.error?.message || payload.message || fallback;
};

export const extractTextFromResponsesPayload = (payload: Record<string, any>): string => {
  if (typeof payload.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
  }

  const output = Array.isArray(payload.output) ? payload.output as ResponseMessage[] : [];
  const text = output
    .filter((item) => item.type === "message" && Array.isArray(item.content))
    .flatMap((item) => item.content || [])
    .filter((part) => part.type === "output_text" && typeof part.text === "string")
    .map((part) => part.text || "")
    .join("")
    .trim();

  return text;
};

export const invokeOpenAIResponses = async ({
  baseUrl,
  apiKey,
  model,
  systemMessage,
  userMessage,
  temperature,
  reasoningEffort,
}: InvokeOpenAIResponsesOptions): Promise<OpenAIResponsesResult> => {
  const endpoint = getOpenAIResponsesEndpoint(baseUrl);
  const startedAt = Date.now();
  const payload: ResponsesPayload = {
    model: model.trim(),
    temperature,
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text: systemMessage,
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: userMessage,
          },
        ],
      },
    ],
    text: {
      format: {
        type: "text",
      },
    },
  };

  if (reasoningEffort) {
    payload.reasoning = {
      effort: reasoningEffort,
    };
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey.trim()}`,
    },
    body: JSON.stringify(payload),
  });

  const json = await response.json() as Record<string, any>;

  if (!response.ok) {
    throw new Error(getErrorMessage(json, `OpenAI Responses API request failed with status ${response.status}`));
  }

  const text = extractTextFromResponsesPayload(json);
  if (!text) {
    throw new Error("The API returned an empty response.");
  }

  const usagePayload = (json.usage || {}) as Record<string, any>;
  const headerDurationMs = Number(response.headers.get("openai-processing-ms") || "");
  const durationMs = Number.isFinite(headerDurationMs) && headerDurationMs > 0
    ? Math.round(headerDurationMs)
    : Math.max(1, Date.now() - startedAt);
  const inputTokens = Number(usagePayload.input_tokens || 0);
  const outputTokens = Number(usagePayload.output_tokens || 0);
  const totalTokens = Number(usagePayload.total_tokens || inputTokens + outputTokens);
  const reasoningTokens = Number(usagePayload.output_tokens_details?.reasoning_tokens || 0);
  const tokensPerSecond = outputTokens > 0
    ? Number((outputTokens / (durationMs / 1000)).toFixed(1))
    : 0;

  return {
    raw: json,
    text,
    usage: {
      inputTokens,
      outputTokens,
      totalTokens,
      reasoningTokens,
      durationMs,
      tokensPerSecond,
    },
  };
};
