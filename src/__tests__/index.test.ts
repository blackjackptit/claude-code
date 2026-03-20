import { afterEach, describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { AgenticEngine } from '../engine'
import { buildRouterConfig } from '../config/provider-resolver'
import { loadRuntimeConfig } from '../config/runtime-config'
import { registerBuiltInProviders } from '../providers'
import { ProviderRouter } from '../router'
import type { ProviderCapabilities } from '../unified/provider-adapter'
import { ProviderAdapter } from '../unified/provider-adapter'
import type { UnifiedChatResponse, UnifiedMessage } from '../unified/message-format'
import { ProviderFactory } from '../unified/provider-adapter'

class MockProvider extends ProviderAdapter {
  get providerName(): string {
    return 'mock'
  }

  get modelName(): string {
    return 'mock-model'
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
    }
  }

  async createChatRequest(): Promise<UnifiedChatResponse> {
    return {
      id: 'test',
      model: 'mock-model',
      role: 'assistant',
      content: 'ok',
      finish_reason: 'stop',
    }
  }

  async *createStream(): AsyncIterable<Partial<UnifiedChatResponse>> {
    yield { content: 'ok' }
  }

  transformToUnified(): UnifiedMessage[] {
    return []
  }

  transformFromUnified(): UnifiedChatResponse {
    return {
      id: 'test',
      model: 'mock-model',
      role: 'assistant',
      content: 'ok',
      finish_reason: 'stop',
    }
  }

  transformToolCalls(): unknown {
    return []
  }

  transformToProviderToolCall(): unknown {
    return {}
  }

  buildToolSchema(): unknown {
    return {}
  }

  parseToolResult(): never[] {
    return []
  }
}

afterEach(() => {
  delete process.env.TEST_MULTI_PROVIDER_KEY
})

describe('ProviderFactory', () => {
  test('should register and create provider', () => {
    ProviderFactory.register('mock', MockProvider)
    const provider = ProviderFactory.create('mock')

    expect(provider.providerName).toBe('mock')
    expect(provider).toBeInstanceOf(MockProvider)
  })
})

describe('AgenticEngine', () => {
  test('should add user message', () => {
    const engine = new AgenticEngine('Test', 'mock-model')

    engine.addUserMessage('Hello')

    const history = engine.getHistory()
    expect(history[1].role).toBe('user')
    expect(history[1].content).toBe('Hello')
  })

  test('should track state', () => {
    const engine = new AgenticEngine('Test', 'mock-model', { maxTurns: 10 })

    expect(engine.getState().maxTurns).toBe(10)
  })
})

describe('ProviderRouter', () => {
  test('should return forced provider before applying Claude-first rules', async () => {
    registerBuiltInProviders()
    ProviderFactory.register('mock', MockProvider)

    const router = new ProviderRouter({
      defaultProvider: 'anthropic',
      providers: {
        anthropic: {
          adapter: ProviderFactory.create('mock'),
          priority: 10,
        },
        qwen: {
          adapter: ProviderFactory.create('mock'),
          priority: 5,
        },
      },
    })

    const selected = router.selectProvider(
      [{ role: 'user', content: 'Write some code' }],
      { forceProvider: 'qwen' }
    )

    expect(selected).toBe(router['providers'].get('qwen'))
  })
})

describe('runtime config', () => {
  test('should load configured non-Claude providers from file', async () => {
    registerBuiltInProviders()
    process.env.TEST_MULTI_PROVIDER_KEY = 'test-key'

    const tempDir = mkdtempSync(join(tmpdir(), 'claude-code-'))
    const configPath = join(tempDir, 'config.json')

    writeFileSync(
      configPath,
      JSON.stringify({
        defaultProvider: 'custom-openai',
        providers: {
          'custom-openai': {
            type: 'openai',
            apiKey: '${TEST_MULTI_PROVIDER_KEY}',
            model: 'gpt-4o-mini',
            baseURL: 'https://example.com/v1',
          },
        },
      })
    )

    const config = await loadRuntimeConfig(configPath)
    const routerConfig = buildRouterConfig(config, {
      provider: 'custom-openai',
      model: 'gpt-4.1-mini',
    })

    expect(config.defaultProvider).toBe('custom-openai')
    expect(config.providers['custom-openai'].apiKey).toBe('test-key')
    expect(routerConfig.defaultProvider).toBe('custom-openai')
    expect(routerConfig.providers['custom-openai'].adapter.modelName).toBe('gpt-4.1-mini')

    rmSync(tempDir, { recursive: true, force: true })
  })
})
