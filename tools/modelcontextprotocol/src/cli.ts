export interface Config {
  url: string;
  apiKey?: string;
  shippoAccount?: string;
  authMode: 'oauth' | 'apiKey';
}

const DEFAULT_URL = 'https://mcp.shippo.com';
const API_KEY_PREFIX = /^shippo_(live|test)_/;

function parseFlags(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const arg of argv) {
    const m = /^--([^=]+)=(.*)$/.exec(arg);
    if (m) out[m[1]] = m[2];
    else if (arg.startsWith('--')) out[arg.slice(2)] = '';
  }
  return out;
}

export function parseConfig(argv: string[], env: NodeJS.ProcessEnv): Config {
  const flags = parseFlags(argv);
  const url = flags['url'] || DEFAULT_URL;
  const apiKey = flags['api-key'] || env.SHIPPO_API_KEY || undefined;
  const shippoAccount = flags['shippo-account'] || undefined;

  if (apiKey !== undefined && !API_KEY_PREFIX.test(apiKey)) {
    throw new Error(
      'Invalid API key. Expected a Shippo key starting with "shippo_live_" or "shippo_test_".',
    );
  }

  return { url, apiKey, shippoAccount, authMode: apiKey ? 'apiKey' : 'oauth' };
}
