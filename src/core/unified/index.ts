// Unified Abstractions for Multi-Provider LLM Coding Assistant

/**
 * Unified message format that works across all providers
 */
export interface UnifiedMessage {
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string | Array<ContentPart>
  name?: string
  tool_call_id?: string
  tool_calls?: ToolCall[]
}

/**
 * Content parts for rich messages (images, text, etc.)
 */
export interface ContentPart {
  type: 'text' | 'image_url' | 'tool_use' | 'tool_result'
  text?: string
  image_url?: ImageURL
  tool_use_id?: string
  tool_result?: ToolResult
}

/**
 * Image URL reference
 */
export interface ImageURL {
  url: string
  detail?: 'auto' | 'low' | 'high'
}

/**
 * Tool call object
 */
export interface ToolCall {
  id: string
  type: 'function'
  function: FunctionCall
}

/**
 * Function call details
 */
export interface FunctionCall {
  name: string
  arguments: string
}

/**
 * Tool result from execution
 */
export interface ToolResult {
  content: string | Array<{ type: 'text'; text: string }>
  is_error?: boolean
}

/**
 * Chat response from provider
 */
export interface ChatResponse {
  id: string
  model: string
  role: 'assistant'
  content: string | Array<ContentPart>
  tool_calls?: ToolCall[]
  usage?: TokenUsage
  finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filtered'
}

/**
 * Token usage metrics
 */
export interface TokenUsage {
  input_tokens: number
  output_tokens: number
  total_tokens: number
  [key: string]: number | undefined  // Allow provider-specific fields
}

/**
 * Tool schema for function calling
 */
export interface ToolSchema {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
    strict?: boolean
  }
}

/**
 * Provider capabilities
 */
export interface ProviderCapabilities {
  supportsTools: boolean
  supportsToolChoice: boolean
  supportsStreaming: boolean
  supportsTemperature: boolean
  supportsMaxTokens: boolean
  supportsSystemPrompt: boolean
  supportsImages: boolean
}

/**
 * Provider configuration
 */
export interface ProviderConfig {
  name: string
  providerType: 'anthropic' | 'openai' | 'custom'
  apiKey: string
  basePath?: string
  models: string[]
  capabilities: Partial<ProviderCapabilities>
  [key: string]: unknown
}

/**
 * Streaming delta for partial responses
 */
export interface StreamingDelta {
  content?: string
  tool_calls?: ToolCall[]
  role?: 'assistant'
  finish_reason?: string
  usage?: TokenUsage
}

/**
 * Error types
 */
export class ProviderError extends Error {
  constructor(
    public message: string,
    public provider: string,
    public statusCode?: number,
    public details?: unknown
  ) {
    super(message)
    this.name = 'ProviderError'
  }
}

export class ConfigurationError extends Error {
  constructor(public message: string) {
    super(message)
    this.name = 'ConfigurationError'
  }
}
