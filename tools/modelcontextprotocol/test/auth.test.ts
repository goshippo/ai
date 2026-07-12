import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApiKeyHeaders } from '../src/auth.ts';

test('api key becomes a Bearer header', () => {
  const h = buildApiKeyHeaders('shippo_test_abc');
  assert.equal(h.Authorization, 'Bearer shippo_test_abc');
  assert.equal('SHIPPO-ACCOUNT-ID' in h, false);
});

test('shippo account is forwarded as a header', () => {
  const h = buildApiKeyHeaders('shippo_live_xyz', 'acct_9');
  assert.equal(h['SHIPPO-ACCOUNT-ID'], 'acct_9');
});
