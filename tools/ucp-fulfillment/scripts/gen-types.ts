import { compileFromFile } from 'json-schema-to-typescript';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const schemasDir = join(here, '..', 'schemas');
const entry = join(schemasDir, 'ucp-entry.json');
const outDir = join(here, '..', 'src', 'generated');
const outFile = join(outDir, 'ucp.ts');

const banner = [
  '/* eslint-disable */',
  '/**',
  ' * Generated from the UCP 2026-08-25 JSON schemas by scripts/gen-types.ts.',
  ' * Do not edit by hand. Re-run: npm run gen:types',
  ' */',
].join('\n');

const ts = await compileFromFile(entry, {
  cwd: schemasDir,
  bannerComment: banner,
  // false means "do not invent an index signature where the schema is silent". The 18 index
  // signatures the UCP schemas explicitly ask for (fulfillment_option, fulfillment_option_base,
  // fulfillment_group and friends) are still emitted, because those schemas really do declare
  // additionalProperties: true. Keeping the rest closed restores excess-property checking on
  // FulfillmentEvent, FulfillmentMethod, Expectation, Order and Total, which this library
  // constructs by hand and would otherwise be able to misspell without a compile error.
  additionalProperties: false,
  strictIndexSignatures: false,
  unknownAny: true,
});

mkdirSync(outDir, { recursive: true });
writeFileSync(outFile, ts);
console.log(`wrote ${outFile} (${ts.length} chars)`);
