import { LocalCharacterDialogueOperations } from "@/lib/data/character-dialogue-operation";
import { PromptType } from "@/lib/models/character-prompts-model";
import { ParsedResponse, ResponseUsageMetrics } from "@/lib/models/parsed-response";
import { DialogueWorkflow, DialogueWorkflowParams } from "@/lib/workflow/examples/DialogueWorkflow";
import { DEFAULT_RESPONSE_LENGTH, normalizeBaseUrl, ReasoningEffort } from "@/utils/api-config";

export async function handleCharacterChatRequest(payload: {
  username?: string;
  characterId: string;
  message: string;
  modelName: string;
  baseUrl: string;
  apiKey: string;
  llmType?: string;
  reasoningEffort?: ReasoningEffort;
  streaming?: boolean;
  language?: "zh" | "en";
  promptType?: PromptType;
  number?: number;
  nodeId: string;
  fastModel: boolean;
}): Promise<Response> {
  try {
    const {
      username,
      characterId,
      message,
      modelName,
      baseUrl,
      apiKey,
      llmType = "openai",
      reasoningEffort,
      language = "zh",
      promptType = PromptType.EXPLICIT || PromptType.CUSTOM || PromptType.COMPANION,
      number = DEFAULT_RESPONSE_LENGTH,
      nodeId,
      fastModel = false,
    } = payload;

    if (!characterId || !message) {
      return new Response(JSON.stringify({ error: "Missing required parameters" }), { status: 400 });
    }

    if (!modelName?.trim() || !apiKey?.trim()) {
      return new Response(JSON.stringify({
        type: "error",
        message: "OpenAI API configuration is incomplete. Please set the model and API key in Model Settings.",
        success: false,
      }), {
        status: 400,
        headers: {
          "Content-Type": "application/json",
        },
      });
    }

    try {
      const workflow = new DialogueWorkflow();
      const workflowParams: DialogueWorkflowParams = {
        characterId,
        userInput: message,
        language,
        username,
        modelName: modelName.trim(),
        apiKey: apiKey.trim(),
        baseUrl: normalizeBaseUrl(baseUrl),
        llmType: llmType as "openai",
        temperature: 0.7,
        streaming: false,
        number,
        promptType,
        fastModel,  
        reasoningEffort,
      };
      const workflowResult = await workflow.execute(workflowParams);
      
      if (!workflowResult || !workflowResult.outputData) {
        throw new Error("No response returned from workflow");
      }

      const {
        replacedText,
        screenContent,
        fullResponse,
        nextPrompts,
        event,
        responseUsage,
      } = workflowResult.outputData;

      await processPostResponseAsync({ characterId, message, fullResponse, screenContent, event, nextPrompts, nodeId, responseUsage })
        .catch((e) => console.error("Post-processing error:", e));

      return new Response(JSON.stringify({
        type: "complete",
        success: true,
        content: screenContent,
        parsedContent: { nextPrompts, usage: responseUsage },
        isRegexProcessed: true,
      }), {
        headers: {
          "Content-Type": "application/json",
        },
      });

    } catch (error: any) {
      console.error("Processing error:", error);
      return new Response(JSON.stringify({
        type: "error",
        message: error.message || "Unknown error",
        success: false,
      }), { 
        status: 500,
        headers: {
          "Content-Type": "application/json",
        },
      });
    }

  } catch (error: any) {
    console.error("Fatal error:", error);
    return new Response(JSON.stringify({ error: `Failed to process request: ${error.message}`, success: false }), { 
      status: 500,
      headers: {
        "Content-Type": "application/json",
      },
    });
  }
}

async function processPostResponseAsync({
  characterId,
  message,
  fullResponse,
  screenContent,
  event,
  nextPrompts,
  nodeId,
  responseUsage,
}: {
  characterId: string;
  message: string;
  fullResponse: string;
  screenContent: string;
  event: string;
  nextPrompts: string[];
  nodeId: string;
  responseUsage?: ResponseUsageMetrics;
}) {
  try {
    const parsed: ParsedResponse = {
      regexResult: screenContent,
      nextPrompts,
      usage: responseUsage,
    };
    const dialogueTree = await LocalCharacterDialogueOperations.getDialogueTreeById(characterId);
    const parentNodeId = dialogueTree ? dialogueTree.current_node_id : "root";
    await LocalCharacterDialogueOperations.addNodeToDialogueTree(
      characterId,
      parentNodeId,
      message,
      screenContent,
      fullResponse,
      parsed,
      nodeId,
    );

    if (event) {
      const updatedDialogueTree = await LocalCharacterDialogueOperations.getDialogueTreeById(characterId);
      if (updatedDialogueTree) {
        await LocalCharacterDialogueOperations.updateNodeInDialogueTree(
          characterId,
          nodeId,
          {
            parsed_content: {
              ...parsed,
              compressedContent: event,
            },
          },
        );
      }
    }
  } catch (e) {
    console.error("Error in processPostResponseAsync:", e);
  }
}
