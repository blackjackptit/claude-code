// Engine: The main agentic coding engine
import type {
  UnifiedMessage,
  ToolSchema,
  ChatResponse,
} from '../unified'

/**
 * Tool execution result
 */
export interface ToolExecutionResult {
  tool_call_id: string
  content: string
  is_error?: boolean
}

/**
 * Agent state
 */
export interface AgentState {
  history: UnifiedMessage[]
  currentTurn: number
  maxTurns: number
  toolCount: number
}

/**
 * Tool execution context
 */
export interface ToolExecutionContext {
  workspace: string
  files: string[]
  gitStatus?: string
  [key: string]: unknown
}

/**
 * Engine options
 */
export interface EngineOptions {
  maxTurns?: number
  maxToolCallsPerTurn?: number
  modelParams?: {
    temperature?: number
    maxTokens?: number
    topP?: number
  }
  systemPrompt?: string
}

/**
 * Main engine that orchestrates the agent
 */
export class AgenticEngine {
  private messages: UnifiedMessage[]
  private state: AgentState
  private options: EngineOptions
  private systemPrompt: string

  constructor(
    initialSystemPrompt: string,
    private defaultModel: string,
    options: EngineOptions = {}
  ) {
    this.systemPrompt = initialSystemPrompt
    this.options = {
      maxTurns: 50,
      maxToolCallsPerTurn: 5,
      modelParams: {},
      ...options,
    }

    this.messages = [
      { role: 'system', content: this.systemPrompt },
    ]

    this.state = {
      history: [],
      currentTurn: 0,
      maxTurns: this.options.maxTurns,
      toolCount: 0,
    }
  }

  /**
   * Add a user message
   */
  addUserMessage(content: string | string[]): void {
    this.messages.push({
      role: 'user',
      content: Array.isArray(content) ? content : content,
    })
  }

  /**
   * Add a tool result message
   */
  addToolResult(toolCallId: string, content: string, isError = false): void {
    this.messages.push({
      role: 'tool',
      content: Array.isArray(content) ? content : content,
      tool_call_id: toolCallId,
    })
  }

  /**
   * Get current state
   */
  getState(): AgentState {
    return this.state
  }

  /**
   * Get message history
   */
  getHistory(): UnifiedMessage[] {
    return this.messages
  }

  /**
   * Process a single turn
   */
  async processTurn(
    sendRequest: (
      messages: UnifiedMessage[],
      tools?: ToolSchema[]
    ) => Promise<ChatResponse>
  ): Promise<ChatResponse> {
    this.state.currentTurn++
    const turnMessages = this.messages.slice()

    const response = await sendRequest(turnMessages)

    this.messages.push({
      role: response.role,
      content: response.content,
      tool_calls: response.tool_calls,
    })

    this.state.history.push({
      role: response.role,
      content: response.content,
    })

    return response
  }

  /**
   * Execute tool calls from a response
   */
  async executeToolCalls(
    response: ChatResponse,
    toolExecutor: (
      toolCall: { id: string; name: string; arguments: string }
    ) => Promise<ToolExecutionResult>
  ): Promise<ToolExecutionResult[]> {
    if (!response.tool_calls || !this.options.maxToolCallsPerTurn) {
      return []
    }

    const results: ToolExecutionResult[] = []

    for (const toolCall of response.tool_calls) {
      if (this.state.toolCount >= this.options.maxToolCallsPerTurn) {
        break
      }

      try {
        const result = await toolExecutor({
          id: toolCall.id,
          name: toolCall.function.name,
          arguments: toolCall.function.arguments,
        })

        this.addToolResult(result.tool_call_id, result.content, result.is_error)
        this.state.toolCount++

        results.push(result)
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error)
        this.addToolResult(toolCall.id, errorMsg, true)
      }
    }

    return results
  }

  /**
   * Run the full agent loop
   */
  async run(
    sendRequest: (
      messages: UnifiedMessage[],
      tools?: ToolSchema[]
    ) => Promise<ChatResponse>,
    toolExecutor?: (
      toolCall: { id: string; name: string; arguments: string }
    ) => Promise<ToolExecutionResult>
  ): Promise<UnifiedMessage[]> {
    while (this.state.currentTurn < this.state.maxTurns) {
      const response = await this.processTurn(sendRequest)

      // If no tool calls, we're done
      if (!response.tool_calls || response.tool_calls.length === 0) {
        break
      }

      // Execute tool calls if executor provided
      if (toolExecutor) {
        await this.executeToolCalls(response, toolExecutor)
      }
    }

    return this.messages
  }

  /**
   * Run with streaming
   */
  async runStream(
    createStream: (
      messages: UnifiedMessage[],
      tools?: ToolSchema[]
    ) => ReadableStream<ChatResponse>,
    onToken: (token: string) => void,
    onToolCall?: (toolCall: any) => void
  ): Promise<void> {
    const turnMessages = this.messages.slice()
    const stream = createStream(turnMessages)

    const reader = stream.getReader()
    const decoder = new TextDecoder()

    let fullContent = ''
    let toolCalls: any[] = []

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      const delta = JSON.parse(decoder.decode(value, { stream: true }))

      if (delta.content) {
        fullContent += delta.content
        onToken(delta.content)
      }

      if (delta.tool_calls) {
        toolCalls.push(...delta.tool_calls)
        if (onToolCall) {
          delta.tool_calls.forEach(onToolCall)
        }
      }
    }

    this.messages.push({
      role: 'assistant',
      content: fullContent,
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
    })
  }
}
