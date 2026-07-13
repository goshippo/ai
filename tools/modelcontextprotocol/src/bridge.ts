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
    // close() may return a rejected promise (or throw synchronously); normalize
    // and swallow it so a shutdown never surfaces as an unhandled rejection.
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
      process.stderr.write(`[shippo-mcp] failed to forward message: ${(e as Error).message}\n`);
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
