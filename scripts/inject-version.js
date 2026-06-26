#!/usr/bin/env node
/**
 * inject-version.js, Reads `package.json:version` and propagates it into
 * the plugin version fields:
 *   - .claude-plugin/marketplace.json (.plugins[0].version)
 *   - providers/claude/plugin/.claude-plugin/plugin.json (.version)
 *   - providers/codex/plugin/.codex-plugin/plugin.json (.version)
 *
 * Single source of truth: package.json:version. Edit it once; run
 * `npm test` (which calls this script via npm run sync); both manifests
 * are propagated.
 *
 * The ClawHub bundle's frontmatter version
 * (providers/clawhub/skills/shippo/SKILL.md.template) is
 * INTENTIONALLY decoupled, ClawHub publish cadence is independent of
 * the Claude Code plugin's version. Bump it manually when releasing
 * to ClawHub.
 *
 * Idempotent. Run safely as many times as you want.
 */

const fs = require('fs').promises;
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PKG_PATH = path.join(ROOT, 'package.json');
const MARKETPLACE_PATH = path.join(ROOT, '.claude-plugin/marketplace.json');
const PLUGIN_PATH = path.join(ROOT, 'providers/claude/plugin/.claude-plugin/plugin.json');
const CODEX_PLUGIN_PATH = path.join(ROOT, 'providers/codex/plugin/.codex-plugin/plugin.json');

async function main() {
  const pkgRaw = await fs.readFile(PKG_PATH, 'utf8');
  const pkg = JSON.parse(pkgRaw);
  const version = pkg.version;

  if (typeof version !== 'string' || !version) {
    throw new Error('package.json:version is missing or not a string');
  }

  console.log(`Source of truth: package.json:version = ${version}`);

  // marketplace.json, .plugins[0].version
  const mpRaw = await fs.readFile(MARKETPLACE_PATH, 'utf8');
  const mp = JSON.parse(mpRaw);
  if (!Array.isArray(mp.plugins) || !mp.plugins[0]) {
    throw new Error('marketplace.json: .plugins[0] is missing');
  }
  mp.plugins[0].version = version;
  await fs.writeFile(MARKETPLACE_PATH, JSON.stringify(mp, null, 2) + '\n');
  console.log(`  ✓ ${path.relative(ROOT, MARKETPLACE_PATH)} → ${version}`);

  // plugin.json, .version
  const pnRaw = await fs.readFile(PLUGIN_PATH, 'utf8');
  const pn = JSON.parse(pnRaw);
  pn.version = version;
  await fs.writeFile(PLUGIN_PATH, JSON.stringify(pn, null, 2) + '\n');
  console.log(`  ✓ ${path.relative(ROOT, PLUGIN_PATH)} → ${version}`);

  // codex plugin.json, .version (ClawHub is intentionally left decoupled, see above)
  const cpRaw = await fs.readFile(CODEX_PLUGIN_PATH, 'utf8');
  const cp = JSON.parse(cpRaw);
  cp.version = version;
  await fs.writeFile(CODEX_PLUGIN_PATH, JSON.stringify(cp, null, 2) + '\n');
  console.log(`  ✓ ${path.relative(ROOT, CODEX_PLUGIN_PATH)} → ${version}`);

  console.log('Version injection complete.');
}

main().catch(err => {
  console.error(err.message || err);
  process.exit(1);
});
