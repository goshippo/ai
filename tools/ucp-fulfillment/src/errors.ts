/**
 * Every error this library throws extends UcpFulfillmentError, so a consumer can catch the
 * whole family in one clause and branch on `retryable`. No error class from a dependency and
 * no bare built-in ever escapes the public API: a merchant who catches UcpFulfillmentError
 * has caught everything the library can throw.
 *
 * retryable === false means the same call will fail the same way forever. In a webhook route
 * that means: log, alert, and answer 2xx so the sender stops redelivering.
 * retryable === true means a transient platform or network failure. Answer 5xx and let the
 * sender redeliver, or requeue with backoff.
 */
export abstract class UcpFulfillmentError extends Error {
  readonly retryable: boolean;

  constructor(message: string, opts: { retryable: boolean; cause?: unknown }) {
    super(message, { cause: opts.cause });
    this.name = 'UcpFulfillmentError';
    this.retryable = opts.retryable;
  }
}

/** A monetary amount that is not a plain decimal number. Permanent. */
export class InvalidAmountError extends UcpFulfillmentError {
  constructor(readonly amount: unknown) {
    super(
      `Unparseable monetary amount ${JSON.stringify(amount)}: expected a decimal string such as "8.35", ` +
        'with an optional leading minus and no grouping separators',
      { retryable: false },
    );
    this.name = 'InvalidAmountError';
  }
}

/** An amount that cannot be represented as a UCP signed_amount. Permanent. */
export class AmountRangeError extends UcpFulfillmentError {
  constructor(readonly amount: unknown, readonly currency: string) {
    super(
      `Amount ${JSON.stringify(amount)} ${currency} exceeds the UCP signed_amount maximum of ` +
        '9007199254740991 minor units',
      { retryable: false },
    );
    this.name = 'AmountRangeError';
  }
}

/** A currency code with no known ISO 4217 minor-unit exponent. Permanent. */
export class UnknownCurrencyError extends UcpFulfillmentError {
  constructor(readonly currency: string) {
    super(
      `Unknown ISO 4217 currency ${JSON.stringify(currency)}: refusing to guess a minor-unit exponent. ` +
        'Pass it in the currencyExponents override map.',
      { retryable: false },
    );
    this.name = 'UnknownCurrencyError';
  }
}

/** A rate priced in a currency the checkout does not use. Permanent. */
export class CurrencyMismatchError extends UcpFulfillmentError {
  constructor(readonly rateId: string, readonly rateCurrency: string, readonly checkoutCurrency: string) {
    super(
      `Rate ${rateId} is priced in ${rateCurrency} but the checkout currency is ${checkoutCurrency}. ` +
        'Re-request rates in the checkout currency with ratesInCurrency (Shippo ' +
        'ListShipmentRatesByCurrencyCode), or set amountSource. This library never converts currency.',
      { retryable: false },
    );
    this.name = 'CurrencyMismatchError';
  }
}

/** Shippo returned a shipment with no rates. Permanent for these inputs. */
export class NoRatesError extends UcpFulfillmentError {
  constructor(readonly shipmentStatus: string | undefined) {
    super(
      `Shippo returned no rates (shipment status ${shipmentStatus ?? 'unknown'}). ` +
        'Check that both addresses validate, that the parcel dimensions are plausible, that a carrier ' +
        'account serves the route, and for international shipments that a customs declaration is attached.',
      { retryable: false },
    );
    this.name = 'NoRatesError';
  }
}

/** No usable line items were supplied for an event or an expectation. Permanent. */
export class LineItemsRequiredError extends UcpFulfillmentError {
  constructor() {
    super(
      'line_items is required: pass at least one { id, quantity } where id is a non-empty string and ' +
        'quantity is an integer of at least 1 step of the order line quantity_unit',
      { retryable: false },
    );
    this.name = 'LineItemsRequiredError';
  }
}

/** Line item references that do not reconcile against the order. Permanent. */
export class LineItemMismatchError extends UcpFulfillmentError {
  constructor(readonly problems: string[]) {
    super(`fulfillment_event line_items do not reconcile with the order: ${problems.join('; ')}`, {
      retryable: false,
    });
    this.name = 'LineItemMismatchError';
  }
}

/** No tracking URL resolved and the caller asked for one. Permanent. */
export class TrackingUrlUnresolvedError extends UcpFulfillmentError {
  constructor(readonly carrier: string, readonly trackingNumber: string) {
    super(
      `No tracking_url resolved for ${carrier} ${trackingNumber}. Pass trackingUrl, the purchasing ` +
        'transaction (tracking_url_provider), a trackingUrlTemplates entry, or shippoTrackingUserId. ' +
        'UCP requires tracking_url once the event type is past processing in the fulfillment_event.json ' +
        'field description only; it is not schema-enforced.',
      { retryable: false },
    );
    this.name = 'TrackingUrlUnresolvedError';
  }
}

/** A track with no tracking_status carries nothing to map. Permanent. */
export class MissingTrackingStatusError extends UcpFulfillmentError {
  constructor(readonly trackingNumber: string) {
    super(`Track ${trackingNumber} has no tracking_status, so there is nothing to map`, {
      retryable: false,
    });
    this.name = 'MissingTrackingStatusError';
  }
}

/** A Shippo track payload missing a field the mapping cannot do without. Permanent. */
export class MalformedTrackError extends UcpFulfillmentError {
  constructor(readonly field: string) {
    super(`Shippo track payload is missing or malformed: ${field}`, { retryable: false });
    this.name = 'MalformedTrackError';
  }
}

/** A Shippo rate payload missing a field the mapping cannot price without. Permanent. */
export class MalformedRateError extends UcpFulfillmentError {
  constructor(readonly field: string) {
    super(`Shippo rate payload is missing or malformed: ${field}`, { retryable: false });
    this.name = 'MalformedRateError';
  }
}

/** A Shippo tracking status outside the six documented values. Permanent. */
export class UnmappedTrackingStatusError extends UcpFulfillmentError {
  constructor(readonly status: string, readonly substatusCode: string | undefined) {
    super(
      `Unmapped Shippo tracking status ${JSON.stringify(status)} (substatus ` +
        `${JSON.stringify(substatusCode)}). The six documented statuses are UNKNOWN, PRE_TRANSIT, ` +
        'TRANSIT, DELIVERED, RETURNED and FAILURE. Refusing to guess a UCP fulfillment_event type.',
      { retryable: false },
    );
    this.name = 'UnmappedTrackingStatusError';
  }
}

/** A selected_option_id that names no option in the group. Permanent. */
export class SelectedOptionUnknownError extends UcpFulfillmentError {
  constructor(readonly optionId: string) {
    super(
      `selected_option_id ${optionId} is not among the options quoted for this group. UCP requires the ` +
        'business to reject an unrecognized selection rather than substitute another option.',
      { retryable: false },
    );
    this.name = 'SelectedOptionUnknownError';
  }
}

/** A selected_destination_id that names no destination on the method. Permanent. */
export class SelectedDestinationUnknownError extends UcpFulfillmentError {
  constructor(readonly destinationId: string) {
    super(
      `selected_destination_id ${destinationId} is not among this method's destinations. UCP requires ` +
        'exactly one destination whose id equals the accepted selection.',
      { retryable: false },
    );
    this.name = 'SelectedDestinationUnknownError';
  }
}

/** A UCP destination missing a field Shippo requires. Permanent. */
export class DestinationIncompleteError extends UcpFulfillmentError {
  constructor(readonly field: string) {
    super(
      `Shipping destination is missing ${field}, which Shippo requires on every address. ` +
        'Return the checkout with a recoverable message asking for it rather than rating without it.',
      { retryable: false },
    );
    this.name = 'DestinationIncompleteError';
  }
}

/** An order that is not shaped like a UCP Order. Permanent. */
export class InvalidOrderError extends UcpFulfillmentError {
  constructor(readonly problems: string[]) {
    super(`Order is not a valid UCP order: ${problems.join('; ')}`, { retryable: false });
    this.name = 'InvalidOrderError';
  }
}

/** An attempt to send an order event webhook with no RFC 9421 signer. Permanent. */
export class UnsignedWebhookError extends UcpFulfillmentError {
  constructor() {
    super(
      'UCP requires every order event webhook to be signed (RFC 9421 Signature and Signature-Input). ' +
        'Pass a sign hook, or allowUnsigned: true against a local test receiver only.',
      { retryable: false },
    );
    this.name = 'UnsignedWebhookError';
  }
}

/** A signer that tried to overwrite a header the digest depends on. Permanent. */
export class SignerConflictError extends UcpFulfillmentError {
  constructor(readonly header: string) {
    super(
      `The signer returned a conflicting ${header}. The RFC 9421 signature must cover the exact ` +
        'body and headers this library built, so the signer may add Signature and Signature-Input ' +
        'but may not replace Content-Digest or Content-Type.',
      { retryable: false },
    );
    this.name = 'SignerConflictError';
  }
}

/** An inbound Shippo webhook that failed its trust check. Permanent. */
export class ShippoSignatureError extends UcpFulfillmentError {
  constructor(readonly reason: string) {
    super(`Shippo webhook rejected: ${reason}`, { retryable: false });
    this.name = 'ShippoSignatureError';
  }
}

/** A Shippo webhook sent under an API version whose payload shape this library cannot read. Permanent. */
export class ShippoApiVersionError extends UcpFulfillmentError {
  constructor(readonly version: string) {
    super(
      `Shippo API version ${version} sends a Transaction, not a Track, in track_updated. ` +
        'This library requires 2018-02-08 or later.',
      { retryable: false },
    );
    this.name = 'ShippoApiVersionError';
  }
}

/** The Shippo client was constructed with neither an API key nor an injected SDK. Permanent. */
export class ShippoClientConfigError extends UcpFulfillmentError {
  constructor() {
    super(
      'createShippoClient needs apiKeyHeader, or an injected sdk for tests. Live and test mode are ' +
        'chosen by which Shippo API key you pass.',
      { retryable: false },
    );
    this.name = 'ShippoClientConfigError';
  }
}

/** The platform rejected an order event. Retryable only for 408, 429 and 5xx. */
export class OrderEventDeliveryError extends UcpFulfillmentError {
  constructor(readonly status: number, readonly responseText: string) {
    super(`Platform webhook rejected the order event with HTTP ${status}`, {
      retryable: status >= 500 || status === 408 || status === 429,
    });
    this.name = 'OrderEventDeliveryError';
  }
}
