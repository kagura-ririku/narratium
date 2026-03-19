import { getOpenAIResponsesEndpoint } from "@/utils/api-config";

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
}

export interface OpenAIResponsesResult {
  raw: Record<string, any>;
  text: string;
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
}: InvokeOpenAIResponsesOptions): Promise<OpenAIResponsesResult> => {
  const endpoint = getOpenAIResponsesEndpoint(baseUrl);
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
  };
};
