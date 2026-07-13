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
  let upstream: Transportish | undefined;

  downstream.onmessage = async (message: unknown) => {
    if (!upstream) {
      const ua = buildUserAgent(extractClientInfo(message), PKG_NAME, PKG_VERSION);
      upstream = makeUpstream(ua);
      upstream.onmessage = (m) => downstream.send(m);
      upstream.onclose = () => downstream.close();
      upstream.onerror = (e) => process.stderr.write(`[shippo-mcp] upstream error: ${e.message}\n`);
      await upstream.start();
    }
    await upstream.send(message);
  };
  downstream.onclose = () => upstream?.close();

  await downstream.start();
}
