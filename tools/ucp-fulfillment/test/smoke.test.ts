import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PACKAGE_NAME } from '../src/index.ts';

test('package entry point loads', () => {
  assert.equal(PACKAGE_NAME, '@shippo/ucp-fulfillment');
});
