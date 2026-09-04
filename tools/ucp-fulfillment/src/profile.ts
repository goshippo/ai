export const UCP_VERSION = '2026-08-25';

export interface CapabilityEntry {
  version: string;
  spec: string;
  schema: string;
  /**
   * Parent capability or capabilities this extension adds fulfillment to. capability.json allows
   * a single reverse-domain name or a non-empty array of them.
   */
  extends?: string | string[];
}

export interface UcpCapabilities {
  'dev.ucp.shopping.fulfillment': CapabilityEntry[];
  'dev.ucp.shopping.order': CapabilityEntry[];
}

export interface UcpCapabilityOptions {
  version?: string;
  /**
   * Set when the merchant also surfaces fulfillment on catalog search and lookup, which is what
   * buildCatalogPreviewOptions and catalogShippingMethod produce. Left off by default: a Platform
   * negotiates by exact capability, so advertising catalog fulfillment a merchant does not serve
   * is worse than not advertising it.
   */
  exposeCatalog?: boolean;
}

/**
 * The capability entries a merchant merges into `ucp.capabilities` of its /.well-known/ucp
 * profile to advertise Shippo-backed fulfillment options and order events. The checkout
 * capability itself stays the merchant's.
 *
 * Omitting a fulfillment `config` is meaningful and is the right default for this spike: the
 * extension's multi_destination rules read a listed method as permitted and an omitted one as not
 * offered, so a config-less profile means single-destination shipping.
 */
export function ucpCapabilities(opts: UcpCapabilityOptions = {}): UcpCapabilities {
  const version = opts.version ?? UCP_VERSION;
  const base = `https://ucp.dev/${version}`;
  return {
    'dev.ucp.shopping.fulfillment': [
      {
        version,
        spec: `${base}/specification/shopping/extensions/fulfillment`,
        schema: `${base}/schemas/shopping/fulfillment.json`,
        extends: opts.exposeCatalog
          ? ['dev.ucp.shopping.checkout', 'dev.ucp.shopping.catalog.search', 'dev.ucp.shopping.catalog.lookup']
          : 'dev.ucp.shopping.checkout',
      },
    ],
    'dev.ucp.shopping.order': [
      {
        version,
        spec: `${base}/specification/shopping/order`,
        schema: `${base}/schemas/shopping/order.json`,
      },
    ],
  };
}

export interface OrderResponseUcp {
  version: string;
  capabilities: Record<string, Array<{ version: string }>>;
}

/**
 * The `ucp` envelope a business puts on an order response and on every order event webhook.
 * order.json requires only `version`, so a bare version is schema valid, but UCP expects the
 * active capability set to be confirmed in every response so a Platform always knows what is
 * live for the interaction. A Platform that keys behaviour off confirmed capabilities would
 * otherwise treat the order as capability-less.
 */
export function orderResponseUcp(opts: { version?: string } = {}): OrderResponseUcp {
  const version = opts.version ?? UCP_VERSION;
  return {
    version,
    capabilities: {
      'dev.ucp.shopping.order': [{ version }],
      'dev.ucp.shopping.fulfillment': [{ version }],
    },
  };
}
