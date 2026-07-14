import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { get as httpRawGet } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import {
  buildApiKeyHeaders,
  defaultOpenBrowser,
  ShippoOAuthProvider,
  browserSpawnPlan,
  defaultCallbackPorts,
  startCallbackServer,
  isHttp401,
  KEY_DOOR_401_MESSAGE,
} from '../src/auth.ts';
import { StreamableHTTPError } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { FileStore } from '../src/store.ts';

// Fetches with connection pooling off so the callback server has no lingering
// keep-alive sockets to hold the event loop after the test.
function httpGet(url: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRawGet(url, { agent: false }, (res) => {
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on('error', reject);
  });
}

test('api key becomes a Bearer header', () => {
  const h = buildApiKeyHeaders('shippo_test_xxxxx');
  assert.equal(h.Authorization, 'Bearer shippo_test_xxxxx');
  assert.equal('SHIPPO-ACCOUNT-ID' in h, false);
});

test('shippo account is forwarded as a header', () => {
  const h = buildApiKeyHeaders('shippo_live_xxxxx', 'acct_9');
  assert.equal(h['SHIPPO-ACCOUNT-ID'], 'acct_9');
});

test('redirect uri uses localhost, never 127.0.0.1', () => {
  const store = new FileStore(mkdtempSync(join(tmpdir(), 's-')), 'mcp.shippo.com');
  const p = new ShippoOAuthProvider(store, 4567, () => {});
  const url = new URL(String(p.redirectUrl));
  assert.equal(url.hostname, 'localhost');
  assert.equal(url.pathname, '/callback');
});

test('client metadata is a public loopback client', () => {
  const store = new FileStore(mkdtempSync(join(tmpdir(), 's-')), 'mcp.shippo.com');
  const p = new ShippoOAuthProvider(store, 4567, () => {});
  assert.equal(p.clientMetadata.token_endpoint_auth_method, 'none');
  assert.deepEqual(p.clientMetadata.grant_types, ['authorization_code', 'refresh_token']);
});

test('tokens and client registration persist through the store', () => {
  const store = new FileStore(mkdtempSync(join(tmpdir(), 's-')), 'mcp.shippo.com');
  const p = new ShippoOAuthProvider(store, 4567, () => {});
  assert.equal(p.tokens(), undefined);
  p.saveTokens({ access_token: 't', token_type: 'Bearer' });
  assert.equal(p.tokens()?.access_token, 't');
  p.saveClientInformation({ client_id: 'c', redirect_uris: [String(p.redirectUrl)] });
  assert.equal(p.clientInformation()?.client_id, 'c');
});

test('redirectToAuthorization opens the browser with the authorize url', () => {
  const store = new FileStore(mkdtempSync(join(tmpdir(), 's-')), 'mcp.shippo.com');
  let opened = '';
  const p = new ShippoOAuthProvider(store, 4567, (u) => {
    opened = u;
  });
  p.redirectToAuthorization(new URL('https://auth.example/authorize?x=1'));
  assert.equal(opened, 'https://auth.example/authorize?x=1');
});

test('defaultOpenBrowser does not crash the process when the opener binary is missing', async () => {
  // A command that does not exist emits an async 'error' on the child. If it
  // were unhandled, Node would throw and crash this test process. Reaching the
  // assertion means the error handler swallowed it.
  defaultOpenBrowser('https://example.test/', 'shippo-no-such-opener-xyz-9999');
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.ok(true);
});

import { assertBrowserCapable } from '../src/auth.ts';

test('headless with no key throws a clear, actionable error', () => {
  assert.throws(
    () => assertBrowserCapable({ authMode: 'oauth' } as any, { CI: 'true' }),
    /pass --api-key/i,
  );
});

test('api-key mode never requires a browser', () => {
  assert.doesNotThrow(() => assertBrowserCapable({ authMode: 'apiKey' } as any, { CI: 'true' }));
});

test('an idle oauth callback server does not keep the process alive', () => {
  // A process that only starts the callback server must drain and exit once
  // nothing else holds the loop (the case: stdin already at EOF before
  // sign-in). The unref() in startCallbackServer is what makes this pass.
  const res = spawnSync(
    process.execPath,
    [
      '--import', 'tsx', '--input-type=module', '-e',
      "const { startCallbackServer } = await import('./src/auth.ts'); await startCallbackServer();",
    ],
    { cwd: new URL('..', import.meta.url).pathname, timeout: 8000, encoding: 'utf8' },
  );
  assert.equal(res.signal, null, `killed by ${res.signal}; should exit on its own. stderr: ${res.stderr}`);
  assert.equal(res.status, 0, `expected clean exit, got ${res.status}. stderr: ${res.stderr}`);
});

// --- C1: windows browser open must not truncate the url at & ---

test('browserSpawnPlan keeps a url with & intact inside one start argument on win32', () => {
  const url = 'https://auth.example/authorize?a=1&b=2&state=xyz';
  const plan = browserSpawnPlan(url, 'win32');
  assert.equal(plan.command, 'cmd');
  assert.deepEqual(plan.args, ['/d', '/s', '/c', `start "" "${url}"`]);
  assert.equal(plan.options.windowsVerbatimArguments, true);
  // the whole url, ampersands and all, lives inside the single start argument
  assert.ok(plan.args[3].includes('a=1&b=2&state=xyz'));
});

test('browserSpawnPlan uses open on darwin', () => {
  const url = 'https://auth.example/authorize?x=1';
  assert.deepEqual(browserSpawnPlan(url, 'darwin'), {
    command: 'open',
    args: [url],
    options: { detached: true, stdio: 'ignore' },
  });
});

test('browserSpawnPlan uses xdg-open on linux', () => {
  const url = 'https://auth.example/authorize?x=1';
  assert.deepEqual(browserSpawnPlan(url, 'linux'), {
    command: 'xdg-open',
    args: [url],
    options: { detached: true, stdio: 'ignore' },
  });
});

test('browserSpawnPlan honors an override command', () => {
  const url = 'https://auth.example/authorize?x=1';
  assert.deepEqual(browserSpawnPlan(url, 'win32', 'my-opener'), {
    command: 'my-opener',
    args: [url],
    options: { detached: true, stdio: 'ignore' },
  });
});

// --- I1: deterministic per-host callback ports ---

test('defaultCallbackPorts is deterministic, 10 wide, and in range', () => {
  const a = defaultCallbackPorts('mcp.shippo.com');
  const b = defaultCallbackPorts('mcp.shippo.com');
  assert.deepEqual(a, b);
  assert.equal(a.length, 10);
  for (const p of a) assert.ok(p >= 43700 && p <= 44508, `port ${p} out of range`);
  assert.deepEqual(a, Array.from({ length: 10 }, (_, i) => a[0] + i));
});

test('defaultCallbackPorts differs across hosts', () => {
  assert.notEqual(
    defaultCallbackPorts('mcp.shippo.com')[0],
    defaultCallbackPorts('mcp.shippodev.com')[0],
  );
});

test('startCallbackServer skips a busy preferred port and lands on the next', async () => {
  const candidates = defaultCallbackPorts('busy-port-test.shippo');
  const blocker = createNetServer();
  await new Promise<void>((resolve, reject) => {
    blocker.once('error', reject);
    blocker.listen(candidates[0], 'localhost', () => resolve());
  });
  try {
    const { port } = await startCallbackServer({ ports: [candidates[0], candidates[1]] });
    assert.equal(port, candidates[1]);
  } finally {
    blocker.close();
  }
});

// --- I2: the spec-promised 401 key-door message ---

test('isHttp401 recognizes a transport 401 and a 401 in a message', () => {
  assert.equal(isHttp401(new StreamableHTTPError(401, 'Unauthorized')), true);
  assert.equal(isHttp401(new Error('HTTP 401 while connecting')), true);
});

test('isHttp401 is false for a 500 and unrelated errors', () => {
  assert.equal(isHttp401(new StreamableHTTPError(500, 'Server Error')), false);
  assert.equal(isHttp401(new Error('something else')), false);
  assert.equal(isHttp401('nope'), false);
});

test('KEY_DOOR_401_MESSAGE names the key door and the --api-key escape hatch', () => {
  assert.match(KEY_DOOR_401_MESSAGE, /key door/);
  assert.match(KEY_DOOR_401_MESSAGE, /--api-key/);
});

// --- I5: state validation on the loopback callback ---

test('the callback rejects a wrong state with 400 and only settles on the matching state', async () => {
  const expected = 'good';
  const { port, code } = await startCallbackServer({ getState: () => expected });

  const bad = await httpGet(`http://localhost:${port}/callback?state=bad&code=nope`);
  assert.equal(bad.status, 400);
  assert.match(bad.body, /Invalid state/);

  // the code promise must still be pending after the mismatched callback
  let settled = false;
  void code.then(
    () => (settled = true),
    () => (settled = true),
  );
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(settled, false);

  const good = await httpGet(`http://localhost:${port}/callback?state=good&code=xyz`);
  assert.equal(good.status, 200);
  assert.equal(await code, 'xyz');
});

test('provider.state() records lastState and fires the onState hook', () => {
  const store = new FileStore(mkdtempSync(join(tmpdir(), 's-')), 'mcp.shippo.com');
  let seen: string | undefined;
  const p = new ShippoOAuthProvider(store, 4567, () => {}, (s) => {
    seen = s;
  });
  const s = p.state();
  assert.equal(typeof s, 'string');
  assert.equal(p.lastState, s);
  assert.equal(seen, s);
});

// --- I6: invalidateCredentials maps scopes to store deletes ---

test('invalidateCredentials clears only the scoped keys', () => {
  const store = new FileStore(mkdtempSync(join(tmpdir(), 's-')), 'mcp.shippo.com');
  const p = new ShippoOAuthProvider(store, 4567, () => {});
  p.saveTokens({ access_token: 't', token_type: 'Bearer' });
  p.saveClientInformation({ client_id: 'c', redirect_uris: [String(p.redirectUrl)] });

  p.invalidateCredentials('tokens');
  assert.equal(p.tokens(), undefined);
  assert.equal(p.clientInformation()?.client_id, 'c');

  p.saveTokens({ access_token: 't2', token_type: 'Bearer' });
  p.invalidateCredentials('all');
  assert.equal(p.tokens(), undefined);
  assert.equal(p.clientInformation(), undefined);
});
