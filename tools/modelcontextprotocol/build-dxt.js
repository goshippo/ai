// Builds the Desktop Extension (.dxt) for one-click install into Claude Desktop.
// The .dxt must be self-contained (no node_modules on the user's machine), so
// unlike the npm build (tsup, deps external) this bundles everything into a
// single CJS file with esbuild, then packs it with @anthropic-ai/dxt.
import esbuild from 'esbuild';
import { chmodSync, existsSync, mkdirSync } from 'node:fs';
import { packExtension } from '@anthropic-ai/dxt';

if (!existsSync('dxt-dist')) mkdirSync('dxt-dist');

await esbuild.build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  outfile: 'dxt-dist/index.js',
  platform: 'node',
  target: 'node18',
  // ESM (not CJS): the package is "type": "module", so a .js entry is loaded as
  // ESM, and the bridge's version.ts reads package.json via import.meta.url,
  // which esbuild only populates under the esm format.
  format: 'esm',
  minify: true,
  logLevel: 'info',
});
chmodSync('dxt-dist/index.js', 0o755);
console.log('bundled dxt-dist/index.js');

await packExtension({ extensionPath: '.', outputPath: 'shippo.dxt', silent: true });
console.log('packed shippo.dxt');
