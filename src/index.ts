/**
 * Multi-Provider LLM Coding Assistant
 *
 * A unified interface for working with multiple LLM providers (Claude, Qwen, DeepSeek)
 * with proper multi-provider support from the ground up.
 *
 * This project implements:
 * - Provider-agnostic core with unified abstractions
 * - Adapter pattern for each provider
 * - Provider router for intelligent selection
 * - Streaming support across all providers
 * - Tool calling support
 * - Configurable routing rules
 */

// Main entry point
import { runCLI, CLIOptions } from './cli'
import { manageProviders } from './cli'
import { registerBuiltInProviders } from './providers'

// CLI entry point
registerBuiltInProviders()

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const options: CLIOptions = {}

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--provider':
      case '-p':
        options.provider = args[++i]
        break
      case '--model':
      case '-m':
        options.model = args[++i]
        break
      case '--prompt':
      case '-q':
        options.prompt = args[++i]
        break
      case '--file':
      case '-f':
        options.file = args[++i]
        break
      case '--config':
      case '-c':
        options.configPath = args[++i]
        break
      case '--interactive':
      case '-i':
        options.interactive = true
        break
      case '--max-turns':
        options.maxTurns = parseInt(args[++i], 10)
        break
      case '--temperature':
      case '-t':
        options.temperature = parseFloat(args[++i])
        break
      case '--verbose':
      case '-v':
        options.verbose = true
        break
      case '--manage-providers': {
        const cmd = args[++i] as 'list' | 'add' | 'remove' | 'set-default'
        const name = args[++i]
        await manageProviders(cmd, name, undefined, options.configPath)
        return
      }
      case '--help':
      case '-h':
        console.log(`
Multi-Provider LLM Coding Assistant

Usage: node index.js [options]

Options:
  -p, --provider <name>     Configured provider alias to use
  -m, --model <name>        Model name to use
  -q, --prompt <text>       Prompt to process
  -f, --file <path>         Read prompt from file
  -c, --config <path>       Load configuration from a specific file
  -i, --interactive         Interactive mode
  --max-turns <n>           Maximum conversation turns (default: 50)
  -t, --temperature <n>     Temperature setting (default: 0.7)
  -v, --verbose             Verbose output
  --manage-providers        Provider management (list|add|remove|set-default)
  -h, --help                Show this help

Environment Variables:
  ANTHROPIC_API_KEY    Anthropic API key (for Claude)
  OPENAI_API_KEY       OpenAI API key for generic OpenAI-compatible models
  OPENAI_BASE_URL      Custom OpenAI-compatible base URL
  QWEN_API_KEY         Qwen API key
  QWEN_BASE_URL        Qwen base URL (default: DashScope)
  DEEPSEEK_API_KEY     DeepSeek API key
  DEEPSEEK_BASE_URL    DeepSeek base URL
  AWS_PROFILE          AWS shared config profile for Bedrock (default: default)
  AWS_REGION           AWS region for Bedrock
  BEDROCK_MODEL        Bedrock model or inference profile ID

Providers:
  anthropic   - Anthropic Claude models
  bedrock     - AWS Bedrock models
  openai      - Generic OpenAI-compatible models
  qwen        - Qwen via OpenAI-compatible API
  deepseek    - DeepSeek via OpenAI-compatible API

Examples:
  node index.js --provider bedrock --model us.deepseek.r1-v1:0 --prompt "Write a hello world script"
  node index.js --provider openai --model gpt-4o-mini --prompt "Write a hello world script"
  node index.js --provider qwen --file prompt.txt --interactive
  node index.js -p deepseek -t 0.9 --max-turns 10
`)
        return
    }
  }

  await runCLI(options)
}

main().catch((error) => {
  console.error('Error:', error)
  process.exit(1)
})
