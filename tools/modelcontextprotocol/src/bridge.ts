import { buildUserAgent, type ClientInfo } from './userAgent.ts';
import { PKG_NAME, PKG_VERSION } from './version.ts';

export interface Transportish {
  start(): Promise<void>;
  send(m: unknown): Promise<void>;
  close(): Promise<void>;
  onmessage?: (m: unknown) => void;
  onclose?: () => void;
  onerror?: (e: Error) => void;
}

export interface BridgeOptions {
  downstream: Transportish;
  makeUpstream: (userAgent: string) => Transportish;
}

export function extractClientInfo(message: unknown): ClientInfo | undefined {
  const m = message as { method?: string; params?: { clientInfo?: ClientInfo } };
  if (m?.method !== 'initialize') return undefined;
  return m.params?.clientInfo;
}

// Best-effort HTTP status from an SDK StreamableHTTPError (whose `code` is the HTTP
// status), surfaced in the JSON-RPC error `data` so the model can tell a 429 from a 503.
function httpStatusOf(e: unknown): number | undefined {
  const c = (e as { code?: unknown } | null)?.code;
  return typeof c === 'number' ? c : undefined;
}

export async function runBridge(opts: BridgeOptions): Promise<void> {
  const { downstream, makeUpstream } = opts;
  let upstreamPromise: Promise<Transportish> | undefined;
  let closed = false;

  // Close the counterpart exactly once. Both real SDK transports call their own
  // onclose from inside close(), so an unguarded cross-wiring would recurse
  // between the two sides until the stack overflows; the shared flag stops it
  // after one hop.
  const closeCounterpart = (other: Transportish | undefined): void => {
    if (closed) return;
    closed = true;
    // close() returns a promise (Transportish contract); swallow a rejection so
    // a shutdown never surfaces as an unhandled rejection.
    if (other) {
      void Promise.resolve(other.close()).catch(() => {});
    }
  };

  downstream.onmessage = async (message: unknown): Promise<void> => {
    try {
      if (!upstreamPromise) {
        const ua = buildUserAgent(extractClientInfo(message), PKG_NAME, PKG_VERSION);
        // Establish the upstream once. Every message (including this first one)
        // awaits the same promise, so no later message is sent before start()
        // resolves or overtakes an earlier one.
        upstreamPromise = (async () => {
          const up = makeUpstream(ua);
          up.onmessage = (m) => {
            void Promise.resolve(downstream.send(m)).catch(() => {});
          };
          up.onclose = () => closeCounterpart(downstream);
          up.onerror = (e) => process.stderr.write(`[shippo-mcp] upstream error: ${e.message}\n`);
          await up.start();
          return up;
        })();
      }
      const upstream = await upstreamPromise;
      await upstream.send(message);
    } catch (e) {
      const err = e as Error;
      // If the client is awaiting a response for this id, surface the failure as a
      // JSON-RPC error rather than dropping it to stderr; otherwise the client hangs
      // until its own request timeout (60s) with no signal. This is the path that
      // carries a 429, a 5xx, or the api-key key-door 401 (and its guidance message)
      // back to the model. Notifications have no id and stay stderr-only.
      const id = (message as { id?: string | number | null })?.id;
      if (id !== undefined && id !== null) {
        const httpStatus = httpStatusOf(e);
        void Promise.resolve(
          downstream.send({
            jsonrpc: '2.0',
            id,
            error: {
              code: -32603,
              message: `[shippo-mcp] upstream request failed: ${err.message}`,
              ...(httpStatus !== undefined ? { data: { httpStatus } } : {}),
            },
          }),
        ).catch(() => {});
      }
      process.stderr.write(`[shippo-mcp] failed to forward message: ${err.message}\n`);
    }
  };

  downstream.onclose = (): void => {
    if (closed) return;
    closed = true;
    if (upstreamPromise) {
      void upstreamPromise.then((up) => up.close()).catch(() => {});
    }
  };
  downstream.onerror = (e: Error) =>
    process.stderr.write(`[shippo-mcp] downstream error: ${e.message}\n`);

  await downstream.start();
}
