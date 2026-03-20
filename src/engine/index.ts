import type { 
  UnifiedMessage, 
  UnifiedChatResponse,
  ToolCall,
  ToolResult
} from '../unified/message-format'

export interface EngineOptions {
  maxTurns?: number;
  modelParams?: {
    temperature?: number;
    maxTokens?: number;
  };
}

export class AgenticEngine {
  private systemPrompt: string;
  private history: UnifiedMessage[];
  private currentState: {
    maxTurns: number;
    currentTurn: number;
    modelParams: {
      temperature: number;
      maxTokens: number;
    };
  };

  constructor(
    systemPrompt: string,
    private defaultModel: string,
    options?: EngineOptions
  ) {
    this.systemPrompt = systemPrompt;
    this.history = [
      {
        role: 'system',
        content: systemPrompt
      }
    ];
    
    this.currentState = {
      maxTurns: options?.maxTurns || 50,
      currentTurn: 0,
      modelParams: {
        temperature: options?.modelParams?.temperature || 0.7,
        maxTokens: options?.modelParams?.maxTokens || 4096,
      }
    };
  }

  /**
   * Add a user message to the conversation
   */
  addUserMessage(content: string): void {
    this.history.push({
      role: 'user',
      content
    });
    this.currentState.currentTurn++;
  }

  addSystemMessage(content: string): void {
    this.history.push({
      role: 'system',
      content,
    });
  }

  /**
   * Add a tool result to the conversation
   */
  addToolResult(toolCallId: string, content: string): void {
    this.history.push({
      role: 'tool',
      content,
      tool_call_id: toolCallId
    });
    this.currentState.currentTurn++;
  }

  /**
   * Add an assistant message to the conversation
   */
  addAssistantMessage(content: string): void {
    this.history.push({
      role: 'assistant',
      content
    });
    this.currentState.currentTurn++;
  }

  addAssistantResponse(content: string, toolCalls?: ToolCall[]): void {
    this.history.push({
      role: 'assistant',
      content,
      tool_calls: toolCalls,
    });
    this.currentState.currentTurn++;
  }

  /**
   * Get the conversation history
   */
  getHistory(): UnifiedMessage[] {
    return [...this.history];
  }

  /**
   * Get the current engine state
   */
  getState(): any {
    return { ...this.currentState };
  }

  /**
   * Clear the conversation history (keeping system prompt)
   */
  clear(): void {
    this.history = [
      {
        role: 'system',
        content: this.systemPrompt
      }
    ];
    this.currentState.currentTurn = 0;
  }

  /**
   * Get whether we've reached maximum turns
   */
  isMaxTurnsReached(): boolean {
    return this.currentState.currentTurn >= this.currentState.maxTurns;
  }

  /**
   * Get the default model
   */
  getDefaultModel(): string {
    return this.defaultModel;
  }
}
