/* eslint-disable */
/**
 * Generated from the UCP 2026-08-25 JSON schemas by scripts/gen-types.ts.
 * Do not edit by hand. Re-run: npm run gen:types
 */

/**
 * A fulfillment option within a group (e.g., Standard Shipping $5, Express $15). Extends the fulfillment option base with cost and timing.
 */
export type FulfillmentOption = FulfillmentOptionBase & {
  /**
   * Carrier name (for shipping).
   */
  carrier?: string;
  /**
   * Earliest fulfillment date.
   */
  earliest_fulfillment_time?: string;
  /**
   * Latest fulfillment date.
   */
  latest_fulfillment_time?: string;
  /**
   * Fulfillment option totals breakdown.
   */
  totals: Total[];
  [k: string]: unknown;
};
/**
 * A cost breakdown entry with a category, amount, and optional display text.
 */
export type Total = {
  /**
   * Cost category. Well-known values: subtotal, items_discount, discount, fulfillment, tax, fee, total. Businesses MAY use additional values.
   */
  type: string;
  /**
   * Text to display against the amount. Should reflect appropriate method (e.g., 'Shipping', 'Delivery').
   */
  display_text?: string;
  amount: SignedAmount;
  [k: string]: unknown;
};
/**
 * Monetary amount in the currency's minor unit as defined by ISO 4217. Refer to the currency's exponent to determine minor-to-major ratio (e.g., 2 for USD, 0 for JPY, 3 for KWD). May be negative — the sign is intrinsic to the value (e.g., discounts are negative, charges are positive).
 */
export type SignedAmount = number;
/**
 * A fulfillment method with destinations and groups.
 */
export type FulfillmentMethod = {
  /**
   * Unique fulfillment method identifier.
   */
  id: string;
  /**
   * Fulfillment method type. Well-known values: `shipping`, `pickup`. Businesses MAY use additional values.
   */
  type: string;
  /**
   * Line item IDs fulfilled via this method.
   */
  line_item_ids: string[];
  /**
   * Available destinations for this method. In Business responses, each destination carries a `type` and `id`.
   */
  destinations?: FulfillmentDestination[];
  /**
   * ID of the selected destination. Accepts any stable, Business-scoped ID the Business recognizes for this method, including Location IDs not yet enumerated in `destinations`.
   */
  selected_destination_id?: string | null;
  /**
   * Fulfillment groups for selecting options. Agent sets selected_option_id on groups to choose shipping method.
   */
  groups?: FulfillmentGroup[];
  [k: string]: unknown;
};
/**
 * A destination for fulfillment.
 */
export type FulfillmentDestination = {
  /**
   * Destination contract discriminator. Required in Business responses and optional in Platform requests. Well-known values: `shipping_address`, `business_location`. The enclosing method contract defines request defaults and which fields the Platform may write; negotiated extensions define additional values.
   */
  type: string;
  /**
   * Fulfillment destination identifier.
   */
  id: string;
  [k: string]: unknown;
};
/**
 * UCP metadata for order responses. No payment handlers needed post-purchase.
 */
export type UCPOrderResponseSchema = Base & {
  capabilities?: {
    [k: string]: CapabilityResponseSchema[];
  };
  [k: string]: unknown;
};
/**
 * Reverse-domain identifier used for collision-safe namespacing of capabilities, services, handlers, eligibility claims, and extension-contributed keys. Must contain at least two dot-separated segments (e.g., 'dev.ucp.shopping.checkout', 'com.example.loyalty_gold'). Segments after the first are domain- or identifier-derived: they may contain interior hyphens, may start with a digit, and may contain underscores (e.g., 'com.example-shop.checkout', 'com.2example.cart', 'dev.ucp.common.identity_linking'), but must not start or end with a hyphen. The first segment (the reversed top-level domain) is letters and digits, and may contain interior hyphens to support internationalized (punycode) top-level domains such as 'xn--p1ai'.
 */
export type ReverseDomainName = string;
/**
 * A Value Constraint containing `enum`, `const`, or both.
 */
export type ValueConstraint = (
  | {
      [k: string]: unknown;
    }
  | {
      [k: string]: unknown;
    }
) & {
  /**
   * A non-empty array of unique JSON values.
   *
   * @minItems 1
   */
  enum?: [unknown, ...unknown[]];
  const?: unknown;
};
/**
 * Capability reference in responses. Only name/version required to confirm active capabilities.
 */
export type CapabilityResponseSchema = Entity & {
  /**
   * Parent capability(s) this extends. Present for extensions, absent for root capabilities. Use array for multi-parent extensions.
   */
  extends?: ReverseDomainName | [ReverseDomainName, ...ReverseDomainName[]];
  [k: string]: unknown;
};
/**
 * Unit price in ISO 4217 minor units. Price is the amount per one whole `quantity_unit.unit` (for example, per lb or per hour); when `quantity_unit` is absent, it is per `each`.
 */
export type Amount = number;
/**
 * Sale basis this item's `quantity` is denominated in. On an authoritative Business response, absence encodes the default `each` machine identity (`C62`, 0); the Business MUST include this descriptor for every non-`each` response. On Platform requests, omission makes no assertion: the Business interprets `quantity` using the item's authoritative sale basis. If the Platform includes this descriptor, it asserts the unit-descriptor machine identity. The Business MUST compare that machine identity (`unit`, effective `scale`), ignore `display_text` and `increment`, and resolve a mismatch by conversion surfaced as a visible line revision with a warning, or by rejection with a recoverable business outcome; silent reinterpretation is forbidden. An explicit `C62` descriptor at effective scale 0 matches an authoritative basis represented by an absent descriptor.
 */
export type QuantityUnit = Unit & {
  /**
   * Ordering granularity, denominated in steps: the Business sells this item in integer multiples of `increment` steps. Its effective value is the provided value or 1. Advisory merchandising policy, not a representational bound: Platform-authored quantities SHOULD be integer multiples of the effective increment; the Business MAY accept, revise, or reject an off-increment request with a recoverable business outcome and MUST NOT silently reinterpret it. Business-authored quantities (checkout revisions, fulfillment events, adjustments) are bounded only by `scale`.
   */
  increment?: number;
  [k: string]: unknown;
};
/**
 * A reusable unit descriptor for quantities and measures. Its unit-descriptor machine identity is (`unit`, effective `scale`), where effective `scale` is the provided `scale` or 0; `display_text` is excluded.
 */
export type Unit = {
  /**
   * Stable machine identifier. The Business SHOULD use the exact UN/CEFACT Rec20 Common Code when one accurately identifies the unit. Otherwise, the Business MAY use a custom unit identifier and MUST use it consistently for the same unit. The Platform MUST treat an unrecognized identifier as opaque.
   */
  unit: string;
  /**
   * One step equals `10^-scale` of `unit`. When `unit` is `C62`, `scale`, if present, MUST be 0. The maximum of 15 is derived from the interoperable integer range: at scale 16 a single whole unit (10^16 steps) is no longer representable, so larger scales cannot denominate one unit of their own basis. Businesses needing finer granularity use a smaller unit.
   */
  scale?: number;
  /**
   * Required printable unit label provided by the Business. The Platform MUST use it when it does not recognize `unit`; for a recognized UN/CEFACT Rec 20 Common Code, the Platform MAY substitute its own localized label. It does not participate in unit identity or mismatch comparison.
   */
  display_text: string;
  [k: string]: unknown;
};
/**
 * Unit price in ISO 4217 minor units. After satisfying the same-unit invariant, the Business MUST compute the comparator as `(price.amount / (measure.value × 10^-measure.scale)) × (reference.value × 10^-reference.scale)` and round it once to ISO 4217 minor units according to its pricing rules. The returned `unit_price.amount` is authoritative; the Platform MUST NOT recompute or substitute its own result.
 */
export type Amount1 = number;
/**
 * A measure composed of an integer value and a unit descriptor. Its value is the integer count of `10^-scale` units of `unit`.
 */
export type Measure = Unit & {
  /**
   * Integer count of `10^-scale` units of `unit`.
   */
  value: number;
  [k: string]: unknown;
};
/**
 * A measure composed of an integer value and a unit descriptor. Its value is the integer count of `10^-scale` units of `unit`.
 */
export type Measure1 = Unit & {
  /**
   * Integer count of `10^-scale` units of `unit`.
   */
  value: number;
  [k: string]: unknown;
};
/**
 * Different totals for the order.
 */
export type Totals = (Total & {
  /**
   * Optional itemized breakdown. The parent entry is always rendered; lines are supplementary. Sum of line amounts MUST equal the parent entry amount.
   *
   * Items: Sub-line entry. Additional metadata MAY be included.
   */
  lines?: {
    /**
     * Human-readable label for this sub-line.
     */
    display_text: string;
    amount: SignedAmount1;
    [k: string]: unknown;
  }[];
  [k: string]: unknown;
})[];
/**
 * Monetary amount in the currency's minor unit as defined by ISO 4217. Refer to the currency's exponent to determine minor-to-major ratio (e.g., 2 for USD, 0 for JPY, 3 for KWD). May be negative — the sign is intrinsic to the value (e.g., discounts are negative, charges are positive).
 */
export type SignedAmount1 = number;
/**
 * Reverse-domain identifier used for collision-safe namespacing of capabilities, services, handlers, eligibility claims, and extension-contributed keys. Must contain at least two dot-separated segments (e.g., 'dev.ucp.shopping.checkout', 'com.example.loyalty_gold'). Segments after the first are domain- or identifier-derived: they may contain interior hyphens, may start with a digit, and may contain underscores (e.g., 'com.example-shop.checkout', 'com.2example.cart', 'dev.ucp.common.identity_linking'), but must not start or end with a hyphen. The first segment (the reversed top-level domain) is letters and digits, and may contain interior hyphens to support internationalized (punycode) top-level domains such as 'xn--p1ai'.
 */
export type ReverseDomainName1 = string;
/**
 * Container for error, warning, or info messages.
 */
export type Message = MessageError | MessageWarning | MessageInfo;
/**
 * Error code identifying the type of error. Standard errors are defined in capability specifications (see examples) and have standardized semantics; freeform codes are permitted.
 */
export type ErrorCode = string;
/**
 * Warning code identifying the type of warning. Standard codes are defined in capability specifications (see examples) and have standardized semantics; freeform codes are permitted.
 */
export type WarningCode = string;
/**
 * Info code identifying the type of informational message. Standard codes are defined in capability specifications (see examples) and have standardized semantics; freeform codes are permitted.
 */
export type InfoCode = string;

/**
 * Synthetic root used only to generate TypeScript types for the schemas this library produces or consumes.
 */
export interface UCPEntry {
  fulfillment_option?: FulfillmentOption;
  fulfillment_event?: FulfillmentEvent;
  fulfillment_group?: FulfillmentGroup;
  fulfillment_method?: FulfillmentMethod;
  expectation?: Expectation;
  order?: Order;
  [k: string]: unknown;
}
/**
 * Common base for a fulfillment option: an addressable, renderable choice (e.g. Standard, Express). Catalog uses this base directly; checkout composes it with cost and timing.
 */
export interface FulfillmentOptionBase {
  /**
   * Unique identifier for this fulfillment option.
   */
  id: string;
  /**
   * Short label that distinguishes this option from its siblings (e.g. 'Standard', 'Express Shipping', 'Curbside Pickup').
   */
  title: string;
  description?: Description;
  [k: string]: unknown;
}
/**
 * Supplementary context for the title (e.g. 'Arrives in 4 business days', 'Arrives Dec 12-15 via FedEx'). Directly renderable; MUST NOT repeat the title.
 */
export interface Description {
  /**
   * Plain text content.
   */
  plain?: string;
  /**
   * HTML-formatted content. Security: Platforms MUST sanitize before rendering—strip scripts, event handlers, and untrusted elements. Treat all rich text as untrusted input.
   */
  html?: string;
  /**
   * Markdown-formatted content.
   */
  markdown?: string;
  [k: string]: unknown;
}
/**
 * Append-only fulfillment event representing an actual shipment. References line items by ID.
 */
export interface FulfillmentEvent {
  /**
   * Fulfillment event identifier.
   */
  id: string;
  /**
   * RFC 3339 timestamp when this fulfillment event occurred.
   */
  occurred_at: string;
  /**
   * Fulfillment event type. Common values include: processing (preparing to ship), shipped (handed to carrier), in_transit (in delivery network), delivered (received by buyer), failed_attempt (delivery attempt failed), canceled (fulfillment canceled), undeliverable (cannot be delivered), returned_to_sender (returned to merchant).
   */
  type: string;
  /**
   * Which line items and quantities are fulfilled in this event.
   */
  line_items: {
    /**
     * Line item ID reference.
     */
    id: string;
    /**
     * Integer count of steps of the referenced line item's `quantity_unit` (`10^-scale` × `unit`); when `quantity_unit` is absent, it counts whole items (`each`).
     */
    quantity: number;
    [k: string]: unknown;
  }[];
  /**
   * Carrier tracking number (required if type != processing).
   */
  tracking_number?: string;
  /**
   * URL to track this shipment (required if type != processing).
   */
  tracking_url?: string;
  /**
   * Carrier name (e.g., 'FedEx', 'USPS').
   */
  carrier?: string;
  /**
   * Human-readable description of the shipment status or delivery information (e.g., 'Delivered to front door', 'Out for delivery').
   */
  description?: string;
  [k: string]: unknown;
}
/**
 * A merchant-generated package/group of line items with fulfillment options.
 */
export interface FulfillmentGroup {
  /**
   * Group identifier for referencing merchant-generated groups in updates.
   */
  id: string;
  /**
   * Line item IDs included in this group/package.
   */
  line_item_ids: string[];
  /**
   * Available fulfillment options for this group.
   */
  options?: FulfillmentOption[];
  /**
   * ID of the selected fulfillment option for this group.
   */
  selected_option_id?: string | null;
  [k: string]: unknown;
}
/**
 * Buyer-facing fulfillment expectation representing logical groupings of items (e.g., 'package'). Can be split, merged, or adjusted post-order to set buyer expectations for when/how items arrive.
 */
export interface Expectation {
  /**
   * Expectation identifier.
   */
  id: string;
  /**
   * Which line items and quantities are in this expectation.
   */
  line_items: {
    /**
     * Line item ID reference.
     */
    id: string;
    /**
     * Integer count of steps of the referenced line item's `quantity_unit` (`10^-scale` × `unit`); when `quantity_unit` is absent, it counts whole items (`each`).
     */
    quantity: number;
    [k: string]: unknown;
  }[];
  /**
   * Delivery method type. Well-known values: `shipping`, `pickup`, `digital`; additional values MAY be used.
   */
  method_type: string;
  destination: PostalAddress;
  /**
   * Human-readable delivery description (e.g., 'Arrives in 5-8 business days').
   */
  description?: string;
  /**
   * When this expectation can be fulfilled: 'now' or ISO 8601 timestamp for future date (backorder, pre-order).
   */
  fulfillable_on?: string;
  [k: string]: unknown;
}
/**
 * Delivery destination address.
 */
export interface PostalAddress {
  /**
   * An address extension such as an apartment number, C/O or alternative name.
   */
  extended_address?: string;
  /**
   * The street address.
   */
  street_address?: string;
  /**
   * The locality in which the street address is, and which is in the region. For example, Mountain View.
   */
  address_locality?: string;
  /**
   * The region in which the locality is, and which is in the country. Required for applicable countries (i.e. state in US, province in CA). For example, California or another appropriate first-level Administrative division.
   */
  address_region?: string;
  /**
   * The country. Recommended to be in 2-letter ISO 3166-1 alpha-2 format, for example "US". For backward compatibility, a 3-letter ISO 3166-1 alpha-3 country code such as "SGP" or a full country name such as "Singapore" can also be used.
   */
  address_country?: string;
  /**
   * The postal code. For example, 94043.
   */
  postal_code?: string;
  /**
   * Optional. First name of the contact associated with the address.
   */
  first_name?: string;
  /**
   * Optional. Last name of the contact associated with the address.
   */
  last_name?: string;
  /**
   * Optional. Phone number of the contact associated with the address.
   */
  phone_number?: string;
  [k: string]: unknown;
}
/**
 * Order schema with line items, buyer-facing fulfillment expectations, and event logs.
 */
export interface Order {
  ucp: UCPOrderResponseSchema;
  /**
   * Unique order identifier.
   */
  id: string;
  /**
   * Human-readable label for identifying the order. MUST only be provided by the business.
   */
  label?: string;
  /**
   * Associated checkout ID for reconciliation.
   */
  checkout_id: string;
  /**
   * Permalink to access the order on merchant site.
   */
  permalink_url: string;
  /**
   * Line items representing what was purchased — can change post-order via edits or exchanges.
   */
  line_items: OrderLineItem[];
  /**
   * Fulfillment data: buyer expectations and what actually happened.
   */
  fulfillment: {
    /**
     * Buyer-facing groups representing when/how items will be delivered. Can be split, merged, or adjusted post-order.
     */
    expectations?: Expectation[];
    /**
     * Append-only event log of actual shipments. Each event references line items by ID.
     */
    events?: FulfillmentEvent[];
    [k: string]: unknown;
  };
  /**
   * Post-order events (refunds, returns, credits, disputes, cancellations, etc.) that exist independently of fulfillment.
   */
  adjustments?: Adjustment[];
  /**
   * ISO 4217 currency code. MUST match the currency from the originating checkout session.
   */
  currency: string;
  totals: Totals;
  /**
   * Snapshot of the policies that applied to the items at checkout, captured on the order as a durable record. `applies_to` targets are relative to the response root.
   */
  policies?: Policy[];
  /**
   * Business outcome messages (errors, warnings, informational). Present when the business needs to communicate status or issues to the platform.
   */
  messages?: Message[];
  attribution?: Attribution;
  [k: string]: unknown;
}
/**
 * Base UCP metadata with shared properties for all schema types.
 */
export interface Base {
  /**
   * Version identifier in YYYY-MM-DD format.
   */
  version: string;
  map_order?: MapOrder;
  /**
   * Application-level status of the UCP operation.
   */
  status?: "success" | "error";
  /**
   * Service registry keyed by reverse-domain name.
   */
  services?: {
    [k: string]: (Entity & {
      /**
       * Transport protocol for this service binding.
       */
      transport: "rest" | "mcp" | "a2a" | "embedded";
      /**
       * Endpoint URL for this transport binding.
       */
      endpoint?: string;
      [k: string]: unknown;
    })[];
  };
  /**
   * Capability registry keyed by reverse-domain name.
   */
  capabilities?: {
    [k: string]: (Entity & {
      /**
       * Parent capability(s) this extends. Present for extensions, absent for root capabilities. Use array for multi-parent extensions.
       */
      extends?: ReverseDomainName | [ReverseDomainName, ...ReverseDomainName[]];
      [k: string]: unknown;
    })[];
  };
  /**
   * Payment handler registry keyed by reverse-domain name.
   */
  payment_handlers?: {
    [k: string]: (Entity & {
      [k: string]: unknown;
    } & {
      /**
       * Instrument types this handler supports, with optional constraints. When absent, every instrument should be considered available.
       *
       * @minItems 1
       */
      available_instruments?: [AvailablePaymentInstrument, ...AvailablePaymentInstrument[]];
      [k: string]: unknown;
    })[];
  };
  [k: string]: unknown;
}
/**
 * Preferred key-traversal order for sibling registry fields inside the root `ucp` envelope (`services`, `capabilities`, and `payment_handlers`).
 */
export interface MapOrder {
  [k: string]: string[];
}
/**
 * Shared foundation for all UCP entities.
 */
export interface Entity {
  /**
   * Version identifier in YYYY-MM-DD format.
   */
  version: string;
  /**
   * URL to human-readable specification document.
   */
  spec?: string;
  /**
   * URL to JSON Schema defining this entity's structure and payloads.
   */
  schema?: string;
  /**
   * Unique identifier for this entity instance. Used to disambiguate when multiple instances exist.
   */
  id?: string;
  /**
   * Entity-specific configuration. Structure defined by each entity's schema.
   */
  config?: {
    [k: string]: unknown;
  };
  [k: string]: unknown;
}
/**
 * An instrument type available from a payment handler with optional constraints.
 */
export interface AvailablePaymentInstrument {
  /**
   * The instrument type identifier (e.g., 'card', 'gift_card'). References an instrument schema's type constant.
   */
  type: string;
  constraints?: ConstraintExpression;
  [k: string]: unknown;
}
/**
 * A Constraint Expression describing the instrument this entry makes available. Keys in `properties` name members of the `constraint_target` declared by the instrument schema for this `type`. Requirements on submitted request data belong in `ucp.request_constraints` instead.
 */
export interface ConstraintExpression {
  /**
   * Property names required by the constrained object. Must be non-empty: an empty array applies no constraint.
   *
   * @minItems 1
   */
  required?: [string, ...string[]];
  /**
   * Constraints keyed by property name. Must be non-empty: an empty object applies no constraint.
   */
  properties?: {
    [k: string]: ConstraintExpression1 | ValueConstraint;
  };
  /**
   * Alternative Object Constraints. The constrained object must satisfy at least one. A branch must be non-empty: an empty branch is satisfied by every object and neutralizes the alternation.
   *
   * @minItems 1
   */
  anyOf?: [ConstraintExpression2, ...ConstraintExpression2[]];
}
/**
 * A closed JSON Schema Draft 2020-12 constraint expression with Object and Value Constraint positions.
 */
export interface ConstraintExpression1 {
  /**
   * Property names required by the constrained object. Must be non-empty: an empty array applies no constraint.
   *
   * @minItems 1
   */
  required?: [string, ...string[]];
  /**
   * Constraints keyed by property name. Must be non-empty: an empty object applies no constraint.
   */
  properties?: {
    [k: string]: ConstraintExpression1 | ValueConstraint;
  };
  /**
   * Alternative Object Constraints. The constrained object must satisfy at least one. A branch must be non-empty: an empty branch is satisfied by every object and neutralizes the alternation.
   *
   * @minItems 1
   */
  anyOf?: [ConstraintExpression2, ...ConstraintExpression2[]];
}
/**
 * A closed JSON Schema Draft 2020-12 constraint expression with Object and Value Constraint positions.
 */
export interface ConstraintExpression2 {
  /**
   * Property names required by the constrained object. Must be non-empty: an empty array applies no constraint.
   *
   * @minItems 1
   */
  required?: [string, ...string[]];
  /**
   * Constraints keyed by property name. Must be non-empty: an empty object applies no constraint.
   */
  properties?: {
    [k: string]: ConstraintExpression1 | ValueConstraint;
  };
  /**
   * Alternative Object Constraints. The constrained object must satisfy at least one. A branch must be non-empty: an empty branch is satisfied by every object and neutralizes the alternation.
   *
   * @minItems 1
   */
  anyOf?: [ConstraintExpression2, ...ConstraintExpression2[]];
}
export interface OrderLineItem {
  /**
   * Line item identifier.
   */
  id: string;
  item: Item;
  /**
   * Tracks the line item's original, current active, and fulfilled quantities. All three values use the same inherited `item.quantity_unit`. When `item.quantity_unit` is absent on an authoritative order response, each step is one whole item (`each`) under the shared default.
   */
  quantity: {
    /**
     * Quantity from the original checkout, expressed as an integer step count.
     */
    original?: number;
    /**
     * Current active quantity after returns, cancellations, or other order changes, expressed as an integer step count.
     */
    total: number;
    /**
     * Quantity fulfilled so far, expressed as an integer step count.
     */
    fulfilled: number;
    [k: string]: unknown;
  };
  /**
   * Line item totals breakdown.
   */
  totals: Total[];
  /**
   * Derived status: removed if quantity.total == 0, fulfilled if quantity.total > 0 and quantity.fulfilled == quantity.total, partial if quantity.total > 0 and quantity.fulfilled > 0, otherwise processing.
   */
  status: "processing" | "partial" | "fulfilled" | "removed";
  /**
   * Parent line item identifier for any nested structures.
   */
  parent_id?: string;
  [k: string]: unknown;
}
/**
 * Purchased item data, including identity, price, and sale basis.
 */
export interface Item {
  /**
   * The product identifier, often the SKU, required to resolve the product details associated with this line item. Should be recognized by both the Platform, and the Business.
   */
  id: string;
  /**
   * Product title.
   */
  title: string;
  price: Amount;
  quantity_unit?: QuantityUnit;
  unit_price?: UnitPrice;
  /**
   * Product image URI.
   */
  image_url?: string;
  [k: string]: unknown;
}
/**
 * Pricing basis for this item. On an authoritative Business response, the Business MUST include `unit_price` on every line whose pricing basis differs from its sale basis (for example, priced per pound but sold per `each`); presence on a line marks the rate as transactional rather than display-only. When the pricing basis is the sale basis, `item.price` fully denominates the charge and this field MAY be omitted.
 */
export interface UnitPrice {
  amount: Amount1;
  /**
   * ISO 4217 currency code.
   */
  currency: string;
  /**
   * Product quantity in packaging/content (for example, a 750 mL bottle), distinct from `quantity_unit`, which defines the sale basis. Its integer `value` MUST be at least 1.
   */
  measure: Measure & {
    value?: {
      [k: string]: unknown;
    };
    [k: string]: unknown;
  };
  /**
   * Denominator for unit price display (for example, per 100 mL or per 1 kg). Its integer `value` MUST be at least 1.
   */
  reference: Measure & {
    value?: {
      [k: string]: unknown;
    };
    [k: string]: unknown;
  };
  [k: string]: unknown;
}
/**
 * Post-order event that exists independently of fulfillment. Typically represents money movements but can be any post-order change. Polymorphic type that can optionally reference line items.
 */
export interface Adjustment {
  /**
   * Adjustment event identifier.
   */
  id: string;
  /**
   * Type of adjustment (open string). Typically money-related like: refund, return, credit, price_adjustment, dispute, cancellation. Can be any value that makes sense for the merchant's business.
   */
  type: string;
  /**
   * RFC 3339 timestamp when this adjustment occurred.
   */
  occurred_at: string;
  /**
   * Adjustment status.
   */
  status: "pending" | "completed" | "failed";
  /**
   * Which line items and quantities are affected (optional).
   */
  line_items?: {
    /**
     * Line item ID reference.
     */
    id: string;
    /**
     * Signed integer count of steps of the referenced line item's `quantity_unit` (`10^-scale` × `unit`); when `quantity_unit` is absent, it counts whole items (`each`). Negative values represent reductions (e.g. returns); positive values represent additions (e.g. exchanges).
     */
    quantity: number;
    measure?: Measure1;
    [k: string]: unknown;
  }[];
  /**
   * Adjustment totals breakdown. Signed values - negative for money returned to buyer (refunds, credits), positive for additional charges (exchanges).
   */
  totals?: Total[];
  /**
   * Human-readable reason or description (e.g., 'Defective item', 'Customer requested').
   */
  description?: string;
  [k: string]: unknown;
}
/**
 * A durable business rule about the items in a response — return/refund terms, warranty, and the like — at the time of purchase. Every policy carries a `type` (an open reverse-DNS vocabulary) and a `description` so a platform can present it without understanding its type-specific fields; type-specific fields (gated by `type`) add structured context for platforms that model that type. Policies are reference data; the obligation to display a term to the buyer is carried by a `messages[]` warning whose `code` equals the policy `type` — see the Policies section of the specification.
 */
export interface Policy {
  type: ReverseDomainName1;
  description: Description1;
  /**
   * RFC 9535 JSONPath expressions identifying the nodes this policy applies to, relative to the embedding response root (e.g., `$.line_items[0]` in cart/checkout, `$.products[2]` in catalog). Each target covers the node it names and everything nested under it, so a target on a product also covers its variants. A singular query (RFC 9535 Section 2.3.5.1; name and index selectors only) names a single node; filters, wildcards, and slices match a set. When omitted, the policy applies to the entire response. When policies of the same `type` contest a node, the narrowest target wins and overrides the rest. See the Policies section for how specificity resolves.
   */
  applies_to?: string[];
  /**
   * Optional link to the full policy document.
   */
  url?: string;
  [k: string]: unknown;
}
/**
 * Human-readable policy summary in one or more formats (plain, markdown, html). Required on every policy so a platform can present it without understanding any type-specific fields. This is not the buyer-facing disclosure — display is compelled by a `messages[]` warning (see the Policies section).
 */
export interface Description1 {
  /**
   * Plain text content.
   */
  plain?: string;
  /**
   * HTML-formatted content. Security: Platforms MUST sanitize before rendering—strip scripts, event handlers, and untrusted elements. Treat all rich text as untrusted input.
   */
  html?: string;
  /**
   * Markdown-formatted content.
   */
  markdown?: string;
  [k: string]: unknown;
}
export interface MessageError {
  /**
   * Message type discriminator.
   */
  type: "error";
  code: ErrorCode;
  /**
   * RFC 9535 JSONPath to the component the message refers to (e.g., $.line_items[0]).
   */
  path?: string;
  /**
   * Content format, default = plain.
   */
  content_type?: "plain" | "markdown";
  /**
   * Human-readable message.
   */
  content: string;
  /**
   * Reflects the resource state and recommended action. 'recoverable': platform can resolve the condition in band, for example by modifying inputs or processing a related Action, and submit a new operation when needed. 'requires_buyer_input': merchant requires information their API doesn't support collecting programmatically (checkout incomplete). 'requires_buyer_review': buyer must authorize before order placement due to policy, regulatory, or entitlement rules. 'unrecoverable': no valid resource exists to act on, retry with new resource or inputs. Errors with 'requires_*' severity contribute to 'status: requires_escalation'.
   */
  severity: "recoverable" | "requires_buyer_input" | "requires_buyer_review" | "unrecoverable";
  [k: string]: unknown;
}
export interface MessageWarning {
  /**
   * Message type discriminator.
   */
  type: "warning";
  /**
   * RFC 9535 JSONPath to the component the message refers to (e.g., $.line_items[0]).
   */
  path?: string;
  code: WarningCode;
  /**
   * Human-readable warning message that MUST be displayed.
   */
  content: string;
  /**
   * Content format, default = plain.
   */
  content_type?: "plain" | "markdown";
  /**
   * Rendering contract for this warning. 'notice' (default): platform MUST display, MAY dismiss. 'disclosure': platform MUST display in proximity to the path-referenced component, MUST NOT hide or auto-dismiss. See specification for full contract.
   */
  presentation?: string;
  /**
   * URL to a required visual element (e.g., warning symbol, energy class label).
   */
  image_url?: string;
  /**
   * Reference URL for more information (e.g., regulatory site, registry entry, policy page).
   */
  url?: string;
  [k: string]: unknown;
}
export interface MessageInfo {
  /**
   * Message type discriminator.
   */
  type: "info";
  /**
   * RFC 9535 JSONPath to the component the message refers to (e.g., $.line_items[0]).
   */
  path?: string;
  code?: InfoCode;
  /**
   * Content format, default = plain.
   */
  content_type?: "plain" | "markdown";
  /**
   * Human-readable message.
   */
  content: string;
  [k: string]: unknown;
}
/**
 * Snapshot of the attribution associated with the originating checkout. Read-only on the order.
 */
export interface Attribution {
  /**
   * URL-style parameter value, encoded as a string. Numeric or boolean values MUST be string-encoded as they would be in a URL query string.
   */
  [k: string]: string;
}
