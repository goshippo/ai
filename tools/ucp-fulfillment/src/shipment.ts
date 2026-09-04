import type { PostalAddress } from './generated/index.js';
import { DestinationIncompleteError } from './errors.js';

/**
 * A UCP postal address: the generated type from common/types/postal_address.json under a name that
 * says whose address vocabulary it is. No field is required by the schema, and there is no email
 * and no company: the buyer's email lives on the checkout's buyer object, not on the address.
 *
 * An ALIAS, deliberately, not a hand copy. A copy sits outside the CI drift check that regenerates
 * src/generated/ucp.ts from the vendored schemas, so a UCP release that added a postal field would
 * be dropped here in silence, which is the one thing this library promises never to do.
 */
export type UcpPostalAddress = PostalAddress;

/**
 * A UCP shipping destination: a postal address plus an id and a shipping_address type. Both are
 * required in a Business response and optional in a Platform request, so both are optional here.
 */
export interface ShippingDestinationLike extends UcpPostalAddress {
  id?: string;
  type?: 'shipping_address';
}

/**
 * The subset of a Shippo AddressCreateRequest this library writes. Shippo requires only
 * `country`, but rating quality collapses without street, locality, region and postal code, and
 * several carriers refuse international rates without a destination phone number.
 */
export interface ShippoAddressInput {
  name?: string;
  company?: string;
  street1?: string;
  street2?: string;
  city?: string;
  state?: string;
  zip?: string;
  country: string;
  phone?: string;
  email?: string;
  isResidential?: boolean;
  metadata?: string;
  /** Ask Shippo to validate this address inline while rating. */
  validate?: boolean;
}

/** Shippo's weight units, matching the SDK's WeightUnitEnum values exactly. */
export type ShippoMassUnit = 'g' | 'kg' | 'lb' | 'oz';

/** Shippo's distance units, matching the SDK's DistanceUnitEnum values exactly. */
export type ShippoDistanceUnit = 'cm' | 'in' | 'ft' | 'm' | 'mm' | 'yd';

/**
 * A Shippo parcel. Every dimension and weight is a STRING, which Shippo requires: passing a
 * number is one of the most common causes of a rejected shipment. The two unit types are string
 * unions rather than bare strings so that this interface and the SDK's ParcelCreateRequest are
 * assignable in both directions, which test/sdk-contract.test.ts pins.
 */
export interface ShippoParcelInput {
  massUnit: ShippoMassUnit;
  weight: string;
  distanceUnit: ShippoDistanceUnit;
  height: string;
  length: string;
  width: string;
  metadata?: string;
}

/** The subset of a Shippo ShipmentCreateRequest this library writes. */
export interface ShippoShipmentRequest {
  addressFrom: ShippoAddressInput | string;
  addressTo: ShippoAddressInput | string;
  parcels: Array<ShippoParcelInput | string>;
  customsDeclaration?: string;
  shipmentDate?: string;
  carrierAccounts?: string[];
  metadata?: string;
  /** Always false. See buildShipmentRequest. */
  async: boolean;
}

export interface BuildShipmentOptions {
  /** The merchant's origin, already in Shippo shape, or a stored Shippo address object id. */
  from: ShippoAddressInput | string;
  /** The UCP destination the platform sent, or a stored Shippo address object id. */
  to: ShippingDestinationLike | string;
  parcels: Array<ShippoParcelInput | string>;
  /** A Shippo customs declaration object id. Required by most carriers on an international route. */
  customsDeclaration?: string;
  shipmentDate?: string;
  carrierAccounts?: string[];
  metadata?: string;
  /** Contact details UCP has no address field for. */
  contact?: { name?: string; company?: string; email?: string; isResidential?: boolean };
  /**
   * Ask Shippo to validate the destination inline. Default true: an unvalidated destination is
   * the most common cause of an empty option list, and in a UCP flow the address arrives from an
   * agent, which is exactly when it is most likely to be malformed. The inline flag is the
   * low-latency form; it adds no round trip.
   */
  validateDestination?: boolean;
}

/** ISO 3166-1 alpha-3 codes for the routes a first design partner is most likely to ship. */
const ALPHA3_TO_ALPHA2: Readonly<Record<string, string>> = {
  ARE: 'AE', AUS: 'AU', AUT: 'AT', BEL: 'BE', BRA: 'BR', CAN: 'CA', CHE: 'CH', CHN: 'CN',
  DEU: 'DE', DNK: 'DK', ESP: 'ES', FIN: 'FI', FRA: 'FR', GBR: 'GB', HKG: 'HK', IND: 'IN',
  IRL: 'IE', ITA: 'IT', JPN: 'JP', KOR: 'KR', MEX: 'MX', NLD: 'NL', NOR: 'NO', NZL: 'NZ',
  POL: 'PL', PRT: 'PT', SGP: 'SG', SWE: 'SE', USA: 'US', ZAF: 'ZA',
};

/** Common English country names, which UCP explicitly permits and Shippo prefers not to receive. */
const NAME_TO_ALPHA2: Readonly<Record<string, string>> = {
  australia: 'AU', austria: 'AT', belgium: 'BE', brazil: 'BR', canada: 'CA', china: 'CN',
  denmark: 'DK', finland: 'FI', france: 'FR', germany: 'DE', 'great britain': 'GB',
  'hong kong': 'HK', india: 'IN', ireland: 'IE', italy: 'IT', japan: 'JP', mexico: 'MX',
  netherlands: 'NL', 'new zealand': 'NZ', norway: 'NO', poland: 'PL', portugal: 'PT',
  singapore: 'SG', 'south africa': 'ZA', 'south korea': 'KR', spain: 'ES', sweden: 'SE',
  switzerland: 'CH', 'united arab emirates': 'AE', 'united kingdom': 'GB',
  'united states': 'US', 'united states of america': 'US',
};

/**
 * UCP recommends alpha-2 but explicitly permits alpha-3 and full English country names for
 * backward compatibility, while Shippo asks for alpha-2 for consistent results. Map the forms we
 * recognize and pass anything else through uppercased, because Shippo does convert English names
 * and refusing an unrecognized country here would be worse than sending it on.
 */
export function normalizeCountry(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  const upper = trimmed.toUpperCase();
  if (upper.length === 2) return upper;
  const alpha3 = ALPHA3_TO_ALPHA2[upper];
  if (alpha3) return alpha3;
  const named = NAME_TO_ALPHA2[trimmed.toLowerCase()];
  if (named) return named;
  return upper;
}

function put<T extends object, K extends keyof T>(target: T, key: K, value: T[K] | undefined): void {
  if (value !== undefined && value !== '') target[key] = value;
}

/**
 * UCP postal address to Shippo address. The two schemas name nothing the same way, and getting
 * it wrong is silent: a dropped locality makes rates worse rather than making the call fail.
 */
export function toShippoAddress(
  address: ShippingDestinationLike,
  extra: { name?: string; company?: string; email?: string; metadata?: string; isResidential?: boolean } = {},
): ShippoAddressInput {
  const country = normalizeCountry(address.address_country);
  if (!country) throw new DestinationIncompleteError('address_country');
  const fullName = [address.first_name, address.last_name]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(' ');
  const result: ShippoAddressInput = { country };
  put(result, 'name', fullName || extra.name);
  put(result, 'company', extra.company);
  put(result, 'street1', address.street_address);
  put(result, 'street2', address.extended_address);
  put(result, 'city', address.address_locality);
  put(result, 'state', address.address_region);
  put(result, 'zip', address.postal_code);
  put(result, 'phone', address.phone_number);
  put(result, 'email', extra.email);
  put(result, 'metadata', extra.metadata);
  if (extra.isResidential !== undefined) result.isResidential = extra.isResidential;
  return orderAddressKeys(result);
}

/** Stable key order so a golden reads name, street, locality, country, contact. */
function orderAddressKeys(address: ShippoAddressInput): ShippoAddressInput {
  const ordered: Record<string, unknown> = {};
  for (const key of [
    'name',
    'company',
    'street1',
    'street2',
    'city',
    'state',
    'zip',
    'country',
    'phone',
    'email',
    'isResidential',
    'metadata',
    'validate',
  ] as const) {
    const value = (address as unknown as Record<string, unknown>)[key];
    if (value !== undefined) ordered[key] = value;
  }
  return ordered as unknown as ShippoAddressInput;
}

/** True when origin and destination countries differ, after normalizing both. */
export function isInternational(
  from: Pick<ShippoAddressInput, 'country'>,
  to: Pick<ShippoAddressInput, 'country'>,
): boolean {
  return normalizeCountry(from.country) !== normalizeCountry(to.country);
}

/**
 * Build the Shippo shipment whose rates become UCP fulfillment options.
 *
 * `async: false` is forced and is not an option. Shippo generates rates asynchronously by
 * default and returns an EMPTY rates array, which a checkout cannot wait for and which would
 * show the buyer no shipping options with no error anywhere.
 *
 * Rates at Checkout is the wrong primitive for this seam despite being Shippo's checkout-shaped
 * API: a LiveRate has no object_id, so there is nothing to put in fulfillment_option.id, nothing
 * for selected_option_id to reference, and no way to turn a selection into a purchasable rate.
 * shipments.create is the seam that round-trips.
 */
export function buildShipmentRequest(opts: BuildShipmentOptions): ShippoShipmentRequest {
  const addressTo =
    typeof opts.to === 'string'
      ? opts.to
      : orderAddressKeys({
          ...toShippoAddress(opts.to, opts.contact ?? {}),
          ...((opts.validateDestination ?? true) ? { validate: true } : {}),
        });
  const request: ShippoShipmentRequest = {
    addressFrom: opts.from,
    addressTo,
    parcels: opts.parcels,
    async: false,
  };
  if (opts.customsDeclaration) request.customsDeclaration = opts.customsDeclaration;
  if (opts.shipmentDate) request.shipmentDate = opts.shipmentDate;
  if (opts.carrierAccounts) request.carrierAccounts = opts.carrierAccounts;
  if (opts.metadata) request.metadata = opts.metadata;
  return orderShipmentKeys(request);
}

/**
 * The two conditions that quietly produce an empty international rate list. Exported as stable
 * prefixes so a merchant can switch on the code rather than parse the sentence after it.
 */
export const SHIPMENT_WARNINGS = {
  internationalWithoutCustoms: 'international_without_customs',
  destinationMissingPhoneInternational: 'destination_missing_phone_international',
} as const;

const WARNING_TEXT: Readonly<Record<string, string>> = {
  [SHIPMENT_WARNINGS.internationalWithoutCustoms]:
    `${SHIPMENT_WARNINGS.internationalWithoutCustoms}: this shipment crosses a border and carries no ` +
    'customsDeclaration. Some carriers rate internationally without one; most return nothing.',
  [SHIPMENT_WARNINGS.destinationMissingPhoneInternational]:
    `${SHIPMENT_WARNINGS.destinationMissingPhoneInternational}: several carriers refuse international ` +
    'rates without a destination phone number, and UCP postal_address.phone_number is optional.',
};

/**
 * The reporting form, mirroring buildFulfillmentOptionsResult and buildFulfillmentEventResult.
 * Returns the same request the pure form builds, plus the judgment calls that would otherwise
 * come back as an empty rate list with no explanation.
 *
 * Internationality is only knowable when both ends are addresses. A request built against stored
 * Shippo address object ids carries no warnings rather than a guess, which is stated here so the
 * absence of a warning is never read as a clean bill of health.
 */
export function buildShipmentRequestResult(opts: BuildShipmentOptions): {
  request: ShippoShipmentRequest;
  warnings: string[];
} {
  const request = buildShipmentRequest(opts);
  const warnings: string[] = [];
  const from = request.addressFrom;
  const to = request.addressTo;
  if (typeof from !== 'string' && typeof to !== 'string' && isInternational(from, to)) {
    if (!request.customsDeclaration) {
      warnings.push(WARNING_TEXT[SHIPMENT_WARNINGS.internationalWithoutCustoms]);
    }
    if (!to.phone) {
      warnings.push(WARNING_TEXT[SHIPMENT_WARNINGS.destinationMissingPhoneInternational]);
    }
  }
  return { request, warnings };
}

function orderShipmentKeys(request: ShippoShipmentRequest): ShippoShipmentRequest {
  const ordered: Record<string, unknown> = {
    addressFrom: request.addressFrom,
    addressTo: request.addressTo,
    parcels: request.parcels,
  };
  if (request.customsDeclaration !== undefined) ordered.customsDeclaration = request.customsDeclaration;
  if (request.shipmentDate !== undefined) ordered.shipmentDate = request.shipmentDate;
  if (request.carrierAccounts !== undefined) ordered.carrierAccounts = request.carrierAccounts;
  if (request.metadata !== undefined) ordered.metadata = request.metadata;
  ordered.async = request.async;
  return ordered as unknown as ShippoShipmentRequest;
}
