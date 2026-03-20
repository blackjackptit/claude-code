import { DefaultRouterRules, type RouterConfig, type RoutingRule } from '../router'
import { ProviderFactory } from '../unified/provider-adapter'
import type {
  RuntimeConfig,
  RuntimeProviderDefinition,
  RuntimeRoutingRuleDefinition,
} from './runtime-config'

export interface ProviderOverrideOptions {
  provider?: string
  model?: string
}

const ROUTE_CONDITIONS: Record<
  RuntimeRoutingRuleDefinition['condition'],
  typeof DefaultRouterRules.codingTask
> = {
  coding: DefaultRouterRules.codingTask,
  creative: DefaultRouterRules.creativeTask,
  analysis: DefaultRouterRules.analysisTask,
  complex: DefaultRouterRules.complexTask,
}

function getProviderBaseURL(provider: RuntimeProviderDefinition): string | undefined {
  const baseURL = provider.baseURL
  if (typeof baseURL === 'string') {
    return baseURL
  }

  const legacyBaseUrl = provider.baseUrl
  return typeof legacyBaseUrl === 'string' ? legacyBaseUrl : undefined
}

function resolveModel(
  name: string,
  targetProviderName: string,
  provider: RuntimeProviderDefinition,
  overrides: ProviderOverrideOptions
): string {
  if (overrides.model && overrides.provider === name) {
    return overrides.model
  }

  if (overrides.model && !overrides.provider && name === targetProviderName) {
    return overrides.model
  }

  return provider.model || 'unknown-model'
}

function buildRules(config: RuntimeConfig): RoutingRule[] | undefined {
  const rules = config.routing?.rules
  if (!rules || rules.length === 0) {
    return undefined
  }

  return rules
    .filter((rule) => Boolean(ROUTE_CONDITIONS[rule.condition]))
    .map((rule) => ({
      id: rule.id,
      priority: rule.priority ?? 0,
      provider: rule.provider,
      condition: ROUTE_CONDITIONS[rule.condition],
    }))
}

export function buildRouterConfig(
  config: RuntimeConfig,
  overrides: ProviderOverrideOptions = {}
): RouterConfig {
  if (overrides.provider && !config.providers[overrides.provider]) {
    throw new Error(`Provider '${overrides.provider}' is not configured.`)
  }

  const targetProviderName = overrides.provider || config.defaultProvider
  const providers = Object.fromEntries(
    Object.entries(config.providers)
      .filter(([, provider]) => provider.enabled !== false)
      .map(([name, provider]) => {
        const model = resolveModel(name, targetProviderName, provider, overrides)
        const adapter = ProviderFactory.create(provider.type, {
          ...provider,
          apiKey: provider.apiKey || '',
          model,
          baseURL: getProviderBaseURL(provider),
        })

        return [
          name,
          {
            adapter,
            priority: provider.priority ?? 0,
            models: Array.from(new Set([model, ...(provider.models || [])])),
          },
        ]
      })
  )

  const providerNames = Object.keys(providers)
  if (providerNames.length === 0) {
    throw new Error('No providers are configured. Add a provider or set the relevant API key.')
  }

  const defaultProvider = overrides.provider && providers[overrides.provider]
    ? overrides.provider
    : providers[config.defaultProvider]
      ? config.defaultProvider
      : providerNames[0]

  return {
    defaultProvider,
    providers,
    rules: buildRules(config),
  }
}
