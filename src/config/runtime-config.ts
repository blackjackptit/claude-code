import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

export type ProviderType = 'anthropic' | 'openai' | 'bedrock'

export interface RuntimeProviderDefinition {
  type: ProviderType
  apiKey?: string
  model?: string
  baseURL?: string
  baseUrl?: string
  priority?: number
  models?: string[]
  enabled?: boolean
  default?: boolean
  [key: string]: unknown
}

export interface RuntimeDefaults {
  temperature?: number
  maxTokens?: number
  maxTurns?: number
}

export interface RuntimeRoutingRuleDefinition {
  id: string
  priority?: number
  condition: 'coding' | 'creative' | 'analysis' | 'complex'
  provider: string
}

export interface RuntimeConfigFile {
  defaultProvider?: string
  providers?: Record<string, RuntimeProviderDefinition>
  routing?: {
    defaultProvider?: string
    rules?: RuntimeRoutingRuleDefinition[]
  }
  defaults?: RuntimeDefaults
}

export interface RuntimeConfig extends RuntimeConfigFile {
  defaultProvider: string
  providers: Record<string, RuntimeProviderDefinition>
  defaults: RuntimeDefaults
  configPath?: string
}

const BUILTIN_PROVIDERS: Record<string, RuntimeProviderDefinition> = {
  anthropic: {
    type: 'anthropic',
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: process.env.ANTHROPIC_MODEL || 'claude-3-5-sonnet-20241022',
    baseURL: process.env.ANTHROPIC_BASE_URL,
    priority: 10,
    models: ['claude-3-5-sonnet-20241022', 'claude-3-opus-20240229'],
  },
  openai: {
    type: 'openai',
    apiKey: process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    baseURL: process.env.OPENAI_BASE_URL,
    priority: 8,
    models: ['gpt-4o-mini', 'gpt-4.1-mini', 'gpt-4.1'],
  },
  qwen: {
    type: 'openai',
    apiKey: process.env.QWEN_API_KEY,
    model: process.env.QWEN_MODEL || 'qwen-plus',
    baseURL: process.env.QWEN_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    priority: 6,
    models: ['qwen-plus', 'qwen-max', 'qwen-turbo'],
  },
  deepseek: {
    type: 'openai',
    apiKey: process.env.DEEPSEEK_API_KEY,
    model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
    baseURL: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1',
    priority: 6,
    models: ['deepseek-chat', 'deepseek-coder'],
  },
  bedrock: {
    type: 'bedrock',
    model: process.env.BEDROCK_MODEL || 'us.deepseek.r1-v1:0',
    region: process.env.BEDROCK_REGION || process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1',
    profile: process.env.AWS_PROFILE || 'default',
    priority: 7,
    models: ['us.deepseek.r1-v1:0'],
  },
}

function cloneConfig<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function resolveEnvTemplates(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.replace(/\$\{([^}]+)\}/g, (_, key: string) => process.env[key] || '')
  }

  if (Array.isArray(value)) {
    return value.map((entry) => resolveEnvTemplates(entry))
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, resolveEnvTemplates(entry)])
    )
  }

  return value
}

function normalizeConfig(raw: unknown): RuntimeConfigFile {
  if (!raw || typeof raw !== 'object') {
    return {}
  }

  const resolved = resolveEnvTemplates(raw) as Record<string, unknown>

  if ('providers' in resolved) {
    return {
      defaultProvider:
        typeof resolved.defaultProvider === 'string' ? resolved.defaultProvider : undefined,
      providers: (resolved.providers as Record<string, RuntimeProviderDefinition>) || {},
      routing: resolved.routing as RuntimeConfigFile['routing'],
      defaults: (resolved.defaults as RuntimeDefaults) || {},
    }
  }

  const providers = resolved as Record<string, RuntimeProviderDefinition>
  const defaultProvider =
    Object.entries(providers).find(([, provider]) => provider?.default)?.[0] ||
    Object.keys(providers)[0]

  return {
    defaultProvider,
    providers,
    defaults: {},
  }
}

function mergeConfig(
  base: RuntimeConfig,
  override: RuntimeConfigFile,
  configPath?: string
): RuntimeConfig {
  const providers = { ...base.providers }

  for (const [name, provider] of Object.entries(override.providers || {})) {
    providers[name] = {
      ...providers[name],
      ...provider,
    }
  }

  return {
    ...base,
    ...override,
    defaultProvider: override.defaultProvider || override.routing?.defaultProvider || base.defaultProvider,
    providers,
    defaults: {
      ...base.defaults,
      ...(override.defaults || {}),
    },
    routing: override.routing
      ? {
          ...(base.routing || {}),
          ...override.routing,
          rules: override.routing.rules || base.routing?.rules,
        }
      : base.routing,
    configPath: configPath || base.configPath,
  }
}

function readConfigFile(configPath: string): RuntimeConfigFile | undefined {
  if (!existsSync(configPath)) {
    return undefined
  }

  const raw = JSON.parse(readFileSync(configPath, 'utf-8')) as unknown
  return normalizeConfig(raw)
}

function getCandidateConfigPaths(explicitPath?: string): string[] {
  const home = homedir()
  const candidates = [
    join(home, '.claude-providers.json'),
    join(home, '.claude-config.json'),
    join(process.cwd(), 'config.json'),
  ]

  if (explicitPath) {
    candidates.push(resolve(explicitPath))
  }

  return Array.from(new Set(candidates))
}

function resolveDefaultProvider(config: RuntimeConfig): string {
  const enabledProviders = Object.entries(config.providers).filter(
    ([, provider]) => provider.enabled !== false
  )

  if (enabledProviders.length === 0) {
    return 'anthropic'
  }

  if (
    config.defaultProvider &&
    enabledProviders.some(([name]) => name === config.defaultProvider)
  ) {
    return config.defaultProvider
  }

  const flaggedDefault = enabledProviders.find(([, provider]) => provider.default)
  if (flaggedDefault) {
    return flaggedDefault[0]
  }

  const withApiKey = enabledProviders.find(([, provider]) => Boolean(provider.apiKey))
  if (withApiKey) {
    return withApiKey[0]
  }

  return enabledProviders[0][0]
}

export function getWritableConfigPath(configPath?: string): string {
  return configPath ? resolve(configPath) : join(homedir(), '.claude-providers.json')
}

export async function loadStoredRuntimeConfig(configPath?: string): Promise<RuntimeConfig> {
  const writablePath = getWritableConfigPath(configPath)
  const stored = readConfigFile(writablePath)

  return {
    defaultProvider: stored?.defaultProvider || 'anthropic',
    providers: stored?.providers || {},
    defaults: stored?.defaults || {},
    routing: stored?.routing,
    configPath: writablePath,
  }
}

export async function saveStoredRuntimeConfig(
  config: RuntimeConfig,
  configPath?: string
): Promise<void> {
  const writablePath = getWritableConfigPath(configPath)
  const serializable: RuntimeConfigFile = {
    defaultProvider: config.defaultProvider,
    providers: config.providers,
    defaults: config.defaults,
    routing: config.routing,
  }

  writeFileSync(writablePath, JSON.stringify(serializable, null, 2))
}

export async function loadRuntimeConfig(configPath?: string): Promise<RuntimeConfig> {
  let merged: RuntimeConfig = {
    defaultProvider: 'anthropic',
    providers: cloneConfig(BUILTIN_PROVIDERS),
    defaults: {
      temperature: 0.7,
      maxTokens: 4096,
      maxTurns: 50,
    },
  }

  for (const candidate of getCandidateConfigPaths(configPath)) {
    const parsed = readConfigFile(candidate)
    if (!parsed) {
      continue
    }

    merged = mergeConfig(merged, parsed, candidate)
  }

  merged.defaultProvider = resolveDefaultProvider(merged)
  return merged
}
