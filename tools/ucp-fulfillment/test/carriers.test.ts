import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  carrierDisplayName,
  carrierTrackingUrl,
  templateTrackingUrl,
  shippoTrackingPageUrl,
} from '../src/carriers.ts';

test('known carrier tokens get buyer-facing display names', () => {
  assert.equal(carrierDisplayName('usps'), 'USPS');
  assert.equal(carrierDisplayName('ups'), 'UPS');
  assert.equal(carrierDisplayName('fedex'), 'FedEx');
  assert.equal(carrierDisplayName('dhl_express'), 'DHL Express');
  assert.equal(carrierDisplayName('dhl_ecommerce'), 'DHL eCommerce');
  assert.equal(carrierDisplayName('canada_post'), 'Canada Post');
  assert.equal(carrierDisplayName('shippo'), 'Shippo');
  assert.equal(carrierDisplayName('USPS'), 'USPS');
  assert.equal(carrierDisplayName('  FedEx  '), 'FedEx');
});

test('an unknown token is title-cased, never leaked raw to a buyer', () => {
  assert.equal(carrierDisplayName('some_new_carrier'), 'Some New Carrier');
  assert.equal(carrierDisplayName('poste_italiane'), 'Poste Italiane');
  assert.equal(carrierDisplayName('x'), 'X');
  assert.equal(carrierDisplayName(''), '');
  // The remainder of each word is lowercased, so a token Shippo happens to send in caps reads as
  // a name rather than as shouting in the buyer's order timeline.
  assert.equal(carrierDisplayName('ALLCAPS_TOKEN'), 'Allcaps Token');
  assert.equal(carrierDisplayName('Better Trucks'), 'Better Trucks');
});

test('a merchant override wins over both the table and the fallback', () => {
  assert.equal(carrierDisplayName('usps', { usps: 'United States Postal Service' }), 'United States Postal Service');
  assert.equal(carrierDisplayName('better_trucks', { better_trucks: 'Better Trucks' }), 'Better Trucks');
});

test('tracking URLs for the four built-in carriers, with whitespace stripped', () => {
  assert.equal(
    carrierTrackingUrl('usps', '9400 1118'),
    'https://tools.usps.com/go/TrackConfirmAction?tLabels=94001118',
  );
  assert.equal(
    carrierTrackingUrl('ups', '1Z999AA10123456784'),
    'https://www.ups.com/track?tracknum=1Z999AA10123456784',
  );
  assert.equal(
    carrierTrackingUrl('fedex', '123456789012'),
    'https://www.fedex.com/wtrk/track/?trknbr=123456789012',
  );
  assert.equal(
    carrierTrackingUrl('dhl_express', '1234567890'),
    'https://www.dhl.com/en/express/tracking.html?AWB=1234567890',
  );
  assert.equal(carrierTrackingUrl('USPS', '9400'), 'https://tools.usps.com/go/TrackConfirmAction?tLabels=9400');
});

test('no built-in URL for carriers outside the table', () => {
  assert.equal(carrierTrackingUrl('deutsche_post', 'LX000000000DE'), undefined);
  assert.equal(carrierTrackingUrl('canada_post', '1234'), undefined);
  assert.equal(carrierTrackingUrl('usps', '   '), undefined);
  assert.equal(carrierTrackingUrl('usps', ''), undefined);
});

test('a template resolver never falls back to the built-in table', () => {
  assert.equal(templateTrackingUrl('ups', '1Z9'), undefined);
  assert.equal(templateTrackingUrl('ups', '1Z9', { usps: 'https://x/{tracking_number}' }), undefined);
  assert.equal(templateTrackingUrl('ups', '1Z9', { ups: 'https://x/{tracking_number}' }), 'https://x/1Z9');
  assert.equal(templateTrackingUrl('ups', '   ', { ups: 'https://x/{tracking_number}' }), undefined);
  // carrierTrackingUrl keeps its own template handling, so a caller with one map still gets one call.
  assert.equal(carrierTrackingUrl('ups', '1Z9', { ups: 'https://x/{tracking_number}' }), 'https://x/1Z9');
  assert.equal(carrierTrackingUrl('ups', '1Z9', { usps: 'https://x/{tracking_number}' }), 'https://www.ups.com/track?tracknum=1Z9');
});

test('a merchant template covers a carrier we have no built-in URL for', () => {
  assert.equal(
    carrierTrackingUrl('canada_post', '1234 5678', {
      canada_post:
        'https://www.canadapost-postescanada.ca/track-reperage/en#/resultList?searchFor={tracking_number}',
    }),
    'https://www.canadapost-postescanada.ca/track-reperage/en#/resultList?searchFor=12345678',
  );
});

test('a merchant template overrides a built-in URL, as a string or a function', () => {
  assert.equal(
    carrierTrackingUrl('usps', 'X9', { usps: 'https://merchant.example/t/{tracking_number}' }),
    'https://merchant.example/t/X9',
  );
  assert.equal(
    carrierTrackingUrl('ups', '1Z9', {
      ups: (n) => `https://www.ups.com/track?loc=en_US&requester=ST&tracknum=${encodeURIComponent(n)}`,
    }),
    'https://www.ups.com/track?loc=en_US&requester=ST&tracknum=1Z9',
  );
});

test('template values are URL encoded so a stray character cannot break the query', () => {
  assert.equal(
    carrierTrackingUrl('usps', 'A&B=C', { usps: 'https://merchant.example/t?n={tracking_number}' }),
    'https://merchant.example/t?n=A%26B%3DC',
  );
});

test('the Shippo tracking page is a universal fallback for any carrier token', () => {
  assert.equal(
    shippoTrackingPageUrl('usr_42', 'deutsche_post', 'LX000000000DE'),
    'https://track.goshippo.com/tracking/usr_42/deutsche_post/LX000000000DE',
  );
  assert.equal(
    shippoTrackingPageUrl('usr_42', 'USPS', '9400 1118'),
    'https://track.goshippo.com/tracking/usr_42/usps/94001118',
  );
});
