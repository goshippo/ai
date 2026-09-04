import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createShippoClient, type ShippoSdkLike } from '../src/shippo-client.ts';
import { NoRatesError, ShippoClientConfigError } from '../src/errors.ts';
import type { ShippoShipmentRequest } from '../src/shipment.ts';

const SHIPMENT: ShippoShipmentRequest = {
  addressFrom: { country: 'US', zip: '94103' },
  addressTo: { country: 'US', zip: '62701' },
  parcels: [{ massUnit: 'lb', weight: '1.5', distanceUnit: 'in', height: '4', length: '10', width: '8' }],
  async: false,
};

const stub = (overrides: Partial<ShippoSdkLike> = {}): { sdk: ShippoSdkLike; calls: string[] } => {
  const calls: string[] = [];
  const sdk: ShippoSdkLike = {
    shipments: {
      create: async (request) => {
        calls.push(`create:async=${String((request as { async?: boolean }).async)}`);
        return { rates: [{ objectId: 'rate_1' }] as never, status: 'SUCCESS' };
      },
    },
    rates: {
      listShipmentRatesByCurrencyCode: async (request) => {
        calls.push(`byCurrency:${request.shipmentId}:${request.currencyCode}`);
        return { results: [{ objectId: 'rate_eur' }] as never };
      },
    },
    trackingStatus: {
      get: async (trackingNumber, carrier) => {
        calls.push(`get:${carrier}:${trackingNumber}`);
        return { trackingNumber, carrier } as never;
      },
    },
    ...overrides,
  };
  return { sdk, calls };
};

test('rates() forces async:false, because rate generation is asynchronous by default', async () => {
  const { sdk, calls } = stub();
  const rates = await createShippoClient({ sdk }).rates({ ...SHIPMENT, async: true } as ShippoShipmentRequest);
  assert.deepEqual(rates, [{ objectId: 'rate_1' }]);
  assert.deepEqual(calls, ['create:async=false']);
});

test('rates() throws rather than handing a checkout an empty option list', async () => {
  const { sdk } = stub({
    shipments: { create: async () => ({ rates: [] as never, status: 'QUEUED' }) },
  });
  await assert.rejects(
    createShippoClient({ sdk }).rates(SHIPMENT),
    (error: unknown) =>
      error instanceof NoRatesError && error.shipmentStatus === 'QUEUED' && error.retryable === false,
  );
  const { sdk: noRatesKey } = stub({
    shipments: { create: async () => ({ rates: undefined as never }) },
  });
  await assert.rejects(createShippoClient({ sdk: noRatesKey }).rates(SHIPMENT), NoRatesError);
});

test('ratesInCurrency() reaches the remedy CurrencyMismatchError names', async () => {
  const { sdk, calls } = stub();
  const rates = await createShippoClient({ sdk }).ratesInCurrency('shp_1', 'EUR');
  assert.deepEqual(rates, [{ objectId: 'rate_eur' }]);
  assert.deepEqual(calls, ['byCurrency:shp_1:EUR']);
});

test('ratesInCurrency() throws on an empty page rather than returning nothing', async () => {
  const { sdk } = stub({
    rates: { listShipmentRatesByCurrencyCode: async () => ({ results: [] as never }) },
  });
  await assert.rejects(createShippoClient({ sdk }).ratesInCurrency('shp_1', 'EUR'), NoRatesError);
});

test('track() calls trackingStatus.get with Shippo argument order', async () => {
  const { sdk, calls } = stub();
  const track = await createShippoClient({ sdk }).track('usps', '9400');
  assert.deepEqual(track, { trackingNumber: '9400', carrier: 'usps' });
  assert.deepEqual(calls, ['get:usps:9400']);
});

test('without an sdk or an apiKeyHeader it refuses to construct', () => {
  assert.throws(
    () => createShippoClient({}),
    (error: unknown) => error instanceof ShippoClientConfigError && error.retryable === false,
  );
});
