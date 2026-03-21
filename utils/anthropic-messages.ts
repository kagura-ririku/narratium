import { ResponseUsageMetrics } from "@/lib/models/parsed-response";
import {
  AnthropicReasoningEffort,
  getAnthropicMessagesEndpoint,
} from "@/utils/api-config";

const ANTHROPIC_VERSION = "2023-06-01";

interface AnthropicMessageContentBlock {
  type?: string;
  text?: string;
}

interface AnthropicMessagesPayload {
  model: string;
  max_tokens: number;
  system?: string;
  messages: Array<{
    role: "user";
    content: string;
  }>;
  temperature?: number;
  stream?: boolean;
  output_config?: {
    effort: AnthropicReasoningEffort;
  };
}

interface AnthropicErrorShape {
  error?: {
    message?: string;
  };
  message?: string;
}

export interface InvokeAnthropicMessagesOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  systemMessage: string;
  userMessage: string;
  maxTokens: number;
  temperature?: number;
  reasoningEffort?: AnthropicReasoningEffort;
}

export interface AnthropicMessagesResult {
  raw: Record<string, any>;
  text: string;
  usage: ResponseUsageMetrics;
}

export type AnthropicMessagesStreamEvent =
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

const getErrorMessage = (payload: AnthropicErrorShape, fallback: string) => {
  return payload.error?.message || payload.message || fallback;
};

const buildUsageMetrics = (
  usagePayload: Record<string, any> | undefined,
  startedAt: number,
): ResponseUsageMetrics => {
  const usage = usagePayload || {};
  const durationMs = Math.max(1, Date.now() - startedAt);
  const inputTokens = Number(usage.input_tokens || 0);
  const outputTokens = Number(usage.output_tokens || 0);
  const totalTokens = inputTokens + outputTokens;
  const tokensPerSecond = outputTokens > 0
    ? Number((outputTokens / (durationMs / 1000)).toFixed(1))
    : 0;

  return {
    inputTokens,
    outputTokens,
    totalTokens,
    reasoningTokens: 0,
    durationMs,
    tokensPerSecond,
  };
};

export const extractTextFromAnthropicPayload = (payload: Record<string, any>): string => {
  const content = Array.isArray(payload.content) ? payload.content as AnthropicMessageContentBlock[] : [];
  return content
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text || "")
    .join("")
    .trim();
};

export const invokeAnthropicMessages = async ({
  baseUrl,
  apiKey,
  model,
  systemMessage,
  userMessage,
  maxTokens,
  temperature,
  reasoningEffort,
}: InvokeAnthropicMessagesOptions): Promise<AnthropicMessagesResult> => {
  const endpoint = getAnthropicMessagesEndpoint(baseUrl);
  const startedAt = Date.now();
  const payload: AnthropicMessagesPayload = {
    model: model.trim(),
    max_tokens: maxTokens,
    messages: [
      {
        role: "user",
        content: userMessage,
      },
    ],
    temperature,
  };

  if (systemMessage.trim()) {
    payload.system = systemMessage;
  }

  if (reasoningEffort) {
    payload.output_config = {
      effort: reasoningEffort,
    };
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey.trim(),
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: JSON.stringify(payload),
  });

  const json = await response.json() as Record<string, any>;

  if (!response.ok) {
    throw new Error(getErrorMessage(json, `Anthropic Messages API request failed with status ${response.status}`));
  }

  const text = extractTextFromAnthropicPayload(json);
  if (!text) {
    throw new Error("The API returned an empty response.");
  }

  return {
    raw: json,
    text,
    usage: buildUsageMetrics(json.usage as Record<string, any> | undefined, startedAt),
  };
};

export async function* streamAnthropicMessages({
  baseUrl,
  apiKey,
  model,
  systemMessage,
  userMessage,
  maxTokens,
  temperature,
  reasoningEffort,
}: InvokeAnthropicMessagesOptions): AsyncGenerator<AnthropicMessagesStreamEvent, void, unknown> {
  const endpoint = getAnthropicMessagesEndpoint(baseUrl);
  const startedAt = Date.now();
  const payload: AnthropicMessagesPayload = {
    model: model.trim(),
    max_tokens: maxTokens,
    stream: true,
    messages: [
      {
        role: "user",
        content: userMessage,
      },
    ],
    temperature,
  };

  if (systemMessage.trim()) {
    payload.system = systemMessage;
  }

  if (reasoningEffort) {
    payload.output_config = {
      effort: reasoningEffort,
    };
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey.trim(),
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const json = await response.json() as Record<string, any>;
    throw new Error(getErrorMessage(json, `Anthropic Messages API request failed with status ${response.status}`));
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("Unable to read the response stream.");
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let accumulatedText = "";
  let latestUsage: Record<string, any> = {};
  let completedPayload: Record<string, any> | null = null;

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
    const frames = buffer.split("\n\n");
    buffer = frames.pop() || "";

    for (const frame of frames) {
      const lines = frame
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);

      const eventName = lines.find((line) => line.startsWith("event:"))?.slice(6).trim() || "";
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

      const payloadData = JSON.parse(rawData) as Record<string, any>;
      const eventType = eventName || payloadData.type || "";

      if (eventType === "message_start" && payloadData.message?.usage) {
        latestUsage = payloadData.message.usage as Record<string, any>;
        completedPayload = payloadData.message as Record<string, any>;
        continue;
      }

      if (
        eventType === "content_block_delta" &&
        payloadData.delta?.type === "text_delta" &&
        typeof payloadData.delta?.text === "string"
      ) {
        accumulatedText += payloadData.delta.text as string;
        yield {
          type: "delta",
          delta: payloadData.delta.text as string,
        };
        continue;
      }

      if (eventType === "message_delta" && payloadData.usage) {
        latestUsage = payloadData.usage as Record<string, any>;
        continue;
      }

      if (eventType === "message_stop") {
        const finalPayload = completedPayload || {
          content: [
            {
              type: "text",
              text: accumulatedText,
            },
          ],
          usage: latestUsage,
        };
        yield {
          type: "completed",
          raw: finalPayload,
          text: accumulatedText.trim(),
          usage: buildUsageMetrics(latestUsage, startedAt),
        };
      }
    }
  }
}
