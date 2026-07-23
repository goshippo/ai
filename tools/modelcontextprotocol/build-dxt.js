// Builds the Desktop Extension (.dxt) for one-click install into Claude Desktop.
// The .dxt must be self-contained (no node_modules on the user's machine), so
// unlike the npm build (tsup, deps external) this bundles everything into a
// single CJS file with esbuild, then packs it with @anthropic-ai/dxt.
import esbuild from 'esbuild';
import { chmodSync, existsSync, mkdirSync } from 'node:fs';
import { packExtension } from '@anthropic-ai/dxt';

// API-KEY-AUTH (hidden until the hosted key door ships): manifest.json is pure
// OAuth today. JSON has no comments, so the optional API-key config lives here.
// When the key door ships, add this back to manifest.json as a top-level
// "user_config" and set server.mcp_config.env accordingly:
//
//   "user_config": {
//     "shippo_api_key": {
//       "type": "string",
//       "title": "Shippo API key (optional)",
//       "description": "Leave blank to sign in with OAuth in your browser (recommended). Or paste a Shippo API key (shippo_test_... or shippo_live_...) for headless / API-key use once the hosted key door is enabled.",
//       "sensitive": true,
//       "required": false,
//       "multiple": false
//     }
//   },
//   ... and inside server.mcp_config:
//   "env": { "SHIPPO_API_KEY": "${user_config.shippo_api_key}" }

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
