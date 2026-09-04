import { test } from 'node:test';
import assert from 'node:assert/strict';
import type {
  Rate,
  Track,
  AddressCreateRequest,
  ParcelCreateRequest,
  ShipmentCreateRequest,
} from 'shippo/models/components/index.js';
import type { ShippoRateInput } from '../src/rates.ts';
import type { ShippoTrackInput } from '../src/tracking.ts';
import type { ShippoAddressInput, ShippoParcelInput, ShippoShipmentRequest } from '../src/shipment.ts';

/**
 * Compile-time only. The mapping modules describe the Shippo objects structurally so that they
 * import nothing from the SDK, which is what makes the ./core entry dependency free. Nothing
 * otherwise stops a shippo version bump from breaking that description, and the failure would
 * surface as a confusing error inside a fixture helper rather than as a build failure here.
 */
type AssertAssignable<Target, Source extends Target> = Source;

// What the SDK hands us must satisfy what we read.
type _RateSatisfiesInput = AssertAssignable<ShippoRateInput, Rate>;
type _TrackSatisfiesInput = AssertAssignable<ShippoTrackInput, Track>;
type _ParcelSatisfiesInput = AssertAssignable<ShippoParcelInput, ParcelCreateRequest>;

// What we hand the SDK must satisfy what it accepts.
type _AddressSatisfiesSdk = AssertAssignable<AddressCreateRequest, ShippoAddressInput>;
type _ShipmentSatisfiesSdk = AssertAssignable<ShipmentCreateRequest, ShippoShipmentRequest>;

test('the shippo SDK types and this library input types still agree', () => {
  // The assertions above are erased at runtime; this test exists so the file is part of the
  // suite and a type error here fails `npm run typecheck` with a clear message.
  const marker: _RateSatisfiesInput | undefined = undefined;
  const parcel: _ParcelSatisfiesInput | undefined = undefined;
  const shipment: _ShipmentSatisfiesSdk | undefined = undefined;
  const track: _TrackSatisfiesInput | undefined = undefined;
  const address: _AddressSatisfiesSdk | undefined = undefined;
  assert.deepEqual([marker, parcel, shipment, track, address], [undefined, undefined, undefined, undefined, undefined]);
});
