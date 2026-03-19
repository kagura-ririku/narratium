export interface ResponseUsageMetrics {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  reasoningTokens: number;
  durationMs: number;
  tokensPerSecond: number;
}

export interface ParsedResponse {
  regexResult?: string;
  nextPrompts?: string[];
  compressedContent?: string;
  usage?: ResponseUsageMetrics;
}
