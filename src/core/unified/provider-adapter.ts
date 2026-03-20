// Provider Adapter Interface
import type {
  UnifiedMessage,
  ChatResponse,
  StreamingDelta,
  ToolSchema,
  ProviderCapabilities,
} from '../unified'

/**
 * Abstract base class for all provider adapters
 */
export abstract class ProviderAdapter {
  /**
   * Unique identifier for this provider
   */
  abstract get providerName(): string

  /**
   * Model name being used
   */
  abstract get modelName(): string

  /**
   * Provider capabilities
   */
  abstract get capabilities(): ProviderCapabilities

  /**
   * Create a chat completion request
   */
  abstract createChatRequest(
    messages: UnifiedMessage[],
    tools?: ToolSchema[],
    temperature?: number,
    maxTokens?: number
  ): Promise<ChatResponse>

  /**
   * Create a streaming chat completion
   */
  abstract createStream(
    messages: UnifiedMessage[],
    tools?: ToolSchema[],
    temperature?: number,
    maxTokens?: number
  ): ReadableStream<StreamingDelta>

  /**
   * Transform provider-specific messages to unified format
   */
  abstract transformToUnified(messages: unknown[]): UnifiedMessage[]

  /**
   * Transform unified messages to provider-specific format
   */
  abstract transformFromUnified(messages: UnifiedMessage[]): unknown[]

  /**
   * Transform provider tool calls to unified format
   */
  abstract transformToolCalls(toolCalls: unknown[]): UnifiedMessage

  /**
   * Transform unified tool calls to provider format
   */
  abstract transformToProviderToolCall(toolCall: UnifiedMessage): unknown

  /**
   * Build tool schema for this provider
   */
  abstract buildToolSchema(schemas: ToolSchema[]): unknown

  /**
   * Parse tool result from provider response
   */
  abstract parseToolResult(response: unknown): { tool_call_id: string; content: string }[]
}

/**
 * Response streaming interface
 */
export interface StreamSubscription {
  onDelta: (delta: StreamingDelta) => void
  onComplete: (response: ChatResponse) => void
  onError: (error: Error) => void
}

/**
 * Factory for creating providers
 */
export class ProviderFactory {
  private static adapters = new Map<string, new () => ProviderAdapter>()

  static register(
    name: string,
    adapterClass: new () => ProviderAdapter
  ): void {
    this.adapters.set(name, adapterClass)
  }

  static create(name: string): ProviderAdapter {
    const adapterClass = this.adapters.get(name)
    if (!adapterClass) {
      throw new Error(`Provider not found: ${name}`)
    }
    return new adapterClass()
  }

  static list(): string[] {
    return Array.from(this.adapters.keys())
  }
}
