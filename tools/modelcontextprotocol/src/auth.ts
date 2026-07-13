import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { join as joinPath } from 'node:path';
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import type {
  OAuthClientMetadata,
  OAuthClientInformation,
  OAuthClientInformationFull,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import { FileStore } from './store.ts';
import { PKG_NAME, PKG_VERSION } from './version.ts';

export interface AuthContext {
  headers: Record<string, string>;
  authProvider?: unknown;
  completeAuthorization?: (transport: { finishAuth(code: string): Promise<void> }) => Promise<void>;
}

export function buildApiKeyHeaders(
  apiKey: string,
  shippoAccount?: string,
): Record<string, string> {
  // NOTE (Task 9): pin "Bearer" vs "ShippoToken" against the #101 door's
  // code/api_key_auth.py scheme_for() before release. The door classifies by
  // the shippo_(live|test)_ prefix in the header value.
  const headers: Record<string, string> = { Authorization: `Bearer ${apiKey}` };
  if (shippoAccount) headers['SHIPPO-ACCOUNT-ID'] = shippoAccount;
  return headers;
}

export function defaultOpenBrowser(url: string, command?: string): void {
  const cmd =
    command ??
    (process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open');
  const child = spawn(cmd, [url], {
    stdio: 'ignore',
    detached: true,
    shell: process.platform === 'win32',
  });
  child.on('error', (err) =>
    process.stderr.write(
      `[shippo-mcp] could not open a browser automatically (${err.message}). Open this URL manually: ${url}\n`,
    ),
  );
  child.unref();
}

export class ShippoOAuthProvider implements OAuthClientProvider {
  constructor(
    private store: FileStore,
    private port: number,
    private open: (url: string) => void,
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
    return randomUUID();
  }
  redirectToAuthorization(authorizationUrl: URL): void {
    this.open(authorizationUrl.toString());
  }
}

// Starts the loopback server, returns the chosen port plus a promise that
// resolves with the authorization code when the callback is hit.
export function startCallbackServer(): Promise<{ port: number; code: Promise<string> }> {
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
      const err = u.searchParams.get('error');
      const c = u.searchParams.get('code');
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<html><body>You can close this window and return to your terminal.</body></html>');
      server.close();
      if (err) rejectCode(new Error(`Authorization failed: ${err}`));
      else if (c) resolveCode(c);
      else rejectCode(new Error('Authorization callback missing the code.'));
    });
    server.on('error', reject);
    server.listen(0, 'localhost', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({ port, code });
    });
  });
}

export function defaultCacheDir(): string {
  return joinPath(homedir(), '.shippo-mcp');
}
