/**
 * The dependency-free entry. Everything here maps between Shippo shapes and UCP shapes with no
 * runtime I/O and no third-party imports, so `@shippo/ucp-fulfillment/core` loads in about four
 * milliseconds and pulls in zero node_modules files. Import the package root instead when you
 * also want the Shippo SDK client.
 */
export const PACKAGE_NAME = '@shippo/ucp-fulfillment';

export {
  UcpFulfillmentError,
  InvalidAmountError,
  AmountRangeError,
  UnknownCurrencyError,
  CurrencyMismatchError,
  NoRatesError,
  LineItemsRequiredError,
  LineItemMismatchError,
  TrackingUrlUnresolvedError,
  MissingTrackingStatusError,
  MalformedTrackError,
  MalformedRateError,
  UnmappedTrackingStatusError,
  SelectedOptionUnknownError,
  SelectedDestinationUnknownError,
  DestinationIncompleteError,
  InvalidOrderError,
  UnsignedWebhookError,
  SignerConflictError,
  ShippoSignatureError,
  ShippoApiVersionError,
  ShippoClientConfigError,
  OrderEventDeliveryError,
} from './errors.js';

export { currencyExponent, toMinorUnits, MAX_MINOR_UNITS, type CurrencyExponents } from './money.js';

export {
  carrierDisplayName,
  carrierTrackingUrl,
  templateTrackingUrl,
  shippoTrackingPageUrl,
  type TrackingUrlTemplate,
  type TrackingUrlTemplates,
} from './carriers.js';

export {
  firstBusinessDayOnOrAfter,
  addBusinessDays,
  addCalendarDays,
  defaultBufferDays,
  deliveryWindow,
  type TransitDayBasis,
  type DeliveryWindow,
  type DeliveryWindowInput,
  type DeliveryWindowOptions,
} from './delivery-window.js';

export {
  normalizeRate,
  optionId,
  optionTitle,
  optionDescription,
  optionTotalAmount,
  buildFulfillmentOption,
  buildFulfillmentOptions,
  buildFulfillmentOptionsResult,
  rateIdsByOptionId,
  matchSelectedOption,
  buildCatalogPreviewOptions,
  catalogShippingMethod,
  isRateExpired,
  RATE_MAX_AGE_MS,
  type AmountSource,
  type BuildOptionOptions,
  type CatalogFulfillmentMethod,
  type CatalogPreviewOptions,
  type ShippoRateInput,
  type ShippoServiceLevelInput,
} from './rates.js';

export {
  normalizeCountry,
  toShippoAddress,
  isInternational,
  buildShipmentRequest,
  buildShipmentRequestResult,
  SHIPMENT_WARNINGS,
  type BuildShipmentOptions,
  type ShippingDestinationLike,
  type ShippoAddressInput,
  type ShippoDistanceUnit,
  type ShippoMassUnit,
  type ShippoParcelInput,
  type ShippoShipmentRequest,
  type UcpPostalAddress,
} from './shipment.js';

export {
  buildFulfillmentGroup,
  buildShippingMethod,
  buildShippingFulfillment,
  addressUndeliverableMessage,
  destinationRejectedMessage,
  type BuildShippingFulfillmentInput,
  type ShippingDestination,
  type ShippingFulfillmentMethod,
} from './checkout.js';

export {
  FULFILLMENT_EVENT_TYPES,
  normalizeTrack,
  mapTrackingStatus,
  resolveTrackingUrl,
  buildFulfillmentEvent,
  buildFulfillmentEventResult,
  buildFulfillmentEvents,
  buildExpectation,
  buildProcessingEvent,
  type BuildEventOptions,
  type BuildExpectationOptions,
  type BuildProcessingEventOptions,
  type FulfillmentEventType,
  type LineItemRef,
  type ResolveTrackingUrlOptions,
  type ShippoSubstatusInput,
  type ShippoTrackInput,
  type ShippoTrackingStatusInput,
  type ShippoTransactionInput,
} from './tracking.js';

export {
  assertOrderShape,
  assertLineItemsMatchOrder,
  classifyEvent,
  appendFulfillmentEvent,
  contentDigest,
  webhookIdForEvent,
  buildOrderEventRequest,
  sendOrderEvent,
  type BuildOrderEventRequestOptions,
  type FetchLike,
  type FulfilledResolver,
  type OrderEventRequest,
  type RequestSigner,
  type SendOrderEventOptions,
} from './order-webhook.js';

export {
  SHIPPO_SIGNATURE_HEADER,
  verifyShippoSignature,
  verifyShippoTrust,
  type ShippoTrust,
} from './shippo-verify.js';

export {
  buildTrackWebhookRequest,
  handleShippoTrackWebhook,
  type OrderResolution,
  type TrackWebhookBuildOptions,
  type TrackWebhookHandlerOptions,
  type TrackWebhookPlan,
  type TrackWebhookResult,
  type TrackWebhookSkip,
} from './shippo-webhook.js';

export {
  UCP_VERSION,
  ucpCapabilities,
  orderResponseUcp,
  type CapabilityEntry,
  type OrderResponseUcp,
  type UcpCapabilities,
  type UcpCapabilityOptions,
} from './profile.js';

export type * from './generated/index.js';
