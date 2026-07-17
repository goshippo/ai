import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
) as { name: string; version: string };

export const PKG_NAME = pkg.name;
export const PKG_VERSION = pkg.version;
