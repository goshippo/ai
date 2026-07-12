import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApiKeyHeaders, ShippoOAuthProvider } from '../src/auth.ts';
import { FileStore } from '../src/store.ts';

test('api key becomes a Bearer header', () => {
  const h = buildApiKeyHeaders('shippo_test_abc');
  assert.equal(h.Authorization, 'Bearer shippo_test_abc');
  assert.equal('SHIPPO-ACCOUNT-ID' in h, false);
});

test('shippo account is forwarded as a header', () => {
  const h = buildApiKeyHeaders('shippo_live_xyz', 'acct_9');
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
