/**
 * The dependency-free entry: everything except the Shippo SDK client. Import this when you only
 * need the mapping and the webhook builders, and you will pull in no third-party modules at all.
 * Task 10 replaces this file with the full public surface.
 */
export const PACKAGE_NAME = '@shippo/ucp-fulfillment';
export * from './errors.js';
