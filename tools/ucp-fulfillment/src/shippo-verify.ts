import { createHmac, timingSafeEqual } from 'node:crypto';
import { ShippoSignatureError } from './errors.js';

/**
 * The header Shippo sends with an HMAC-secured webhook. Taken from Shippo's webhook security
 * documentation, whose verification script reads it from the CGI variable
 * HTTP_SHIPPO_AUTH_SIGNATURE. The value is shaped `t=<unix seconds>,v1=<hex sha256>`.
 */
export const SHIPPO_SIGNATURE_HEADER = 'Shippo-Auth-Signature';

/**
 * How a caller established that an inbound request really came from Shippo. Required on every
 * entry point, so the unsafe path is a deliberate, greppable, typed choice rather than a
 * forgotten default.
 *
 * 'hmac' is the strongest of Shippo's three documented mechanisms. The secret is issued by Shippo
 * support rather than self-service, so 'url_token' (a self-generated query token) and
 * 'caller_verified' (the merchant already checked the inbound IP allowlist, or verified elsewhere)
 * are real options rather than escape hatches.
 */
export type ShippoTrust =
  | { mode: 'hmac'; secret: string; signatureHeader: string | undefined }
  | { mode: 'url_token'; expected: string; received: string | undefined }
  | { mode: 'caller_verified'; attestation: 'I verified this request came from Shippo' };

function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
}

/**
 * Verify Shippo's HMAC webhook signature over the RAW request body.
 *
 * The signed payload is `${timestamp}.${rawBody}`, HMAC-SHA256 with the shared secret, compared
 * as hex. Pass the raw bytes: once the body has been through JSON.parse the exact bytes are gone
 * and re-serializing will not reproduce them, which is why both webhook entry points in this
 * library take a string rather than an object.
 *
 * `toleranceSeconds` (default 300) bounds how old the signed `t` may be. Shippo's own retry of a
 * failed delivery replays the SAME `t` from the original send rather than minting a new one, so a
 * retry landing more than five minutes after the original attempt is rejected as untrusted here,
 * not accepted as a fresh request. A caller that needs to accept Shippo's retries after a longer
 * outage should raise `toleranceSeconds` accordingly.
 */
export function verifyShippoSignature(
  rawBody: string,
  signatureHeader: string | undefined,
  secret: string,
  opts: { toleranceSeconds?: number; now?: Date } = {},
): void {
  if (!secret) throw new ShippoSignatureError('no HMAC secret configured');
  if (!signatureHeader) throw new ShippoSignatureError('header missing');
  const parts = new Map<string, string>();
  for (const piece of signatureHeader.split(',')) {
    const index = piece.indexOf('=');
    if (index > 0) parts.set(piece.slice(0, index).trim(), piece.slice(index + 1).trim());
  }
  const timestamp = parts.get('t');
  const provided = parts.get('v1');
  if (!timestamp || !provided) throw new ShippoSignatureError('malformed header');
  const seconds = Number(timestamp);
  if (!Number.isFinite(seconds)) throw new ShippoSignatureError('timestamp is not a number');
  const skew = Math.abs(Math.floor((opts.now ?? new Date()).getTime() / 1000) - seconds);
  if (skew > (opts.toleranceSeconds ?? 300)) throw new ShippoSignatureError('timestamp outside tolerance');
  const expected = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`, 'utf8').digest('hex');
  if (!constantTimeEquals(expected, provided)) throw new ShippoSignatureError('digest mismatch');
}

/** Apply whichever trust mechanism the caller declared. Throws ShippoSignatureError on failure. */
export function verifyShippoTrust(
  rawBody: string,
  trust: ShippoTrust,
  opts: { toleranceSeconds?: number; now?: Date } = {},
): void {
  switch (trust.mode) {
    case 'hmac':
      verifyShippoSignature(rawBody, trust.signatureHeader, trust.secret, opts);
      return;
    case 'url_token':
      if (!constantTimeEquals(trust.expected, trust.received ?? '')) {
        throw new ShippoSignatureError('url token mismatch');
      }
      return;
    case 'caller_verified':
      return;
  }
}
