import {
  BedrockRuntimeClient,
  ConverseCommand,
  type ConverseCommandInput,
} from '@aws-sdk/client-bedrock-runtime'
import { fromIni } from '@aws-sdk/credential-providers'
import { ProviderAdapter, type ProviderCapabilities } from '../unified/provider-adapter'
import type {
  ToolCall,
  ToolResult,
  UnifiedChatResponse,
  UnifiedMessage,
} from '../unified/message-format'

export interface BedrockConfig {
  model?: string
  region?: string
  profile?: string
  [key: string]: unknown
}

export class BedrockProvider extends ProviderAdapter {
  private client: BedrockRuntimeClient
  private settings: BedrockConfig

  constructor(config: BedrockConfig) {
    super(config)
    this.settings = config

    this.client = new BedrockRuntimeClient({
      region: config.region || process.env.BEDROCK_REGION || process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1',
      credentials: config.profile ? fromIni({ profile: config.profile }) : undefined,
    })
  }

  get providerName(): string {
    return 'bedrock'
  }

  get modelName(): string {
    return this.settings.model || 'us.deepseek.r1-v1:0'
  }

  get capabilities(): ProviderCapabilities {
    return {
      supportsTools: false,
      supportsToolChoice: false,
      supportsStreaming: false,
      supportsTemperature: true,
      supportsMaxTokens: true,
      supportsSystemPrompt: true,
      supportsImages: false,
    }
  }

  async createChatRequest(
    messages: UnifiedMessage[],
    _tools?: ToolCall[]
  ): Promise<UnifiedChatResponse> {
    const system = messages
      .filter((message) => message.role === 'system')
      .map((message) => ({ text: this.contentToText(message.content) }))
      .filter((part) => part.text.length > 0)

    const bedrockMessages = messages
      .filter((message) => message.role !== 'system')
      .map((message) => this.toBedrockMessage(message))

    const request: ConverseCommandInput = {
        modelId: this.modelName,
        system: system.length > 0 ? system : undefined,
        messages: bedrockMessages as unknown as ConverseCommandInput['messages'],
        inferenceConfig: {
          temperature: 0.7,
          maxTokens: 4096,
        },
      }

    const response = await this.client.send(
      new ConverseCommand(request)
    )

    const text = (response.output?.message?.content || [])
      .map((part) => ('text' in part && typeof part.text === 'string' ? part.text : ''))
      .join('\n')
      .trim()
    const toolCalls: ToolCall[] = []
    for (const part of response.output?.message?.content || []) {
      if (!('toolUse' in part) || !part.toolUse?.toolUseId || !part.toolUse.name) {
        continue
      }

      toolCalls.push({
        id: part.toolUse.toolUseId,
        type: 'function',
        function: {
          name: part.toolUse.name,
          arguments: JSON.stringify(part.toolUse.input || {}),
        },
      })
    }

    return {
      id: response.$metadata.requestId || 'bedrock-response',
      model: this.modelName,
      role: 'assistant',
      content: text,
      finish_reason: normalizeBedrockStopReason(response.stopReason),
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: {
        input_tokens: response.usage?.inputTokens || 0,
        output_tokens: response.usage?.outputTokens || 0,
      },
    }
  }

  async *createStream(
    messages: UnifiedMessage[],
    tools?: ToolCall[]
  ): AsyncIterable<Partial<UnifiedChatResponse>> {
    const response = await this.createChatRequest(messages, tools)
    yield response
  }

  transformToUnified(messages: unknown[]): UnifiedMessage[] {
    return messages.map((message) => ({
      role: 'user',
      content: JSON.stringify(message),
    }))
  }

  transformFromUnified(response: unknown): UnifiedChatResponse {
    return {
      id: 'bedrock-response',
      model: this.modelName,
      role: 'assistant',
      content: JSON.stringify(response),
      finish_reason: 'stop',
    }
  }

  transformToolCalls(toolCalls: ToolCall[]): unknown {
    return toolCalls
  }

  transformToProviderToolCall(toolCall: ToolCall): unknown {
    return toolCall
  }

  buildToolSchema(tool: ToolCall): unknown {
    return tool
  }

  parseToolResult(response: unknown): ToolResult[] {
    return response ? [] : []
  }

  private toBedrockMessage(message: UnifiedMessage): {
    role: 'user' | 'assistant'
    content: Array<Record<string, unknown>>
  } {
    if (message.role === 'tool') {
      return {
        role: 'user',
        content: [
          {
            text: `Tool result${message.tool_call_id ? ` for ${message.tool_call_id}` : ''}:\n${this.contentToText(message.content)}`,
          },
        ],
      }
    }

    if (message.role === 'assistant' && message.tool_calls && message.tool_calls.length > 0) {
      return {
        role: 'assistant',
        content: message.tool_calls.map((toolCall) => ({
          toolUse: {
            toolUseId: toolCall.id,
            name: toolCall.function.name,
            input: JSON.parse(toolCall.function.arguments || '{}'),
          },
        })),
      }
    }

    return {
      role: message.role === 'assistant' ? 'assistant' : 'user',
      content: [{ text: this.contentToText(message.content) }],
    }
  }

  private contentToText(content: UnifiedMessage['content']): string {
    if (typeof content === 'string') {
      return content
    }

    return content
      .map((part) => {
        if (part.type === 'text') {
          return part.text || ''
        }

        if (part.type === 'tool_result') {
          return part.tool_result?.content || ''
        }

        return ''
      })
      .filter(Boolean)
      .join('\n')
  }
}

function normalizeBedrockStopReason(reason?: string): UnifiedChatResponse['finish_reason'] {
  switch (reason) {
    case 'end_turn':
      return 'stop'
    case 'max_tokens':
      return 'length'
    case 'tool_use':
      return 'tool_calls'
    default:
      return 'other'
  }
}
