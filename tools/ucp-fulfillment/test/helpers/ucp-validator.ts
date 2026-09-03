import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormatsDefault from 'ajv-formats';
import type { FormatsPlugin } from 'ajv-formats';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// ajv and ajv-formats ship CJS output with an ESM-shaped .d.ts. Under this
// package's "module: NodeNext", tsc's CJS/ESM interop mistypes the default
// import as the whole module namespace even though it is callable at
// runtime (proven by the test run); Ajv2020 is fixed above by importing the
// named class export instead, and addFormats needs its declared type
// restored explicitly since ajv-formats has no equivalent named value export.
const addFormats = addFormatsDefault as unknown as FormatsPlugin;

const here = dirname(fileURLToPath(import.meta.url));
const SCHEMA_ROOT = join(here, '..', '..', 'schemas', 'ucp', '2026-08-25');

export const SCHEMA_IDS = {
  fulfillmentOption: 'https://ucp.dev/schemas/shopping/types/fulfillment_option.json',
  fulfillmentOptionBase: 'https://ucp.dev/schemas/shopping/types/fulfillment_option_base.json',
  fulfillmentEvent: 'https://ucp.dev/schemas/shopping/types/fulfillment_event.json',
  fulfillmentGroup: 'https://ucp.dev/schemas/shopping/types/fulfillment_group.json',
  capabilityBusiness: 'https://ucp.dev/schemas/capability.json#/$defs/business_schema',
} as const;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (name.endsWith('.json')) out.push(full);
  }
  return out;
}

let ajv: Ajv2020 | undefined;

function instance(): Ajv2020 {
  if (ajv) return ajv;
  const a = new Ajv2020({ strict: false, allErrors: true, allowUnionTypes: true });
  addFormats(a);
  for (const file of walk(SCHEMA_ROOT)) {
    const schema = JSON.parse(readFileSync(file, 'utf8'));
    if (typeof schema.$id === 'string') a.addSchema(schema, schema.$id);
  }
  ajv = a;
  return a;
}

export function validateUcp(schemaId: string, value: unknown): void {
  const ajv = instance();
  // getSchema resolves plain $ids; a fragment ref (…#/$defs/x) is compiled through a $ref wrapper.
  const validate = ajv.getSchema(schemaId) ?? ajv.compile({ $ref: schemaId });
  if (!validate(value)) {
    throw new Error(`UCP schema violation (${schemaId}):\n${JSON.stringify(validate.errors, null, 2)}`);
  }
}
