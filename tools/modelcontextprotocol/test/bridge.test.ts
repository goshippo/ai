import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractClientInfo, runBridge } from '../src/bridge.ts';

test('extractClientInfo reads the initialize params', () => {
  const info = extractClientInfo({
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { clientInfo: { name: 'cursor', version: '0.42' } },
  });
  assert.deepEqual(info, { name: 'cursor', version: '0.42' });
});

test('extractClientInfo returns undefined for non-initialize', () => {
  assert.equal(extractClientInfo({ jsonrpc: '2.0', method: 'tools/list' }), undefined);
});

function fakeTransport() {
  const t: any = {
    started: false, closed: false, sent: [] as unknown[],
    async start() { this.started = true; },
    async send(m: unknown) { this.sent.push(m); },
    async close() { this.closed = true; this.onclose?.(); },
  };
  return t;
}

test('builds upstream with a client-info user agent after the first initialize', async () => {
  const downstream = fakeTransport();
  let seenUA = '';
  const upstream = fakeTransport();
  await runBridge({
    downstream,
    makeUpstream: (ua: string) => { seenUA = ua; return upstream; },
  });
  // simulate the client sending initialize
  const init = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { clientInfo: { name: 'goose', version: '1.2' } } };
  await downstream.onmessage(init);
  assert.match(seenUA, /\(goose\/1\.2\)$/);
  assert.equal(upstream.started, true);
  assert.deepEqual(upstream.sent[0], init);
});

test('forwards upstream messages back to downstream', async () => {
  const downstream = fakeTransport();
  const upstream = fakeTransport();
  await runBridge({ downstream, makeUpstream: () => upstream });
  await downstream.onmessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
  const reply = { jsonrpc: '2.0', id: 1, result: {} };
  upstream.onmessage(reply);
  assert.deepEqual(downstream.sent[0], reply);
});
