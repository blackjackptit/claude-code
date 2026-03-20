/**
 * Unified message format for cross-provider compatibility
 */
export interface ContentPart {
  type: 'text' | 'image' | 'tool_result';
  text?: string;
  image_url?: {
    url: string;
  };
  tool_call_id?: string;
  tool_result?: {
    content: string;
  };
}

export interface UnifiedMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string | ContentPart[];
  name?: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

export interface ToolResult {
  tool_call_id: string;
  content: string;
}

// Unified interface for chat responses
export interface UnifiedChatResponse {
  id: string;
  model: string;
  role: 'assistant';
  content: string | ContentPart[];
  finish_reason: 'stop' | 'tool_calls' | 'length' | 'error' | 'other';
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
  tool_calls?: ToolCall[];
}
