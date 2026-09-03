import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeCountry,
  toShippoAddress,
  isInternational,
  buildShipmentRequest,
  buildShipmentRequestResult,
  SHIPMENT_WARNINGS,
  type ShippoAddressInput,
  type ShippoParcelInput,
} from '../src/shipment.ts';
import { DestinationIncompleteError } from '../src/errors.ts';
import { validateUcp, assertOnlyKnownKeys, SCHEMA_IDS } from './helpers/ucp-validator.ts';

const US_DESTINATION = {
  type: 'shipping_address' as const,
  id: 'dest_1',
  street_address: '123 Main St',
  extended_address: 'Apt 4',
  address_locality: 'Springfield',
  address_region: 'IL',
  postal_code: '62701',
  address_country: 'US',
  first_name: 'Ada',
  last_name: 'Lovelace',
  phone_number: '+15551234567',
};

const WAREHOUSE: ShippoAddressInput = {
  name: 'Shippo Warehouse',
  street1: '731 Market St',
  city: 'San Francisco',
  state: 'CA',
  zip: '94103',
  country: 'US',
  phone: '+14155551212',
};

const PARCEL: ShippoParcelInput = {
  massUnit: 'lb',
  weight: '1.5',
  distanceUnit: 'in',
  height: '4',
  length: '10',
  width: '8',
};

test('the fixture destination really is a UCP shipping_destination', () => {
  // If the field names below were invented, this would fail. It is the guard against the
  // line_1 / city / region shape one reviewer guessed for a UCP address.
  validateUcp(SCHEMA_IDS.shippingDestination, US_DESTINATION);
  assertOnlyKnownKeys(SCHEMA_IDS.shippingDestination, US_DESTINATION);
});

test('golden: a UCP shipping destination becomes a Shippo address', () => {
  assert.deepEqual(toShippoAddress(US_DESTINATION, { email: 'ada@example.com' }), {
    name: 'Ada Lovelace',
    street1: '123 Main St',
    street2: 'Apt 4',
    city: 'Springfield',
    state: 'IL',
    zip: '62701',
    country: 'US',
    phone: '+15551234567',
    email: 'ada@example.com',
  });
});

test('golden: a German destination with no phone maps without inventing one', () => {
  assert.deepEqual(
    toShippoAddress({
      street_address: 'Unter den Linden 5',
      address_locality: 'Berlin',
      postal_code: '10117',
      address_country: 'DE',
    }),
    {
      street1: 'Unter den Linden 5',
      city: 'Berlin',
      zip: '10117',
      country: 'DE',
    },
  );
});

test('only one of first_name and last_name still yields a name', () => {
  assert.equal(toShippoAddress({ address_country: 'US', first_name: 'Ada' }).name, 'Ada');
  assert.equal(toShippoAddress({ address_country: 'US', last_name: 'Lovelace' }).name, 'Lovelace');
  assert.equal(toShippoAddress({ address_country: 'US' }).name, undefined);
  assert.equal(toShippoAddress({ address_country: 'US' }, { name: 'Recipient' }).name, 'Recipient');
  // A UCP address carries the name, so it wins over the fallback.
  assert.equal(toShippoAddress({ address_country: 'US', first_name: 'Ada' }, { name: 'Recipient' }).name, 'Ada');
});

test('extras that UCP has no field for are carried through', () => {
  assert.deepEqual(
    toShippoAddress({ address_country: 'US' }, {
      company: 'Analytical Engines Ltd',
      email: 'ada@example.com',
      metadata: 'ucp:chk_123',
      isResidential: false,
    }),
    {
      country: 'US',
      company: 'Analytical Engines Ltd',
      email: 'ada@example.com',
      metadata: 'ucp:chk_123',
      isResidential: false,
    },
  );
});

test('alpha-3 codes and common country names normalize to alpha-2', () => {
  assert.equal(normalizeCountry('US'), 'US');
  assert.equal(normalizeCountry('us'), 'US');
  assert.equal(normalizeCountry('SGP'), 'SG');
  assert.equal(normalizeCountry('DEU'), 'DE');
  assert.equal(normalizeCountry('Singapore'), 'SG');
  assert.equal(normalizeCountry('united states'), 'US');
  assert.equal(normalizeCountry('United Kingdom'), 'GB');
  assert.equal(normalizeCountry('  Germany  '), 'DE');
  assert.equal(normalizeCountry(undefined), undefined);
  assert.equal(normalizeCountry(''), undefined);
  // Unrecognized values pass through uppercased: Shippo accepts English country names.
  assert.equal(normalizeCountry('Wakanda'), 'WAKANDA');
  assert.equal(toShippoAddress({ address_country: 'SGP' }).country, 'SG');
  assert.equal(toShippoAddress({ address_country: 'Singapore' }).country, 'SG');
});

test('no country throws rather than producing a shipment Shippo will reject', () => {
  assert.throws(() => toShippoAddress({ postal_code: '62701' }), DestinationIncompleteError);
  assert.throws(() => toShippoAddress({ address_country: '   ' }), DestinationIncompleteError);
  assert.throws(
    () => toShippoAddress({ postal_code: '62701' }),
    (error: unknown) => error instanceof DestinationIncompleteError && error.field === 'address_country',
  );
});

test('golden: the shipment request forces synchronous rating and validates the destination', () => {
  assert.deepEqual(
    buildShipmentRequest({ from: WAREHOUSE, to: US_DESTINATION, parcels: [PARCEL], metadata: 'ucp:chk_123' }),
    {
      addressFrom: WAREHOUSE,
      addressTo: {
        name: 'Ada Lovelace',
        street1: '123 Main St',
        street2: 'Apt 4',
        city: 'Springfield',
        state: 'IL',
        zip: '62701',
        country: 'US',
        phone: '+15551234567',
        validate: true,
      },
      parcels: [PARCEL],
      metadata: 'ucp:chk_123',
      async: false,
    },
  );
});

test('async is false on every path, because rate generation is asynchronous by default', () => {
  for (const request of [
    buildShipmentRequest({ from: WAREHOUSE, to: US_DESTINATION, parcels: [PARCEL] }),
    buildShipmentRequest({ from: WAREHOUSE, to: US_DESTINATION, parcels: [PARCEL], validateDestination: false }),
    buildShipmentRequest({
      from: WAREHOUSE,
      to: US_DESTINATION,
      parcels: ['parcel_template_1'],
      customsDeclaration: 'cd_1',
      carrierAccounts: ['ca_usps'],
      shipmentDate: '2026-09-04T00:35:03.463Z',
    }),
  ]) {
    assert.equal(request.async, false);
  }
});

test('destination validation is on by default and switchable off', () => {
  const on = buildShipmentRequest({ from: WAREHOUSE, to: US_DESTINATION, parcels: [PARCEL] });
  assert.equal((on.addressTo as ShippoAddressInput).validate, true);
  const off = buildShipmentRequest({
    from: WAREHOUSE,
    to: US_DESTINATION,
    parcels: [PARCEL],
    validateDestination: false,
  });
  assert.equal((off.addressTo as ShippoAddressInput).validate, undefined);
  // The origin is the merchant's own address and is never re-validated on every checkout.
  assert.equal((on.addressFrom as ShippoAddressInput).validate, undefined);
});

test('golden: an international shipment carries the customs declaration through', () => {
  assert.deepEqual(
    buildShipmentRequest({
      from: WAREHOUSE,
      to: {
        street_address: 'Unter den Linden 5',
        address_locality: 'Berlin',
        postal_code: '10117',
        address_country: 'DEU',
        phone_number: '+493012345678',
      },
      parcels: [PARCEL],
      customsDeclaration: 'cd_abc',
      carrierAccounts: ['ca_dhl_us'],
    }),
    {
      addressFrom: WAREHOUSE,
      addressTo: {
        street1: 'Unter den Linden 5',
        city: 'Berlin',
        zip: '10117',
        country: 'DE',
        phone: '+493012345678',
        validate: true,
      },
      parcels: [PARCEL],
      customsDeclaration: 'cd_abc',
      carrierAccounts: ['ca_dhl_us'],
      async: false,
    },
  );
});

test('parcel dimensions stay strings, which is what Shippo requires', () => {
  const request = buildShipmentRequest({ from: WAREHOUSE, to: US_DESTINATION, parcels: [PARCEL] });
  const parcel = request.parcels[0] as ShippoParcelInput;
  for (const [field, value] of Object.entries(parcel)) {
    assert.equal(typeof value, 'string', `${field} must be a string, got ${typeof value}`);
  }
  assert.deepEqual(parcel, { massUnit: 'lb', weight: '1.5', distanceUnit: 'in', height: '4', length: '10', width: '8' });
});

test('an international shipment with no customs declaration is reported, not built in silence', () => {
  const berlin = {
    street_address: 'Unter den Linden 5',
    address_locality: 'Berlin',
    postal_code: '10117',
    address_country: 'DEU',
    phone_number: '+493012345678',
  };
  const { request, warnings } = buildShipmentRequestResult({
    from: WAREHOUSE,
    to: berlin,
    parcels: [PARCEL],
  });
  assert.deepEqual(warnings, [
    'international_without_customs: this shipment crosses a border and carries no customsDeclaration. ' +
      'Some carriers rate internationally without one; most return nothing.',
  ]);
  assert.equal(warnings[0].startsWith(SHIPMENT_WARNINGS.internationalWithoutCustoms), true);
  // The request is still built: this is a warning, not a refusal.
  assert.deepEqual(request, buildShipmentRequest({ from: WAREHOUSE, to: berlin, parcels: [PARCEL] }));
  assert.equal(request.async, false);
  assert.equal((request.addressTo as ShippoAddressInput).country, 'DE');

  // With a customs declaration attached, only the missing phone remains.
  const noPhone = buildShipmentRequestResult({
    from: WAREHOUSE,
    to: { ...berlin, phone_number: undefined },
    parcels: [PARCEL],
    customsDeclaration: 'cd_abc',
  });
  assert.deepEqual(noPhone.warnings, [
    'destination_missing_phone_international: several carriers refuse international rates without a ' +
      'destination phone number, and UCP postal_address.phone_number is optional.',
  ]);
});

test('a domestic shipment warns about nothing, and an address id yields no guess', () => {
  assert.deepEqual(
    buildShipmentRequestResult({ from: WAREHOUSE, to: US_DESTINATION, parcels: [PARCEL] }).warnings,
    [],
  );
  // Both ends stored as Shippo object ids: internationality is unknowable, so no warning is
  // invented. The absence of a warning here is not a clean bill of health.
  assert.deepEqual(
    buildShipmentRequestResult({ from: 'adr_from_1', to: 'adr_to_1', parcels: [PARCEL] }).warnings,
    [],
  );
});

test('international is decided on normalized country codes', () => {
  assert.equal(isInternational({ country: 'US' }, { country: 'US' }), false);
  assert.equal(isInternational({ country: 'US' }, { country: 'us' }), false);
  assert.equal(isInternational({ country: 'US' }, { country: 'USA' }), false);
  assert.equal(isInternational({ country: 'US' }, { country: 'DE' }), true);
  assert.equal(isInternational({ country: 'US' }, { country: 'Germany' }), true);
});
