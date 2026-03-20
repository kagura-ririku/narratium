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
  stream?: boolean;
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

export type OpenAIResponsesStreamEvent =
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

const buildUsageMetrics = (
  payload: Record<string, any>,
  response: Response,
  startedAt: number,
): ResponseUsageMetrics => {
  const usagePayload = (payload.usage || {}) as Record<string, any>;
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
    inputTokens,
    outputTokens,
    totalTokens,
    reasoningTokens,
    durationMs,
    tokensPerSecond,
  };
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

  return {
    raw: json,
    text,
    usage: buildUsageMetrics(json, response, startedAt),
  };
};

export async function* streamOpenAIResponses({
  baseUrl,
  apiKey,
  model,
  systemMessage,
  userMessage,
  temperature,
  reasoningEffort,
}: InvokeOpenAIResponsesOptions): AsyncGenerator<OpenAIResponsesStreamEvent, void, unknown> {
  const endpoint = getOpenAIResponsesEndpoint(baseUrl);
  const startedAt = Date.now();
  const payload: ResponsesPayload = {
    model: model.trim(),
    temperature,
    stream: true,
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

  if (!response.ok) {
    const json = await response.json() as Record<string, any>;
    throw new Error(getErrorMessage(json, `OpenAI Responses API request failed with status ${response.status}`));
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("Unable to read the response stream.");
  }

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() || "";

    for (const frame of frames) {
      const lines = frame
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);

      const dataLines = lines
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .filter(Boolean);

      if (dataLines.length === 0) {
        continue;
      }

      const rawData = dataLines.join("\n");
      if (rawData === "[DONE]") {
        continue;
      }

      const payload = JSON.parse(rawData) as Record<string, any>;

      if (payload.type === "response.output_text.delta" && typeof payload.delta === "string") {
        yield {
          type: "delta",
          delta: payload.delta,
        };
        continue;
      }

      if (payload.type === "response.completed") {
        const completedPayload = (payload.response || payload) as Record<string, any>;
        yield {
          type: "completed",
          raw: completedPayload,
          text: extractTextFromResponsesPayload(completedPayload),
          usage: buildUsageMetrics(completedPayload, response, startedAt),
        };
      }
    }
  }
}
