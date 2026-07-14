import { PKG_VERSION } from './version.ts';

export interface Config {
  url: string;
  apiKey?: string;
  shippoAccount?: string;
  authMode: 'oauth' | 'apiKey';
  callbackPort?: number;
  help?: true;
  version?: true;
}

const DEFAULT_URL = 'https://mcp.shippo.com';
const API_KEY_PREFIX = /^shippo_(live|test)_/;

// Every recognized flag, and (of those) the ones that must carry a value.
const KNOWN_FLAGS = new Set(['url', 'api-key', 'shippo-account', 'callback-port', 'help', 'version']);
const VALUE_FLAGS = ['url', 'api-key', 'shippo-account', 'callback-port'] as const;
const HELP_SUFFIX = 'Run npx @shippo/shippo-mcp --help for usage.';

export const USAGE = `@shippo/shippo-mcp v${PKG_VERSION}
Local bridge to the hosted Shippo MCP server: multi-carrier shipping for AI agents.

Flags:
  --api-key=<key>         Use a Shippo API key instead of OAuth (or set SHIPPO_API_KEY).
  --url=<url>             Override the server URL (default https://mcp.shippo.com).
  --shippo-account=<id>   Act on a managed account (sends SHIPPO-ACCOUNT-ID).
  --callback-port=<n>     Pin the OAuth loopback callback port (integer 1024-65535).
  --help                  Print this help and exit.
  --version               Print the version and exit.

Quickstart:
  npx -y @shippo/shippo-mcp
  npx -y @shippo/shippo-mcp --api-key=shippo_test_XXXX
`;

interface ParsedArgs {
  flags: Record<string, string>;
  positionals: string[];
}

// Tokenizes argv without judging it. `--k=v` -> flags.k='v'; a bare `--k` ->
// flags.k=''; anything not starting with `--` is a positional. Validation is
// the caller's job so --help/--version can short-circuit before it runs.
function parseArgs(argv: string[]): ParsedArgs {
  const flags: Record<string, string> = {};
  const positionals: string[] = [];
  for (const arg of argv) {
    if (arg.startsWith('--')) {
      const body = arg.slice(2);
      const eq = body.indexOf('=');
      if (eq === -1) flags[body] = '';
      else flags[body.slice(0, eq)] = body.slice(eq + 1);
    } else {
      positionals.push(arg);
    }
  }
  return { flags, positionals };
}

export function parseConfig(argv: string[], env: NodeJS.ProcessEnv): Config {
  const { flags, positionals } = parseArgs(argv);

  // --help / --version win before any validation, so `--help --nonsense` still
  // prints help rather than erroring.
  if ('help' in flags) return { url: DEFAULT_URL, authMode: 'oauth', help: true };
  if ('version' in flags) return { url: DEFAULT_URL, authMode: 'oauth', version: true };

  // Value-bearing flags supplied empty (bare `--api-key`, `--api-key=`, or the
  // space-separated `--api-key value` whose value lands as a positional).
  for (const f of VALUE_FLAGS) {
    if (f in flags && flags[f] === '') {
      throw new Error(`Missing value for --${f}. Use --${f}=<value>.`);
    }
  }
  // Unknown flags and stray positionals both get the same actionable guidance.
  for (const name of Object.keys(flags)) {
    if (!KNOWN_FLAGS.has(name)) {
      throw new Error(`Unknown flag --${name}. ${HELP_SUFFIX}`);
    }
  }
  if (positionals.length > 0) {
    throw new Error(`Unexpected argument "${positionals[0]}". ${HELP_SUFFIX}`);
  }

  const url = flags['url'] || DEFAULT_URL;
  // Guard the secret-exfil path: the api key or OAuth token is sent to this URL, so
  // refuse a non-https target unless it is loopback (dev-qa is https; only local
  // testing uses http, and only against localhost).
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error(`Invalid --url: ${url}. ${HELP_SUFFIX}`);
  }
  const loopbackHosts = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
  if (parsedUrl.protocol !== 'https:' && !loopbackHosts.has(parsedUrl.hostname)) {
    throw new Error(
      `Refusing to send credentials over ${parsedUrl.protocol} to a non-local host (${parsedUrl.hostname}). Use https, or localhost for local testing.`,
    );
  }
  const apiKey = flags['api-key'] || env.SHIPPO_API_KEY || undefined;
  const shippoAccount = flags['shippo-account'] || undefined;

  if (apiKey !== undefined && !API_KEY_PREFIX.test(apiKey)) {
    throw new Error(
      'Invalid API key. Expected a Shippo key starting with "shippo_live_" or "shippo_test_".',
    );
  }

  let callbackPort: number | undefined;
  if (flags['callback-port'] !== undefined) {
    const n = Number(flags['callback-port']);
    if (!Number.isInteger(n) || n < 1024 || n > 65535) {
      throw new Error('Invalid --callback-port. Expected an integer between 1024 and 65535.');
    }
    callbackPort = n;
  }

  return { url, apiKey, shippoAccount, callbackPort, authMode: apiKey ? 'apiKey' : 'oauth' };
}
