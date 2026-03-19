import { NodeTool } from "@/lib/nodeflow/NodeTool";
import { invokeOpenAIResponses } from "@/utils/openai-responses";

export interface LLMConfig {
  modelName: string;
  apiKey: string;
  baseUrl?: string;
  llmType?: "openai";
  temperature?: number;
  maxTokens?: number;
  maxRetries?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  streaming?: boolean;
  streamUsage?: boolean;
  language?: "zh" | "en";
}
export class LLMNodeTools extends NodeTool {
  protected static readonly toolType: string = "llm";
  protected static readonly version: string = "1.0.0";

  static getToolType(): string {
    return this.toolType;
  }

  static async executeMethod(methodName: string, ...params: any[]): Promise<any> {
    const method = (this as any)[methodName];
    
    if (typeof method !== "function") {
      console.error(`Method lookup failed: ${methodName} not found in LLMNodeTools`);
      console.log("Available methods:", Object.getOwnPropertyNames(this).filter(name => 
        typeof (this as any)[name] === "function" && !name.startsWith("_"),
      ));
      throw new Error(`Method ${methodName} not found in ${this.getToolType()}Tool`);
    }

    try {
      this.logExecution(methodName, params);
      return await (method as Function).apply(this, params);
    } catch (error) {
      console.error(`Method execution failed: ${methodName}`, error);
      throw error;
    }
  }

  static async invokeLLM(
    systemMessage: string,
    userMessage: string,
    config: LLMConfig,
  ): Promise<string> {
    try {
      const response = await invokeOpenAIResponses({
        baseUrl: config.baseUrl || "",
        apiKey: config.apiKey || "",
        model: config.modelName || "",
        systemMessage,
        userMessage,
        temperature: config.temperature,
      });
      return response.text;
    } catch (error) {
      this.handleError(error as Error, "invokeLLM");
    }
  }
}
