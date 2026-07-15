import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { join as joinPath } from 'node:path';
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import { StreamableHTTPError } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type {
  OAuthClientMetadata,
  OAuthClientInformation,
  OAuthClientInformationFull,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import { FileStore } from './store.ts';
import { PKG_NAME, PKG_VERSION } from './version.ts';
import type { Config } from './cli.ts';

export function buildApiKeyHeaders(
  apiKey: string,
  shippoAccount?: string,
): Record<string, string> {
  // Scheme pinned (AI-275/AI-264): the hosted door admits the raw key as the
  // BEARER value of the inbound Authorization header (see the proxy handler's
  // docstring in shippo-utilities); ShippoToken is only the proxy's outbound
  // scheme to api.goshippo.com. Bearer here is correct.
  const headers: Record<string, string> = { Authorization: `Bearer ${apiKey}` };
  if (shippoAccount) headers['SHIPPO-ACCOUNT-ID'] = shippoAccount;
  return headers;
}

// The message the key-door 401 surfaces to the user. Kept as an exported
// constant so the wrap in index.ts and its test share one source of truth.
export const KEY_DOOR_401_MESSAGE =
  'The hosted key door rejected this API key. The key door may not be enabled on this host yet; OAuth (run without --api-key) is the working default until it opens. If the door is open, check that the key is a valid shippo_test_ or shippo_live_ key.';

// The hosted key door returns HTTP 401 for a rejected or not-yet-enabled API
// key, which the streamable-HTTP transport surfaces as StreamableHTTPError with
// code 401. As a fallback for a differently-wrapped error, match the stable
// key-door text rather than a bare "401", which could appear incidentally in an
// unrelated error message and mislabel it as a key-door rejection.
const KEY_DOOR_SIGNATURE = /not accepted by this MCP|Complete the OAuth flow/i;

export function isHttp401(err: unknown): boolean {
  if (err instanceof StreamableHTTPError) return err.code === 401;
  if (err instanceof Error) return KEY_DOOR_SIGNATURE.test(err.message);
  return false;
}

export interface BrowserSpawnPlan {
  command: string;
  args: string[];
  options: { detached: boolean; stdio: 'ignore'; windowsVerbatimArguments?: boolean };
}

export function browserSpawnPlan(
  url: string,
  platform: NodeJS.Platform,
  override?: string,
): BrowserSpawnPlan {
  if (override) {
    return { command: override, args: [url], options: { detached: true, stdio: 'ignore' } };
  }
  if (platform === 'darwin') {
    return { command: 'open', args: [url], options: { detached: true, stdio: 'ignore' } };
  }
  if (platform === 'win32') {
    // cmd's start parses & as a command separator; the quoted form keeps the
    // URL intact. The empty "" is start's window-title slot.
    return {
      command: 'cmd',
      args: ['/d', '/s', '/c', `start "" "${url}"`],
      options: { detached: true, stdio: 'ignore', windowsVerbatimArguments: true },
    };
  }
  return { command: 'xdg-open', args: [url], options: { detached: true, stdio: 'ignore' } };
}

export function defaultOpenBrowser(url: string, command?: string): void {
  // Always print the manual fallback first: browser auto-open is best-effort, so
  // the user can copy the URL even when nothing launches (headless SSH, missing
  // opener, sandbox). stderr only; stdout is the MCP channel.
  process.stderr.write(
    `[shippo-mcp] opening your browser to sign in; if nothing opens, open this URL yourself: ${url}\n`,
  );
  const plan = browserSpawnPlan(url, process.platform, command);
  const child = spawn(plan.command, plan.args, plan.options);
  child.on('error', (err) =>
    process.stderr.write(
      `[shippo-mcp] could not open a browser automatically (${err.message}). Open this URL manually: ${url}\n`,
    ),
  );
  child.unref();
}

export class ShippoOAuthProvider implements OAuthClientProvider {
  // The last state value handed to the authorization server, recorded so the
  // loopback callback can reject requests that carry a mismatched state.
  public lastState?: string;

  constructor(
    private store: FileStore,
    private port: number,
    private open: (url: string) => void,
    private onState?: (s: string) => void,
  ) {}

  get redirectUrl(): string {
    // Literal host "localhost", never 127.0.0.1: the Cloudflare WAF SSRF-Local
    // rule blocks 127.0.0.1 callbacks, while localhost + /callback is on the
    // existing ALLOW rule.
    return `http://localhost:${this.port}/callback`;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: `${PKG_NAME}/${PKG_VERSION}`,
      redirect_uris: [this.redirectUrl],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    };
  }

  clientInformation(): OAuthClientInformation | undefined {
    return this.store.read<OAuthClientInformation>('client');
  }
  saveClientInformation(info: OAuthClientInformationFull): void {
    this.store.write('client', info);
  }
  tokens(): OAuthTokens | undefined {
    return this.store.read<OAuthTokens>('tokens');
  }
  saveTokens(tokens: OAuthTokens): void {
    this.store.write('tokens', tokens);
  }
  saveCodeVerifier(verifier: string): void {
    this.store.write('verifier', verifier);
  }
  codeVerifier(): string {
    const v = this.store.read<string>('verifier');
    if (!v) throw new Error('Missing PKCE code verifier. Restart the sign-in.');
    return v;
  }
  state(): string {
    this.lastState = randomUUID();
    this.onState?.(this.lastState);
    return this.lastState;
  }
  // Lets the SDK purge cached credentials the server has flagged invalid, so a
  // stale DCR client or expired token does not wedge every future sign-in.
  invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery'): void {
    if (scope === 'all' || scope === 'tokens') this.store.delete('tokens');
    if (scope === 'all' || scope === 'client') this.store.delete('client');
    if (scope === 'all' || scope === 'verifier') this.store.delete('verifier');
    // 'discovery' state is never persisted here, so there is nothing to delete.
  }
  redirectToAuthorization(authorizationUrl: URL): void {
    this.open(authorizationUrl.toString());
  }
}

// Derives ten deterministic candidate callback ports from the host. A fixed set
// per host lets the persisted DCR redirect_uri keep matching across runs (strict
// servers exact-match loopback redirects), while still leaving fallbacks if the
// first is busy. Base lands in 43700-44499, so base+9 stays under 44509.
export function defaultCallbackPorts(host: string): number[] {
  const base = 43700 + (parseInt(createHash('sha256').update(host).digest('hex').slice(0, 4), 16) % 800);
  return Array.from({ length: 10 }, (_, i) => base + i);
}

// Starts the loopback server, returns the chosen port plus a promise that
// resolves with the authorization code when a state-valid callback is hit.
export function startCallbackServer(
  opts: { ports?: number[]; getState?: () => string | undefined } = {},
): Promise<{ port: number; code: Promise<string> }> {
  return new Promise((resolve, reject) => {
    let resolveCode!: (code: string) => void;
    let rejectCode!: (err: Error) => void;
    const code = new Promise<string>((res, rej) => {
      resolveCode = res;
      rejectCode = rej;
    });
    const server = createServer((req, res) => {
      const u = new URL(req.url ?? '', 'http://localhost');
      if (u.pathname !== '/callback') {
        res.writeHead(404).end();
        return;
      }
      // I5: when the caller supplies an expected state, only a callback whose
      // state exactly matches may settle the flow. Everything else (wrong state,
      // or a callback that arrives before the flow started) gets a 400 and the
      // server keeps listening, so a stray request cannot resolve or close it.
      if (opts.getState) {
        const expected = opts.getState();
        if (expected === undefined || u.searchParams.get('state') !== expected) {
          res.writeHead(400, { 'content-type': 'text/plain' }).end('Invalid state');
          return;
        }
      }
      const err = u.searchParams.get('error');
      const c = u.searchParams.get('code');
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<html><body>You can close this window and return to your terminal.</body></html>');
      server.close();
      if (err) rejectCode(new Error(`Authorization failed: ${err}`));
      else if (c) resolveCode(c);
      else rejectCode(new Error('Authorization callback missing the code.'));
    });

    const finish = (): void => {
      // Do not let the idle callback listener hold the event loop: if the client
      // closes stdin before sign-in starts, the bridge must drain and exit. While
      // a real sign-in is in progress, open stdin keeps the process alive, so an
      // unref'd server still serves the callback.
      server.unref();
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({ port, code });
    };

    // One listen attempt on `port`; onFail runs (with the error) if it fails.
    const listenOn = (port: number, onFail: (e: NodeJS.ErrnoException) => void): void => {
      const onError = (e: NodeJS.ErrnoException): void => {
        server.removeListener('listening', onListening);
        onFail(e);
      };
      const onListening = (): void => {
        server.removeListener('error', onError);
        finish();
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(port, 'localhost');
    };

    const ports = opts.ports;
    if (ports && ports.length > 0) {
      const tryAt = (i: number): void => {
        listenOn(ports[i], (e) => {
          if (e.code === 'EADDRINUSE' && i + 1 < ports.length) {
            tryAt(i + 1);
          } else if (e.code === 'EADDRINUSE') {
            process.stderr.write(
              '[shippo-mcp] preferred callback ports busy; using an ephemeral port (you may need to re-approve the app)\n',
            );
            listenOn(0, reject);
          } else {
            reject(e);
          }
        });
      };
      tryAt(0);
    } else {
      // No candidates: ephemeral port, today's behavior.
      listenOn(0, reject);
    }
  });
}

export function defaultCacheDir(): string {
  return joinPath(homedir(), '.shippo-mcp');
}

// True when we are confident no local browser can complete the OAuth loopback:
// CI, a Linux/BSD host with no display server, or a remote SSH session with no
// forwarded display (the browser would open on the wrong machine, so the
// loopback callback never arrives). A desktop MCP client spawns the bridge with
// piped stdio but a working GUI and sets none of these, so it stays interactive.
export function isHeadless(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (env.CI) return true;
  const noDisplay = !env.DISPLAY && !env.WAYLAND_DISPLAY;
  if (noDisplay && platform !== 'darwin' && platform !== 'win32') return true;
  if (noDisplay && (env.SSH_CONNECTION || env.SSH_TTY)) return true;
  return false;
}

export function assertBrowserCapable(
  config: Config,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
): void {
  if (config.authMode === 'apiKey') return;
  if (isHeadless(env, platform)) {
    throw new Error(
      'OAuth needs a browser and none is available. Pass --api-key (or set SHIPPO_API_KEY) for headless, SSH, or CI use.',
    );
  }
}

export interface OAuthSetup {
  provider: ShippoOAuthProvider;
  authCode: Promise<string>;
}

// Starts the loopback server, then builds a provider bound to its port. The
// state ref bridges the two: the server is created before the provider exists,
// so it reads the expected state lazily through a mutable box the provider fills
// via its onState hook.
export async function setupOAuth(
  host: string,
  deps: { store?: FileStore; openBrowser?: (url: string) => void; callbackPort?: number } = {},
): Promise<OAuthSetup> {
  const stateRef: { current?: string } = {};
  const ports = deps.callbackPort ? [deps.callbackPort] : defaultCallbackPorts(host);
  const { port, code } = await startCallbackServer({ ports, getState: () => stateRef.current });
  const store = deps.store ?? new FileStore(defaultCacheDir(), host);
  const provider = new ShippoOAuthProvider(
    store,
    port,
    deps.openBrowser ?? defaultOpenBrowser,
    (s) => {
      stateRef.current = s;
    },
  );
  return { provider, authCode: code };
}
