import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseConfig } from '../src/cli.ts';

test('defaults to hosted url and oauth mode', () => {
  const c = parseConfig([], {});
  assert.equal(c.url, 'https://mcp.shippo.com');
  assert.equal(c.authMode, 'oauth');
  assert.equal(c.apiKey, undefined);
});

test('--url overrides the host', () => {
  const c = parseConfig(['--url=https://mcp.shippodev.com'], {});
  assert.equal(c.url, 'https://mcp.shippodev.com');
});

test('--api-key selects apiKey mode', () => {
  const c = parseConfig(['--api-key=shippo_test_abc'], {});
  assert.equal(c.authMode, 'apiKey');
  assert.equal(c.apiKey, 'shippo_test_abc');
});

test('SHIPPO_API_KEY env is honored, flag wins over env', () => {
  assert.equal(parseConfig([], { SHIPPO_API_KEY: 'shippo_live_xyz' }).apiKey, 'shippo_live_xyz');
  assert.equal(
    parseConfig(['--api-key=shippo_test_flag'], { SHIPPO_API_KEY: 'shippo_live_env' }).apiKey,
    'shippo_test_flag',
  );
});

test('rejects a malformed api key', () => {
  assert.throws(() => parseConfig(['--api-key=sk_live_nope'], {}), /shippo_live_.*shippo_test_/);
});

test('captures --shippo-account', () => {
  assert.equal(parseConfig(['--shippo-account=abc123'], {}).shippoAccount, 'abc123');
});
