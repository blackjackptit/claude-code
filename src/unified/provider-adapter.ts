import type { 
  UnifiedMessage, 
  UnifiedChatResponse,
  ToolCall,
  ToolResult
} from './message-format'

type ProviderConstructor = new (config: any) => ProviderAdapter

/**
 * Provider capabilities interface
 */
export interface ProviderCapabilities {
  supportsTools: boolean;
  supportsToolChoice: boolean;
  supportsStreaming: boolean;
  supportsTemperature: boolean;
  supportsMaxTokens: boolean;
  supportsSystemPrompt: boolean;
  supportsImages: boolean;
}

/**
 * Base provider adapter interface
 */
export abstract class ProviderAdapter {
  protected config: Record<string, unknown>;

  constructor(config: Record<string, unknown>) {
    this.config = config;
  }

  /**
   * Human-readable name of the provider
   */
  abstract get providerName(): string;

  /**
   * Current model name
   */
  abstract get modelName(): string;

  /**
   * Provider capabilities
   */
  abstract get capabilities(): ProviderCapabilities;

  /**
   * Create a chat request
   */
  abstract createChatRequest(
    messages: UnifiedMessage[], 
    tools?: ToolCall[]
  ): Promise<UnifiedChatResponse>;

  /**
   * Create a streaming request
   */
  abstract createStream(
    messages: UnifiedMessage[], 
    tools?: ToolCall[]
  ): AsyncIterable<Partial<UnifiedChatResponse>>;

  /**
   * Transform messages to provider format
   */
  abstract transformToUnified(messages: unknown[]): UnifiedMessage[];

  /**
   * Transform response from provider to unified format
   */
  abstract transformFromUnified(response: unknown): UnifiedChatResponse;

  /**
   * Transform tool calls from unified format
   */
  abstract transformToolCalls(toolCalls: ToolCall[]): unknown;

  /**
   * Transform to provider-specific tool call format
   */
  abstract transformToProviderToolCall(toolCall: ToolCall): unknown;

  /**
   * Build tool schema for this provider
   */
  abstract buildToolSchema(tool: ToolCall): unknown;

  /**
   * Parse tool result from provider format
   */
  abstract parseToolResult(response: unknown): ToolResult[];
}

/**
 * Provider factory for dynamic registration
 */
export class ProviderFactory {
  private static providers: Map<string, ProviderConstructor> = new Map();

  /**
   * Register a provider adapter
   */
  static register(name: string, provider: ProviderConstructor): void {
    this.providers.set(name, provider);
  }

  /**
   * Create a provider instance
   */
  static create(name: string, config?: Record<string, unknown>): ProviderAdapter {
    const ProviderClass = this.providers.get(name);
    if (!ProviderClass) {
      throw new Error(`Provider '${name}' not registered`);
    }
    return new ProviderClass(config || {});
  }

  /**
   * Get all registered provider names
   */
  static getAllNames(): string[] {
    return Array.from(this.providers.keys());
  }
}
