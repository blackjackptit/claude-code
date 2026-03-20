// CLI Interface for Multi-Provider LLM Coding Assistant

import { readFileSync } from 'node:fs'
import type { ProviderAdapter } from '../unified/provider-adapter'
import { AgenticEngine } from '../engine'
import { buildRouterConfig } from '../config/provider-resolver'
import {
  loadRuntimeConfig,
  loadStoredRuntimeConfig,
  saveStoredRuntimeConfig,
  type RuntimeProviderDefinition,
} from '../config/runtime-config'
import { registerBuiltInProviders } from '../providers'
import { ProviderRouter, type RoutingContext } from '../router'
import type { UnifiedChatResponse } from '../unified/message-format'

export interface CLIOptions {
  provider?: string
  model?: string
  prompt?: string
  file?: string
  configPath?: string
  interactive?: boolean
  maxTurns?: number
  temperature?: number
  verbose?: boolean
}

/**
 * Main CLI entry point
 */
export async function runCLI(options: CLIOptions): Promise<void> {
  registerBuiltInProviders()

  console.log('🚀 Multi-Provider LLM Coding Assistant')
  console.log()

  const runtimeConfig = await loadRuntimeConfig(options.configPath)
  const providerConfig = buildRouterConfig(runtimeConfig, {
    provider: options.provider,
    model: options.model,
  })
  const router = new ProviderRouter(providerConfig)
  const requestedProvider = options.provider
  const selectedProviderName = requestedProvider || providerConfig.defaultProvider
  const selectedProvider = router.getProvider(selectedProviderName)

  if (options.verbose) {
    console.log(`🌐 Provider alias: ${selectedProviderName}`)
    console.log(`🧩 Provider type: ${selectedProvider.providerName}`)
    console.log(`🤖 Model: ${selectedProvider.modelName}`)
    console.log()
  }

  // Read input
  let prompt = options.prompt
  if (!prompt && options.file) {
    prompt = readFileSync(options.file, 'utf-8')
  }

  if (!prompt && !options.interactive) {
    console.error('No input provided. Use --prompt, --file, or --interactive')
    process.exit(1)
  }

  // Initialize engine
  const engine = new AgenticEngine(
    'You are a helpful coding assistant. Provide clear, efficient solutions.',
    selectedProvider.modelName,
    {
      maxTurns: options.maxTurns || runtimeConfig.defaults.maxTurns || 50,
      modelParams: {
        temperature: options.temperature ?? runtimeConfig.defaults.temperature,
        maxTokens: runtimeConfig.defaults.maxTokens,
      },
    }
  )

  if (prompt) {
    engine.addUserMessage(prompt)
  }

  const routingContext: RoutingContext | undefined = requestedProvider
    ? { forceProvider: requestedProvider }
    : undefined

  if (options.interactive) {
    await runInteractiveLoop(engine, router, options, selectedProvider, routingContext)
  } else {
    await processSingleRequest(engine, router, options, selectedProvider, routingContext)
  }
}

/**
 * Process a single request
 */
async function processSingleRequest(
  engine: AgenticEngine,
  router: ProviderRouter,
  options: CLIOptions,
  provider: ProviderAdapter,
  routingContext?: RoutingContext
): Promise<void> {
  const response = await router.sendChatRequest(
    engine.getHistory(),
    undefined, // Let the proxy handle tools
    routingContext
  )

  appendAssistantResponse(engine, response)

  if (options.verbose) {
    console.log(response)
  } else {
    console.log(formatResponse(response))
  }
}

/**
 * Interactive loop for conversation
 */
async function runInteractiveLoop(
  engine: AgenticEngine,
  router: ProviderRouter,
  options: CLIOptions,
  provider: ProviderAdapter,
  routingContext?: RoutingContext
): Promise<void> {
  const readline = await import('readline')
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '> ',
  })

  console.log('Start typing your prompt. Type "quit" to exit.')
  console.log()

  rl.prompt()

  rl.on('line', async (line) => {
    const trimmed = line.trim()

    if (trimmed.toLowerCase() === 'quit' || trimmed.toLowerCase() === 'exit') {
      rl.close()
      return
    }

    engine.addUserMessage(trimmed)

    try {
      const response = await router.sendChatRequest(
        engine.getHistory(),
        undefined, // Let the proxy handle tools
        routingContext
      )
      appendAssistantResponse(engine, response)

      if (options.verbose) {
        console.log(response)
      } else {
        console.log(formatResponse(response))
      }

      rl.prompt()
    } catch (error) {
      console.error('Error:', error)
      rl.prompt()
    }
  })

  rl.on('close', () => {
    console.log('Goodbye!')
    process.exit(0)
  })
}

/**
 * Format response for display
 */
function formatResponse(response: UnifiedChatResponse): string {
  let output = ''

  // Handle content
  const content = Array.isArray(response.content)
    ? response.content.map((c: any) => c.text || '').join('\n')
    : response.content
  output += content + '\n\n'

  // Handle tool calls
  if (response.tool_calls && response.tool_calls.length > 0) {
    output += 'Tool calls:\n'
    for (const toolCall of response.tool_calls) {
      output += `  - ${toolCall.function.name}()\n`
    }
  }

  // Handle usage
  if (response.usage) {
    output += `\nTokens: 📊 Input: ${response.usage.input_tokens}, Output: ${response.usage.output_tokens}\n`
  }

  return output.trim()
}

function appendAssistantResponse(
  engine: AgenticEngine,
  response: UnifiedChatResponse
): void {
  const text = Array.isArray(response.content)
    ? response.content
        .map((part) => ('text' in part && typeof part.text === 'string' ? part.text : ''))
        .join('\n')
        .trim()
    : response.content

  engine.addAssistantResponse(text || '[assistant response]', response.tool_calls)
}

/**
 * Provider management commands
 */
export async function manageProviders(
  command: 'list' | 'add' | 'remove' | 'set-default',
  name?: string,
  config?: RuntimeProviderDefinition,
  configPath?: string
): Promise<void> {
  switch (command) {
    case 'list': {
      const runtimeConfig = await loadRuntimeConfig(configPath)
      console.log('Available providers:')
      console.log(`Default: ${runtimeConfig.defaultProvider}`)
      for (const [providerName, providerConfig] of Object.entries(runtimeConfig.providers)) {
        console.log(`  - ${providerName}`)
        console.log(`    Type: ${providerConfig.type}`)
        console.log(`    Model: ${providerConfig.model || 'not set'}`)
      }
      break
    }

    case 'add':
      if (!name || !config) {
        console.error('Provider name and config required')
        process.exit(1)
      }
      {
        const storedConfig = await loadStoredRuntimeConfig(configPath)
        storedConfig.providers[name] = { ...storedConfig.providers[name], ...config, enabled: true }
        if (!storedConfig.defaultProvider) {
          storedConfig.defaultProvider = name
        }
        await saveStoredRuntimeConfig(storedConfig, configPath)
      }
      console.log(`✅ Added provider: ${name}`)
      break

    case 'remove':
      if (!name) {
        console.error('Provider name required')
        process.exit(1)
      }
      {
        const storedConfig = await loadStoredRuntimeConfig(configPath)
        delete storedConfig.providers[name]
        if (storedConfig.defaultProvider === name) {
          storedConfig.defaultProvider =
            Object.keys(storedConfig.providers)[0] || 'anthropic'
        }
        await saveStoredRuntimeConfig(storedConfig, configPath)
      }
      console.log(`❌ Removed provider: ${name}`)
      break

    case 'set-default':
      if (!name) {
        console.error('Provider name required')
        process.exit(1)
      }
      {
        const runtimeConfig = await loadRuntimeConfig(configPath)
        if (!runtimeConfig.providers[name]) {
          console.error(`Provider '${name}' is not configured`)
          process.exit(1)
        }

        const storedConfig = await loadStoredRuntimeConfig(configPath)
        storedConfig.defaultProvider = name
        await saveStoredRuntimeConfig(storedConfig, configPath)
      }
      console.log(`⭐ Set ${name} as default`)
      break
  }
}
