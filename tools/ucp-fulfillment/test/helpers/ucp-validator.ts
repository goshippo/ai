import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormatsDefault from 'ajv-formats';
import type { FormatsPlugin } from 'ajv-formats';
import type { ValidateFunction } from 'ajv';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// ajv and ajv-formats ship CJS output with an ESM-shaped .d.ts. Under this package's
// "module: NodeNext", tsc's CJS/ESM interop mistypes the default import as the whole module
// namespace even though it is callable at runtime; Ajv2020 is fixed by importing the named
// class export instead, and addFormats needs its declared type restored explicitly since
// ajv-formats has no equivalent named value export.
const addFormats = addFormatsDefault as unknown as FormatsPlugin;

const here = dirname(fileURLToPath(import.meta.url));
const SCHEMA_ROOT = join(here, '..', '..', 'schemas', 'ucp', '2026-08-25');

/** The eight UCP fulfillment_event types this library emits. Kept in step with FULFILLMENT_EVENT_TYPES. */
export const FULFILLMENT_EVENT_TYPE_VALUES = [
  'processing',
  'shipped',
  'in_transit',
  'delivered',
  'failed_attempt',
  'canceled',
  'undeliverable',
  'returned_to_sender',
] as const;

export const SCHEMA_IDS = {
  fulfillmentOption: 'https://ucp.dev/schemas/shopping/types/fulfillment_option.json',
  fulfillmentOptionBase: 'https://ucp.dev/schemas/shopping/types/fulfillment_option_base.json',
  fulfillmentEvent: 'https://ucp.dev/schemas/shopping/types/fulfillment_event.json',
  fulfillmentGroup: 'https://ucp.dev/schemas/shopping/types/fulfillment_group.json',
  fulfillmentMethod: 'https://ucp.dev/schemas/shopping/types/fulfillment_method.json',
  shippingDestination: 'https://ucp.dev/schemas/shopping/types/shipping_destination.json',
  expectation: 'https://ucp.dev/schemas/shopping/types/expectation.json',
  order: 'https://ucp.dev/schemas/shopping/order.json',
  message: 'https://ucp.dev/schemas/common/types/message.json',
  messageError: 'https://ucp.dev/schemas/common/types/message_error.json',
  // A $defs fragment rather than a file of its own, which is why it needs the {$ref} wrapper path
  // through validateUcp. It is what catalogShippingMethod must satisfy.
  catalogFulfillmentMethod:
    'https://ucp.dev/schemas/shopping/fulfillment.json#/$defs/catalog_fulfillment_method',
  capabilityBusiness: 'https://ucp.dev/schemas/capability.json#/$defs/business_schema',
  strictFulfillmentEvent: 'https://shippo.local/strict/fulfillment_event.json',
} as const;

/**
 * The vendored fulfillment_event schema leaves three rules in prose: the event type vocabulary
 * lives in a description, line_items has no minItems, and "required if type != processing" for
 * tracking_number and tracking_url is a sentence rather than an if/then. This overlay makes all
 * three machine checkable for objects WE produce. It is additive and strictly narrower than the
 * vendored schema, so anything it rejects the spec text also rejects. The vendored files are
 * never edited.
 */
export const STRICT_FULFILLMENT_EVENT = {
  $id: SCHEMA_IDS.strictFulfillmentEvent,
  allOf: [
    { $ref: SCHEMA_IDS.fulfillmentEvent },
    {
      type: 'object',
      properties: {
        type: { enum: [...FULFILLMENT_EVENT_TYPE_VALUES] },
        line_items: { minItems: 1 },
      },
      allOf: [
        {
          if: { properties: { type: { not: { const: 'processing' } } }, required: ['type'] },
          then: { required: ['tracking_number', 'tracking_url'] },
        },
      ],
    },
  ],
};

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (name.endsWith('.json')) out.push(full);
  }
  return out;
}

const schemasById = new Map<string, Record<string, unknown>>();
let ajv: Ajv2020 | undefined;

function instance(): Ajv2020 {
  if (ajv) return ajv;
  const a = new Ajv2020({ strict: false, allErrors: true, allowUnionTypes: true });
  addFormats(a);
  for (const file of walk(SCHEMA_ROOT)) {
    const schema = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    if (typeof schema.$id === 'string') {
      a.addSchema(schema, schema.$id);
      schemasById.set(schema.$id, schema);
    }
  }
  a.addSchema(STRICT_FULFILLMENT_EVENT, STRICT_FULFILLMENT_EVENT.$id);
  schemasById.set(STRICT_FULFILLMENT_EVENT.$id, STRICT_FULFILLMENT_EVENT as Record<string, unknown>);
  ajv = a;
  return a;
}

const validators = new Map<string, ValidateFunction>();

/** Throws with the full Ajv error list when `value` does not satisfy the schema at `schemaId`. */
export function validateUcp(schemaId: string, value: unknown): void {
  const a = instance();
  let validate = validators.get(schemaId);
  if (!validate) {
    // getSchema resolves plain $ids; a fragment ref (capability.json#/$defs/x) is compiled
    // through a $ref wrapper. Both are cached, so a fragment is compiled at most once.
    validate = a.getSchema(schemaId) ?? a.compile({ $ref: schemaId });
    validators.set(schemaId, validate);
  }
  if (!validate(value)) {
    throw new Error(`UCP schema violation (${schemaId}):\n${JSON.stringify(validate.errors, null, 2)}`);
  }
}

function pointer(doc: unknown, fragment: string): unknown {
  let node: unknown = doc;
  for (const raw of fragment.split('/').slice(1)) {
    if (!node || typeof node !== 'object') return undefined;
    const key = raw.replace(/~1/g, '/').replace(/~0/g, '~');
    node = (node as Record<string, unknown>)[key];
  }
  return node;
}

function collectKeys(node: unknown, baseId: string, out: Set<string>, seen: Set<string>): void {
  if (!node || typeof node !== 'object') return;
  const schema = node as Record<string, unknown>;
  const id = typeof schema.$id === 'string' ? schema.$id : baseId;
  if (typeof schema.$ref === 'string') {
    const absolute = new URL(schema.$ref, id).href;
    if (!seen.has(absolute)) {
      seen.add(absolute);
      const [docId, fragment] = absolute.split('#');
      const doc = schemasById.get(docId);
      collectKeys(fragment ? pointer(doc, `#${fragment}`) : doc, docId, out, seen);
    }
  }
  for (const key of Object.keys((schema.properties ?? {}) as Record<string, unknown>)) out.add(key);
  for (const branch of ['allOf', 'anyOf', 'oneOf'] as const) {
    const list = schema[branch];
    if (Array.isArray(list)) for (const sub of list) collectKeys(sub, id, out, seen);
  }
  for (const branch of ['then', 'else'] as const) collectKeys(schema[branch], id, out, seen);
}

const knownKeys = new Map<string, Set<string>>();

/**
 * The UCP schemas are open (additionalProperties: true in 54 places), so Ajv cannot catch a
 * misspelled field in an object WE produce: a typo is a legal extension property. This closes
 * the world for the library's own output only. It walks $ref, allOf, anyOf, oneOf, then and
 * else to collect every key the schema names, then rejects anything else. Never call it on a
 * merchant-supplied object, which may legitimately carry extensions.
 */
export function assertOnlyKnownKeys(schemaId: string, value: Record<string, unknown>): void {
  instance();
  let known = knownKeys.get(schemaId);
  if (!known) {
    known = new Set<string>();
    const [docId, fragment] = schemaId.split('#');
    const doc = schemasById.get(docId);
    collectKeys(fragment ? pointer(doc, `#${fragment}`) : doc, docId, known, new Set([schemaId]));
    knownKeys.set(schemaId, known);
  }
  const unknown = Object.keys(value).filter((key) => !known.has(key));
  if (unknown.length) {
    throw new Error(
      `Unknown key(s) for ${schemaId}: ${unknown.join(', ')}. ` +
        `Misspelled? The schema names: ${[...known].sort().join(', ')}`,
    );
  }
}
