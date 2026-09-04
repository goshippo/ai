/**
 * The full entry: the dependency-free core plus the Shippo SDK client. Importing this pulls in
 * the `shippo` package, which is an optional peer dependency. If you only need the mapping and
 * the webhook builders, import `@shippo/ucp-fulfillment/core` instead.
 */
export * from './core.js';
export {
  createShippoClient,
  type ShippoClient,
  type ShippoClientOptions,
  type ShippoSdkLike,
} from './shippo-client.js';
