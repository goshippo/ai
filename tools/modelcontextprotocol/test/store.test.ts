import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileStore } from '../src/store.ts';

test('round-trips a value keyed by host', () => {
  const dir = mkdtempSync(join(tmpdir(), 'shippo-store-'));
  const store = new FileStore(dir, 'mcp.shippo.com');
  assert.equal(store.read('tokens'), undefined);
  store.write('tokens', { access_token: 'a' });
  assert.deepEqual(store.read('tokens'), { access_token: 'a' });
});

test('different hosts do not collide', () => {
  const dir = mkdtempSync(join(tmpdir(), 'shippo-store-'));
  new FileStore(dir, 'mcp.shippo.com').write('tokens', { access_token: 'prod' });
  const dev = new FileStore(dir, 'mcp.shippodev.com');
  assert.equal(dev.read('tokens'), undefined);
});

test('delete removes a key and is a no-op when the key is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'shippo-store-'));
  const store = new FileStore(dir, 'mcp.shippo.com');
  store.write('tokens', { access_token: 'a' });
  store.delete('tokens');
  assert.equal(store.read('tokens'), undefined);
  assert.doesNotThrow(() => store.delete('tokens'));
});
