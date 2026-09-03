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
  additionalProperties: true,
  strictIndexSignatures: false,
  unknownAny: true,
});

mkdirSync(outDir, { recursive: true });
writeFileSync(outFile, ts);
console.log(`wrote ${outFile} (${ts.length} chars)`);
