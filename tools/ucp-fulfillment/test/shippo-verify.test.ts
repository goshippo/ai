import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { SHIPPO_SIGNATURE_HEADER, verifyShippoSignature, verifyShippoTrust } from '../src/shippo-verify.ts';
import { ShippoSignatureError } from '../src/errors.ts';

const SECRET = 'whsec_shippo_example';
const BODY = '{"event":"track_updated","test":true,"data":{"carrier":"ups"}}';
const AT = new Date('2026-09-03T16:00:00Z');
const TIMESTAMP = String(Math.floor(AT.getTime() / 1000));
const sign = (body: string, secret: string, timestamp: string) =>
  `t=${timestamp},v1=${createHmac('sha256', secret).update(`${timestamp}.${body}`, 'utf8').digest('hex')}`;

test('the header name is the one Shippo documents', () => {
  assert.equal(SHIPPO_SIGNATURE_HEADER, 'Shippo-Auth-Signature');
  assert.equal(TIMESTAMP, '1788451200');
});

test('a genuine signature verifies', () => {
  assert.doesNotThrow(() =>
    verifyShippoSignature(BODY, sign(BODY, SECRET, TIMESTAMP), SECRET, { now: AT }),
  );
});

test('a tampered body is rejected', () => {
  const header = sign(BODY, SECRET, TIMESTAMP);
  assert.throws(
    () => verifyShippoSignature(`${BODY} `, header, SECRET, { now: AT }),
    (error: unknown) =>
      error instanceof ShippoSignatureError && error.reason === 'digest mismatch' && error.retryable === false,
  );
});

test('a wrong secret is rejected', () => {
  assert.throws(
    () => verifyShippoSignature(BODY, sign(BODY, 'whsec_other', TIMESTAMP), SECRET, { now: AT }),
    /digest mismatch/,
  );
});

test('a stale timestamp is rejected, and the tolerance is configurable', () => {
  const old = String(Math.floor(AT.getTime() / 1000) - 3600);
  assert.throws(() => verifyShippoSignature(BODY, sign(BODY, SECRET, old), SECRET, { now: AT }), /tolerance/);
  assert.doesNotThrow(() =>
    verifyShippoSignature(BODY, sign(BODY, SECRET, old), SECRET, { now: AT, toleranceSeconds: 7200 }),
  );
});

test('a missing or malformed header is rejected before any hashing', () => {
  assert.throws(() => verifyShippoSignature(BODY, undefined, SECRET, { now: AT }), /header missing/);
  assert.throws(() => verifyShippoSignature(BODY, '', SECRET, { now: AT }), /header missing/);
  assert.throws(() => verifyShippoSignature(BODY, 'garbage', SECRET, { now: AT }), /malformed header/);
  assert.throws(() => verifyShippoSignature(BODY, 't=123', SECRET, { now: AT }), /malformed header/);
  assert.throws(() => verifyShippoSignature(BODY, 't=abc,v1=00', SECRET, { now: AT }), /timestamp/);
  assert.throws(() => verifyShippoSignature(BODY, `t=${TIMESTAMP},v1=zz`, SECRET, { now: AT }), /digest mismatch/);
});

test('a signature header that repeats t or v1 is malformed, not last value wins', () => {
  const genuine = sign(BODY, SECRET, TIMESTAMP);
  const v1 = genuine.slice(genuine.indexOf('v1='));
  // Appending a second v1 after a wrong one used to verify: the last value won.
  assert.throws(
    () => verifyShippoSignature(BODY, `t=${TIMESTAMP},v1=deadbeef,${v1}`, SECRET, { now: AT }),
    /malformed header/,
  );
  assert.throws(
    () => verifyShippoSignature(BODY, `t=${TIMESTAMP},t=${TIMESTAMP},${v1}`, SECRET, { now: AT }),
    /malformed header/,
  );
  // The genuine single-parameter header still verifies.
  assert.doesNotThrow(() => verifyShippoSignature(BODY, genuine, SECRET, { now: AT }));
});

test('an empty secret is refused rather than verifying everything', () => {
  assert.throws(() => verifyShippoSignature(BODY, sign(BODY, '', TIMESTAMP), '', { now: AT }), /secret/);
});

test('verifyShippoTrust routes each mode, and every mode fails closed', () => {
  assert.doesNotThrow(() =>
    verifyShippoTrust(
      BODY,
      { mode: 'hmac', secret: SECRET, signatureHeader: sign(BODY, SECRET, TIMESTAMP) },
      { now: AT },
    ),
  );
  assert.throws(
    () => verifyShippoTrust(BODY, { mode: 'hmac', secret: SECRET, signatureHeader: 't=1,v1=00' }, { now: AT }),
    ShippoSignatureError,
  );
  assert.doesNotThrow(() =>
    verifyShippoTrust(BODY, { mode: 'url_token', expected: 'abc123', received: 'abc123' }),
  );
  assert.throws(
    () => verifyShippoTrust(BODY, { mode: 'url_token', expected: 'abc123', received: 'abc124' }),
    /url token/,
  );
  assert.throws(
    () => verifyShippoTrust(BODY, { mode: 'url_token', expected: 'abc123', received: undefined }),
    /url token/,
  );
  assert.throws(() => verifyShippoTrust(BODY, { mode: 'url_token', expected: '', received: '' }), /url token/);
  assert.doesNotThrow(() =>
    verifyShippoTrust(BODY, {
      mode: 'caller_verified',
      attestation: 'I verified this request came from Shippo',
    }),
  );
});
