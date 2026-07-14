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

test('captures --callback-port as an integer', () => {
  assert.equal(parseConfig(['--callback-port=8080'], {}).callbackPort, 8080);
});

test('rejects a non-integer or out-of-range --callback-port', () => {
  assert.throws(() => parseConfig(['--callback-port=abc'], {}), /callback-port/);
  assert.throws(() => parseConfig(['--callback-port=80'], {}), /1024 and 65535/);
  assert.throws(() => parseConfig(['--callback-port=70000'], {}), /1024 and 65535/);
});

test('rejects an empty value-bearing flag (bare, =empty, or space-separated)', () => {
  assert.throws(() => parseConfig(['--api-key'], {}), /Missing value for --api-key/);
  assert.throws(() => parseConfig(['--api-key='], {}), /Missing value for --api-key/);
  assert.throws(() => parseConfig(['--url'], {}), /Missing value for --url/);
  // space-separated: the flag lands empty and the value becomes a positional;
  // the empty-value guard fires first with the more specific message.
  assert.throws(() => parseConfig(['--api-key', 'shippo_test_x'], {}), /Missing value for --api-key/);
});

test('rejects an unknown flag with usage guidance', () => {
  assert.throws(() => parseConfig(['--nope=1'], {}), /Unknown flag --nope/);
  assert.throws(() => parseConfig(['--nope=1'], {}), /--help for usage/);
});

test('rejects a stray positional with usage guidance', () => {
  assert.throws(() => parseConfig(['whoops'], {}), /Unexpected argument "whoops"/);
  assert.throws(() => parseConfig(['whoops'], {}), /--help for usage/);
});

test('--help and --version set discriminants and short-circuit validation', () => {
  assert.equal(parseConfig(['--help'], {}).help, true);
  assert.equal(parseConfig(['--version'], {}).version, true);
  // help wins even alongside an otherwise-invalid flag
  assert.equal(parseConfig(['--help', '--nonsense'], {}).help, true);
});

test('refuses a non-https --url to a non-local host (credential-exfil guard)', () => {
  assert.throws(() => parseConfig(['--url=http://evil.example.com'], {}), /Refusing to send credentials/);
  assert.throws(() => parseConfig(['--url=not a url'], {}), /Invalid --url/);
});

test('allows https and localhost http --url overrides', () => {
  assert.equal(parseConfig(['--url=https://mcp.shippodev.com'], {}).url, 'https://mcp.shippodev.com');
  assert.equal(parseConfig(['--url=http://localhost:3000'], {}).url, 'http://localhost:3000');
});
