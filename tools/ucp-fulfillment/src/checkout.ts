import type {
  FulfillmentGroup,
  FulfillmentMethod,
  FulfillmentOption,
  MessageError,
} from './generated/index.js';
import { SelectedDestinationUnknownError, SelectedOptionUnknownError, type UcpFulfillmentError } from './errors.js';
import {
  buildFulfillmentOptionsResult,
  type BuildOptionOptions,
  type ShippoRateInput,
} from './rates.js';
import type { ShippingDestinationLike, UcpPostalAddress } from './shipment.js';

/** A shipping destination as a Business returns it: the postal address plus a required id and type. */
export interface ShippingDestination extends UcpPostalAddress {
  id: string;
  type: 'shipping_address';
}

/**
 * A shipping fulfillment_method with its destinations narrowed to shipping addresses. Assignable
 * to FulfillmentMethod, but keeps the postal fields visible to callers, which the generated
 * FulfillmentDestination union does not.
 */
export interface ShippingFulfillmentMethod extends Omit<FulfillmentMethod, 'destinations' | 'groups'> {
  destinations: ShippingDestination[];
  groups: FulfillmentGroup[];
}

export interface BuildShippingFulfillmentInput extends BuildOptionOptions {
  /** Line item ids this shipping method fulfills. UCP requires them on both containers. */
  lineItemIds: string[];
  /** Destinations to enumerate. A missing id is minted as dest_1, dest_2 and so on. */
  destinations: ShippingDestinationLike[];
  /** The destination the platform selected, or null on create. */
  selectedDestinationId?: string | null;
  /** Shippo rates quoted for that destination. */
  rates: ShippoRateInput[];
  /** The option the platform selected, or null on create. */
  selectedOptionId?: string | null;
  /** Method id. Default "shipping". */
  methodId?: string;
  /** Group id. Default "package_1". One group unless the merchant splits the shipment. */
  groupId?: string;
}

/** One group of line items with the options quoted for it. */
export function buildFulfillmentGroup(opts: {
  id: string;
  lineItemIds: string[];
  options: FulfillmentOption[];
  selectedOptionId?: string | null;
}): FulfillmentGroup {
  const selected = opts.selectedOptionId ?? null;
  if (selected !== null && !opts.options.some((option) => option.id === selected)) {
    throw new SelectedOptionUnknownError(selected);
  }
  return {
    id: opts.id,
    line_item_ids: [...opts.lineItemIds],
    options: opts.options,
    selected_option_id: selected,
  };
}

/**
 * One shipping method with its destinations and groups. Enforces the spec's response rule: when
 * the Business accepts a non-null selected_destination_id, the response MUST carry that value
 * and MUST include exactly one destination on the same method whose id equals it.
 */
export function buildShippingMethod(opts: {
  id: string;
  lineItemIds: string[];
  destinations: ShippingDestination[];
  selectedDestinationId?: string | null;
  groups: FulfillmentGroup[];
}): ShippingFulfillmentMethod {
  const selected = opts.selectedDestinationId ?? null;
  if (selected !== null && opts.destinations.filter((d) => d.id === selected).length !== 1) {
    throw new SelectedDestinationUnknownError(selected);
  }
  return {
    id: opts.id,
    type: 'shipping',
    line_item_ids: [...opts.lineItemIds],
    destinations: opts.destinations,
    selected_destination_id: selected,
    groups: opts.groups,
  };
}

/**
 * The checkout `fulfillment` container a Business returns on create and on update. Options are a
 * leaf: methods to groups to options. Uses the Result form of the option builder, so one rate in
 * the wrong currency degrades the option list instead of emptying the checkout, and returns the
 * skipped rates alongside so nothing disappears without a trace.
 */
export function buildShippingFulfillment(input: BuildShippingFulfillmentInput): {
  methods: ShippingFulfillmentMethod[];
  skipped: Array<{ rate: ShippoRateInput; error: UcpFulfillmentError }>;
} {
  const destinations: ShippingDestination[] = input.destinations.map((destination, index) => ({
    ...destination,
    id: destination.id ?? `dest_${index + 1}`,
    type: 'shipping_address',
  }));
  const { options, skipped } = buildFulfillmentOptionsResult(input.rates, input);
  const group = buildFulfillmentGroup({
    id: input.groupId ?? 'package_1',
    lineItemIds: input.lineItemIds,
    options,
    selectedOptionId: input.selectedOptionId,
  });
  const method = buildShippingMethod({
    id: input.methodId ?? 'shipping',
    lineItemIds: input.lineItemIds,
    destinations,
    selectedDestinationId: input.selectedDestinationId,
    groups: [group],
  });
  return { methods: [method], skipped };
}

/**
 * When Shippo returns no rates for a destination, UCP wants the checkout back with a recoverable
 * error message rather than an empty option list a Platform cannot explain. `address_undeliverable`
 * is one of the standard error codes platforms give bespoke handling, and `path` is an RFC 9535
 * JSONPath relative to the response root.
 */
export function addressUndeliverableMessage(opts: {
  methodIndex: number;
  content?: string;
  shippoMessages?: Array<{ text?: string | undefined }>;
}): MessageError {
  const detail = (opts.shippoMessages ?? [])
    .map((message) => message.text?.trim())
    .filter((text): text is string => Boolean(text))
    .join('; ');
  return {
    type: 'error',
    code: 'address_undeliverable',
    severity: 'recoverable',
    content: opts.content ?? (detail || 'No carrier can deliver to this address.'),
    path: `$.fulfillment.methods[${opts.methodIndex}].destinations[0]`,
  };
}

/**
 * The recoverable error a Business MUST return when it cannot accept a submitted
 * selected_destination_id on Update Checkout. UCP is explicit that the Business leaves the
 * Checkout unchanged and returns it with this message rather than substituting a destination the
 * buyer did not choose, so this is the companion to the SelectedDestinationUnknownError that
 * buildShippingMethod throws.
 *
 * `path` selects the attempted selection rather than the destination it names, which is the most
 * specific path applicable and is what distinguishes this from addressUndeliverableMessage.
 */
export function destinationRejectedMessage(opts: {
  methodIndex: number;
  destinationId: string;
  content?: string;
}): MessageError {
  return {
    type: 'error',
    code: 'address_undeliverable',
    severity: 'recoverable',
    content:
      opts.content ?? `We cannot ship to the selected address (${opts.destinationId}). Choose another one.`,
    path: `$.fulfillment.methods[${opts.methodIndex}].selected_destination_id`,
  };
}
