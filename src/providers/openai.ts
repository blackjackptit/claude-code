import { ProviderAdapter, ProviderCapabilities } from '../unified/provider-adapter'
import type { 
  UnifiedMessage, 
  UnifiedChatResponse,
  ToolCall
} from '../unified/message-format'

// Import OpenAI client
import OpenAI from 'openai'

export interface OpenAIConfig {
  apiKey: string;
  model?: string;
  baseURL?: string;
  [key: string]: unknown;
}

export class OpenAIProvider extends ProviderAdapter {
  private client: OpenAI;
  private settings: OpenAIConfig;

  constructor(config: OpenAIConfig) {
    super(config);
    this.settings = config;
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
    });
  }

  get providerName(): string {
    return 'openai';
  }

  get modelName(): string {
    return this.settings.model || 'gpt-4';
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
      const openAIMessages = this.transformToOpenAI(messages);
      
      const response = await this.client.chat.completions.create({
        model: this.modelName,
        messages: openAIMessages,
        tools: tools ? this.buildOpenAITools(tools) : undefined,
        tool_choice: tools ? 'auto' : undefined,
        max_tokens: 4096,
        temperature: 0.7,
      });

      return this.transformFromOpenAI(response);
    } catch (error) {
      throw new Error(`OpenAI API error: ${error}`);
    }
  }

  async* createStream(
    messages: UnifiedMessage[],
    tools?: ToolCall[]
  ): AsyncIterable<Partial<UnifiedChatResponse>> {
    try {
      const openAIMessages = this.transformToOpenAI(messages);

      const stream = await this.client.chat.completions.create({
        model: this.modelName,
        messages: openAIMessages,
        tools: tools ? this.buildOpenAITools(tools) : undefined,
        tool_choice: tools ? 'auto' : undefined,
        max_tokens: 4096,
        temperature: 0.7,
        stream: true,
      });

      for await (const chunk of stream) {
        const partial: Partial<UnifiedChatResponse> = {};
        
        if (chunk.choices && chunk.choices[0]?.delta?.content) {
          partial.content = chunk.choices[0].delta.content;
        }
        
        if (chunk.choices && chunk.choices[0]?.finish_reason) {
          partial.finish_reason = normalizeFinishReason(chunk.choices[0].finish_reason);
        }
        
        yield partial;
      }
    } catch (error) {
      throw new Error(`OpenAI streaming error: ${error}`);
    }
  }

  private transformToOpenAI(messages: UnifiedMessage[]): any[] {
    return messages.map(msg => {
      const openAIMessage: any = {
        role: msg.role,
        content: '',
      };

      if (typeof msg.content === 'string') {
        openAIMessage.content = msg.content;
      } else if (Array.isArray(msg.content)) {
        // Handle complex content with images, etc.
        openAIMessage.content = msg.content.map(part => {
          if (part.type === 'text') {
            return { type: 'text', text: part.text };
          } else if (part.type === 'image') {
            return { 
              type: 'image_url',
              image_url: part.image_url?.url || ''
            };
          }
          return { type: 'text', text: part.text || '' };
        });
      }

      if (msg.tool_call_id) {
        openAIMessage.tool_call_id = msg.tool_call_id;
      }

      if (msg.tool_calls) {
        openAIMessage.tool_calls = msg.tool_calls.map((toolCall) => ({
          id: toolCall.id,
          type: 'function',
          function: {
            name: toolCall.function.name,
            arguments: toolCall.function.arguments,
          },
        }));
      }

      return openAIMessage;
    });
  }

  private buildOpenAITools(tools: ToolCall[]): any[] {
    return tools.map(tool => ({
      type: 'function',
      function: {
        name: tool.function.name,
        description: tool.function.name, // Placeholder
        parameters: { type: 'object', properties: {} }
      }
    }));
  }

  private transformFromOpenAI(response: any): UnifiedChatResponse {
    const content = response.choices[0].message.content;
    
    return {
      id: response.id,
      model: response.model,
      role: 'assistant',
      content,
      finish_reason: response.choices[0].finish_reason || 'stop',
      usage: {
        input_tokens: response.usage?.prompt_tokens || 0,
        output_tokens: response.usage?.completion_tokens || 0,
      },
      tool_calls: response.choices[0].message.tool_calls ? 
        response.choices[0].message.tool_calls.map((tool: any) => ({
          id: tool.id,
          type: 'function',
          function: {
            name: tool.function.name,
            arguments: tool.function.arguments
          }
        })) : undefined
    };
  }

  transformToUnified(messages: unknown[]): UnifiedMessage[] {
    // Implementation will depend on the specific data structure returned from OpenAI
    return messages.map(msg => ({
      role: 'user',
      content: JSON.stringify(msg)
    }));
  }

  transformFromUnified(response: unknown): UnifiedChatResponse {
    // Implementation for transforming from unified format to OpenAI format
    return {
      id: 'unknown',
      model: this.modelName,
      role: 'assistant',
      content: JSON.stringify(response),
      finish_reason: 'stop'
    };
  }

  transformToolCalls(toolCalls: ToolCall[]): unknown {
    // Transform to OpenAI's tool call format
    return toolCalls.map(call => ({
      id: call.id,
      function: {
        name: call.function.name,
        arguments: call.function.arguments
      }
    }));
  }

  transformToProviderToolCall(toolCall: ToolCall): unknown {
    // For OpenAI
    return {
      function: {
        name: toolCall.function.name,
        arguments: toolCall.function.arguments
      }
    };
  }

  buildToolSchema(tool: ToolCall): unknown {
    return {
      type: 'function',
      function: {
        name: tool.function.name,
        description: tool.function.name,
        parameters: { type: 'object', properties: {} }
      }
    };
  }

  parseToolResult(response: unknown): any[] {
    // Extract tool results from OpenAI response
    return [];
  }
}

function normalizeFinishReason(
  reason: string | null
): UnifiedChatResponse['finish_reason'] {
  switch (reason) {
    case 'stop':
    case 'tool_calls':
    case 'length':
      return reason
    default:
      return 'other'
  }
}
