import { ProviderFactory } from '../unified/provider-adapter'
import { AnthropicProvider } from './anthropic'
import { BedrockProvider } from './bedrock'
import { OpenAIProvider } from './openai'

let registered = false

export function registerBuiltInProviders(): void {
  if (registered) {
    return
  }

  ProviderFactory.register('anthropic', AnthropicProvider)
  ProviderFactory.register('bedrock', BedrockProvider)
  ProviderFactory.register('openai', OpenAIProvider)
  registered = true
}

export { AnthropicProvider, BedrockProvider, OpenAIProvider }
