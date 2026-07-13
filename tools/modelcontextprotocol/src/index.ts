import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';
import { parseConfig } from './cli.ts';
import { buildApiKeyHeaders, assertBrowserCapable, setupOAuth } from './auth.ts';
import { runBridge, type Transportish } from './bridge.ts';

export async function main(argv: string[], env: NodeJS.ProcessEnv): Promise<void> {
  const config = parseConfig(argv, env);
  assertBrowserCapable(config, env);
  const url = new URL(config.url);

  const downstream = new StdioServerTransport() as unknown as Transportish;

  if (config.authMode === 'apiKey') {
    const headers = buildApiKeyHeaders(config.apiKey!, config.shippoAccount);
    await runBridge({
      downstream,
      makeUpstream: (userAgent) =>
        new StreamableHTTPClientTransport(url, {
          requestInit: { headers: { ...headers, 'User-Agent': userAgent } },
        }) as unknown as Transportish,
    });
  } else {
    const { provider, authCode } = await setupOAuth(url.host);
    await runBridge({
      downstream,
      makeUpstream: (userAgent) => {
        const headers: Record<string, string> = { 'User-Agent': userAgent };
        if (config.shippoAccount) headers['SHIPPO-ACCOUNT-ID'] = config.shippoAccount;
        const t = new StreamableHTTPClientTransport(url, {
          authProvider: provider,
          requestInit: { headers },
        });
        // With streamable HTTP the SDK surfaces UnauthorizedError from send()
        // (a 401 response triggers the auth flow and the browser open), not
        // only from start(). Wrap BOTH: on UnauthorizedError, wait for the
        // loopback callback code, finish auth exactly once, then retry the
        // failed call so no message is dropped while the user signs in.
        let completion: Promise<void> | undefined;
        const completeAuthOnce = (): Promise<void> =>
          (completion ??= (async () => {
            const code = await authCode;
            await t.finishAuth(code);
          })());
        const wrap = <A extends unknown[]>(fn: (...args: A) => Promise<void>) =>
          async (...args: A): Promise<void> => {
            try {
              await fn(...args);
            } catch (e) {
              if (e instanceof UnauthorizedError) {
                await completeAuthOnce();
                await fn(...args);
              } else {
                throw e;
              }
            }
          };
        t.start = wrap(t.start.bind(t));
        t.send = wrap(t.send.bind(t)) as typeof t.send;
        return t as unknown as Transportish;
      },
    });
  }

  const shutdown = () => { void downstream.close(); process.exit(0); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main(process.argv.slice(2), process.env).catch((err) => {
  process.stderr.write(`[shippo-mcp] ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
