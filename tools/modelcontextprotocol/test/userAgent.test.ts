import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildUserAgent } from '../src/userAgent.ts';

test('appends client name and version when present', () => {
  assert.equal(
    buildUserAgent({ name: 'cursor', version: '0.42' }, '@shippo/shippo-mcp', '3.0.0'),
    '@shippo/shippo-mcp/3.0.0 (cursor/0.42)',
  );
});

test('uses base only when no client info', () => {
  assert.equal(
    buildUserAgent(undefined, '@shippo/shippo-mcp', '3.0.0'),
    '@shippo/shippo-mcp/3.0.0',
  );
});

test('client name without version', () => {
  assert.equal(
    buildUserAgent({ name: 'goose' }, '@shippo/shippo-mcp', '3.0.0'),
    '@shippo/shippo-mcp/3.0.0 (goose)',
  );
});

test('strips control characters from a hostile client name so the UA stays a valid header', () => {
  const ua = buildUserAgent(
    { name: 'Evil\r\nInjected-Header: x', version: '1.0' },
    '@shippo/shippo-mcp',
    '3.0.0',
  );
  assert.equal(ua, '@shippo/shippo-mcp/3.0.0 (EvilInjected-Header: x/1.0)');
  // The result must be usable as a header value: undici rejects CR/LF/NUL, so a
  // sanitized UA is what keeps such a client connected instead of erroring.
  assert.doesNotThrow(() => new Headers({ 'User-Agent': ua }));
});

test('a name that is only control characters falls back to the base UA', () => {
  assert.equal(
    buildUserAgent({ name: '\r\n\t' }, '@shippo/shippo-mcp', '3.0.0'),
    '@shippo/shippo-mcp/3.0.0',
  );
});

test('non-ASCII client names pass through unchanged', () => {
  assert.equal(
    buildUserAgent({ name: 'クライアント' }, '@shippo/shippo-mcp', '3.0.0'),
    '@shippo/shippo-mcp/3.0.0 (クライアント)',
  );
});
