import { ProviderAdapter } from '../unified/provider-adapter'
import type { UnifiedMessage, UnifiedChatResponse } from '../unified/message-format'

export interface ProviderConfig {
  adapter: ProviderAdapter;
  priority: number;
  models?: string[];
}

export interface RouterConfig {
  defaultProvider: string;
  providers: Record<string, ProviderConfig>;
  rules?: RoutingRule[];
}

export interface RoutingRule {
  id: string;
  priority: number;
  condition: (messages: UnifiedMessage[], context?: any) => boolean;
  provider: string;
}

export interface RoutingContext {
  preferredProvider?: string;
  forceProvider?: string;
  [key: string]: unknown;
}

/**
 * Default routing rules for different task types
 */
export class DefaultRouterRules {
  static codingTask(messages: UnifiedMessage[], context?: any): boolean {
    const content = messages.map(m => m.content).join(' ');
    return content.toLowerCase().includes('code') ||
           content.toLowerCase().includes('program') ||
           content.toLowerCase().includes('develop') ||
           content.toLowerCase().includes('write');
  }

  static creativeTask(messages: UnifiedMessage[], context?: any): boolean {
    const content = messages.map(m => m.content).join(' ');
    return content.toLowerCase().includes('creative') ||
           content.toLowerCase().includes('story') ||
           content.toLowerCase().includes('idea') ||
           content.toLowerCase().includes('generate');
  }

  static analysisTask(messages: UnifiedMessage[], context?: any): boolean {
    const content = messages.map(m => m.content).join(' ');
    return content.toLowerCase().includes('analyze') ||
           content.toLowerCase().includes('explain') ||
           content.toLowerCase().includes('why') ||
           content.toLowerCase().includes('how');
  }

  static complexTask(messages: UnifiedMessage[], context?: any): boolean {
    const content = messages.map(m => m.content).join(' ');
    const wordCount = content.split(/\s+/).filter(Boolean).length;
    return wordCount > 100 || 
           content.includes('?') || 
           content.includes('complex');
  }
}

export class ProviderRouter {
  private readonly config: RouterConfig;
  private readonly providers: Map<string, ProviderConfig>;
  private readonly defaultProvider: string;
  
  constructor(config: RouterConfig) {
    this.config = config;
    this.providers = new Map(Object.entries(config.providers));
    this.defaultProvider = config.defaultProvider;
    
    // Apply default rules if none provided
    if (!config.rules || config.rules.length === 0) {
      this.config.rules = [
        {
          id: 'coding',
          priority: 100,
          condition: DefaultRouterRules.codingTask,
          provider: 'anthropic'
        },
        {
          id: 'creative',
          priority: 90,
          condition: DefaultRouterRules.creativeTask,
          provider: 'openai' // Using OpenAI as a cheaper alternative for creativity
        },
        {
          id: 'analysis',
          priority: 80,
          condition: DefaultRouterRules.analysisTask,
          provider: 'anthropic'
        },
        {
          id: 'complex',
          priority: 50,
          condition: DefaultRouterRules.complexTask,
          provider: 'anthropic'
        }
      ];
    }
  }

  /**
   * Select and return the appropriate provider
   */
  selectProvider(messages: UnifiedMessage[], context?: RoutingContext): ProviderConfig {
    if (context?.forceProvider) {
      const forcedProvider = this.providers.get(context.forceProvider);
      if (forcedProvider) {
        return forcedProvider;
      }
    }

    if (context?.preferredProvider) {
      const preferredProvider = this.providers.get(context.preferredProvider);
      if (preferredProvider) {
        return preferredProvider;
      }
    }

    // Check rules first
    const ruleMatch = this.config.rules
      ?.filter(rule => rule.condition(messages, context))
      .sort((a, b) => b.priority - a.priority)[0];

    if (ruleMatch) {
      const provider = this.providers.get(ruleMatch.provider);
      if (provider) {
        return provider;
      }
    }

    // Return default provider if no rules match
    const defaultProvider = this.providers.get(this.defaultProvider);
    if (defaultProvider) {
      return defaultProvider;
    }

    // Fallback to first available provider
    return Array.from(this.providers.values())[0];
  }

  /**
   * Get a specific provider by name
   */
  getProvider(name: string): ProviderAdapter {
    const providerConfig = this.providers.get(name);
    if (!providerConfig) {
      throw new Error(`Provider '${name}' not configured`);
    }
    return providerConfig.adapter;
  }

  /**
   * Get the default provider
   */
  getDefaultProvider(): ProviderAdapter {
    const providerConfig = this.providers.get(this.defaultProvider);
    if (!providerConfig) {
      throw new Error(`Default provider '${this.defaultProvider}' not configured`);
    }
    return providerConfig.adapter;
  }

  /**
   * Send a chat request using the appropriate provider
   */
  async sendChatRequest(
    messages: UnifiedMessage[], 
    tools?: any[],
    context?: RoutingContext
  ): Promise<UnifiedChatResponse> {
    const providerConfig = this.selectProvider(messages, context);
    const provider = providerConfig.adapter;
    
    return await provider.createChatRequest(messages, tools);
  }

  /**
   * Stream a response using the appropriate provider
   */
  async* streamResponse(
    messages: UnifiedMessage[], 
    tools?: any[],
    context?: RoutingContext
  ): AsyncIterable<Partial<UnifiedChatResponse>> {
    const providerConfig = this.selectProvider(messages, context);
    const provider = providerConfig.adapter;
    
    yield* provider.createStream(messages, tools);
  }

  /**
   * Route a request with information about selected provider
   */
  routeRequest(
    messages: UnifiedMessage[], 
    tools?: any[],
    context?: RoutingContext
  ): { provider: ProviderAdapter; messages: UnifiedMessage[] } {
    const providerConfig = this.selectProvider(messages, context);
    const provider = providerConfig.adapter;
    
    return {
      provider,
      messages
    };
  }

  /**
   * Add a new provider dynamically
   */
  addProvider(name: string, providerConfig: ProviderConfig): void {
    this.providers.set(name, providerConfig);
  }

  /**
   * Remove a provider
   */
  removeProvider(name: string): void {
    this.providers.delete(name);
  }

  /**
   * Get all available providers
   */
  getAvailableProviders(): string[] {
    return Array.from(this.providers.keys());
  }
}
