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
