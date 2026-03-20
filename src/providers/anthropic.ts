import { ProviderAdapter, ProviderCapabilities } from '../unified/provider-adapter'
import type { 
  UnifiedMessage, 
  UnifiedChatResponse,
  ToolCall
} from '../unified/message-format'

// Import Anthropic client
import { Anthropic } from '@anthropic-ai/sdk'

export interface AnthropicConfig {
  apiKey: string;
  model?: string;
  baseURL?: string;
  [key: string]: unknown;
}

export class AnthropicProvider extends ProviderAdapter {
  private client: Anthropic;
  private settings: AnthropicConfig;

  constructor(config: AnthropicConfig) {
    super(config);
    this.settings = config;
    this.client = new Anthropic({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
    });
  }

  get providerName(): string {
    return 'anthropic';
  }

  get modelName(): string {
    return this.settings.model || 'claude-3-5-sonnet-20241022';
  }

  get capabilities(): ProviderCapabilities {
    return {
      supportsTools: true,
      supportsToolChoice: true,
      supportsStreaming: true,
      supportsTemperature: true,
      supportsMaxTokens: true,
      supportsSystemPrompt: true,
      supportsImages: true,
    };
  }

  async createChatRequest(
    messages: UnifiedMessage[],
    tools?: ToolCall[]
  ): Promise<UnifiedChatResponse> {
    try {
      const anthropicMessages = this.transformToAnthropic(messages);
      
      const response = await this.client.messages.create({
        model: this.modelName,
        messages: anthropicMessages,
        tools: tools ? this.buildAnthropicTools(tools) : undefined,
        max_tokens: 4096,
        temperature: 0.7,
      });

      return this.transformFromAnthropic(response);
    } catch (error) {
      throw new Error(`Anthropic API error: ${error}`);
    }
  }

  async* createStream(
    messages: UnifiedMessage[],
    tools?: ToolCall[]
  ): AsyncIterable<Partial<UnifiedChatResponse>> {
    try {
      const anthropicMessages = this.transformToAnthropic(messages);
      
      const stream = await this.client.messages.stream({
        model: this.modelName,
        messages: anthropicMessages,
        tools: tools ? this.buildAnthropicTools(tools) : undefined,
        max_tokens: 4096,
        temperature: 0.7,
      });

      for await (const chunk of stream) {
        const partial: Partial<UnifiedChatResponse> = {};
        
        if (chunk.type === 'content_block_delta' && 'text' in chunk.delta) {
          partial.content = chunk.delta.text;
        }
        
        if (chunk.type === 'message_stop') {
          partial.finish_reason = 'stop';
        }
        
        yield partial;
      }
    } catch (error) {
      throw new Error(`Anthropic streaming error: ${error}`);
    }
  }

  private transformToAnthropic(messages: UnifiedMessage[]): any[] {
    return messages.map(msg => {
      if (msg.role === 'system') {
        // System messages are handled differently in Anthropic
        return {
          role: 'user',
          content: msg.content
        };
      }

      // Handle tool result messages
      if (msg.role === 'tool' && msg.tool_call_id) {
        return {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: msg.tool_call_id,
              content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
            }
          ]
        };
      }

      const anthropicMessage: any = {
        role: msg.role === 'tool' ? 'user' : msg.role,
        content: [],
      };

      // Add text content first
      if (typeof msg.content === 'string') {
        // Only add text if it's not empty
        if (msg.content.trim()) {
          anthropicMessage.content.push({
            type: 'text',
            text: msg.content
          });
        }
      } else {
        // Handle mixed content parts
        for (const part of msg.content) {
          if (part.type === 'text' && part.text?.trim()) {
            anthropicMessage.content.push({
              type: 'text',
              text: part.text
            });
          } else if (part.type === 'image') {
            anthropicMessage.content.push({
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/jpeg', // Default for now
                data: part.image_url?.url?.split(',')[1] // Extract base64 from data URL
              }
            });
          }
        }
      }

      // Add tool calls if present (for assistant messages)
      if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
        for (const toolCall of msg.tool_calls) {
          anthropicMessage.content.push({
            type: 'tool_use',
            id: toolCall.id,
            name: toolCall.function.name,
            input: JSON.parse(toolCall.function.arguments || '{}')
          });
        }
      }

      // If content is empty and no tool calls, add a placeholder
      if (anthropicMessage.content.length === 0) {
        anthropicMessage.content.push({
          type: 'text',
          text: '.'
        });
      }

      return anthropicMessage;
    });
  }

  private buildAnthropicTools(tools: ToolCall[]): any[] {
    return tools.map(tool => ({
      name: tool.function.name,
      description: tool.function.description || tool.function.name,
      input_schema: tool.function.parameters || { type: 'object', properties: {} }
    }));
  }

  private transformFromAnthropic(response: any): UnifiedChatResponse {
    const content = response.content.reduce((acc: string, part: any) => {
      if (part.type === 'text') {
        return acc + part.text;
      }
      return acc;
    }, '');

    // Extract tool calls from content blocks
    const toolCalls = response.content
      .filter((part: any) => part.type === 'tool_use')
      .map((tool: any) => ({
        id: tool.id,
        type: 'function' as const,
        function: {
          name: tool.name,
          arguments: JSON.stringify(tool.input || {})
        }
      }));

    return {
      id: response.id,
      model: response.model,
      role: 'assistant',
      content,
      finish_reason: response.stop_reason || 'stop',
      usage: {
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
      },
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined
    };
  }

  transformToUnified(messages: unknown[]): UnifiedMessage[] {
    // Implementation will depend on the specific data structure returned from Anthropic
    return messages.map(msg => ({
      role: 'user',
      content: JSON.stringify(msg)
    }));
  }

  transformFromUnified(response: unknown): UnifiedChatResponse {
    // Implementation for transforming from unified format to Anthropic format
    return {
      id: 'unknown',
      model: this.modelName,
      role: 'assistant',
      content: JSON.stringify(response),
      finish_reason: 'stop'
    };
  }

  transformToolCalls(toolCalls: ToolCall[]): unknown {
    // Transform to Anthropic's tool call format
    return toolCalls.map(call => ({
      id: call.id,
      name: call.function.name,
      input: JSON.parse(call.function.arguments)
    }));
  }

  transformToProviderToolCall(toolCall: ToolCall): unknown {
    return {
      name: toolCall.function.name,
      input: JSON.parse(toolCall.function.arguments)
    };
  }

  buildToolSchema(tool: ToolCall): unknown {
    return {
      name: tool.function.name,
      input_schema: { type: 'object', properties: {} }
    };
  }

  parseToolResult(response: unknown): any[] {
    // Extract tool results from Anthropic response
    return [];
  }
}
