#!/usr/bin/env node
/**
 * build-app-plugin.js, Packages the Claude plugin as a single upload-ready ZIP
 * for the Claude apps (claude.ai / Claude Desktop / Cowork). The app plugin
 * format is the same as the Claude Code plugin: a `.claude-plugin/plugin.json`
 * manifest plus a `skills/` directory (and the bundled `.mcp.json`). An org
 * admin uploads this one ZIP via Organization settings > Plugins and all
 * bundled skills become available org-wide (or to a group), so this replaces
 * the prior one-ZIP-per-skill approach: one upload instead of eight.
 *
 * Output: dist/app-plugin/shippo-plugin.zip, containing the plugin directory at
 * the archive root:
 *
 *   shippo/.claude-plugin/plugin.json
 *   shippo/.mcp.json
 *   shippo/skills/<...>
 *   shippo/README.md, shippo/LICENSE
 *
 * Source is providers/claude/plugin/ (the assembled plugin: skills are the 1:1
 * canonical mirror kept current by `npm run sync`). Zero dependencies: the ZIP
 * is written with Node's built-in zlib (deflate) + a small CRC-32, no system
 * `zip` and no npm packages. Builds are deterministic (fixed timestamps).
 *
 * Usage:
 *   node scripts/build-app-plugin.js          # build dist/app-plugin/shippo-plugin.zip
 *   node scripts/build-app-plugin.js --check   # validate the plugin source only
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');
const PLUGIN_DIR = path.join(ROOT, 'providers', 'claude', 'plugin');
const OUT_DIR = path.join(ROOT, 'dist', 'app-plugin');
const OUT_ZIP = path.join(OUT_DIR, 'shippo-plugin.zip');
// Folder name at the ZIP root (the plugin directory).
const ROOT_FOLDER = 'shippo';

const CHECK_ONLY = process.argv.includes('--check');

// ---------------------------------------------------------------------------
// Minimal ZIP writer (deflate, method 8). Zero dependencies.
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const DOS_TIME = 0;
const DOS_DATE = ((2021 - 1980) << 9) | (1 << 5) | 1; // fixed: 2021-01-01

function buildZip(entries) {
  const locals = [];
  const central = [];
  let offset = 0;

  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const compressed = zlib.deflateRawSync(data, { level: 9 });

    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    nameBuf.copy(local, 30);
    locals.push(local, compressed);

    const cd = Buffer.alloc(46 + nameBuf.length);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0, 8);
    cd.writeUInt16LE(8, 10);
    cd.writeUInt16LE(DOS_TIME, 12);
    cd.writeUInt16LE(DOS_DATE, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(compressed.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt16LE(0, 30);
    cd.writeUInt16LE(0, 32);
    cd.writeUInt16LE(0, 34);
    cd.writeUInt16LE(0, 36);
    cd.writeUInt32LE(0, 38);
    cd.writeUInt32LE(offset, 42);
    nameBuf.copy(cd, 46);
    central.push(cd);

    offset += local.length + compressed.length;
  }

  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...locals, centralBuf, eocd]);
}

// ---------------------------------------------------------------------------
// Collect plugin files
// ---------------------------------------------------------------------------

function walk(dir, baseRel = '') {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name === '.DS_Store') continue;
    const abs = path.join(dir, entry.name);
    const rel = baseRel ? `${baseRel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...walk(abs, rel));
    else if (entry.isFile()) out.push({ abs, rel });
  }
  return out;
}

function validateSource() {
  const manifest = path.join(PLUGIN_DIR, '.claude-plugin', 'plugin.json');
  if (!fs.existsSync(manifest)) throw new Error(`plugin manifest not found: ${path.relative(ROOT, manifest)}`);
  const m = JSON.parse(fs.readFileSync(manifest, 'utf8'));
  if (!m.name || !m.version) throw new Error('plugin.json must declare name and version');
  const skillsDir = path.join(PLUGIN_DIR, 'skills');
  const skillCount = fs.existsSync(skillsDir)
    ? fs.readdirSync(skillsDir, { withFileTypes: true }).filter(e => e.isDirectory() && fs.existsSync(path.join(skillsDir, e.name, 'SKILL.md'))).length
    : 0;
  if (skillCount === 0) throw new Error('plugin bundles no skills (skills/<name>/SKILL.md)');
  return { name: m.name, version: m.version, skillCount };
}

function main() {
  const info = validateSource();
  if (CHECK_ONLY) {
    console.log(`  ✓ plugin '${info.name}' v${info.version}, ${info.skillCount} skill(s); source is valid.`);
    console.log('check: plugin source OK.');
    return;
  }

  const files = walk(PLUGIN_DIR).sort((a, b) => a.rel.localeCompare(b.rel));
  const entries = files.map(f => ({ name: `${ROOT_FOLDER}/${f.rel}`, data: fs.readFileSync(f.abs) }));
  const zip = buildZip(entries);

  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_ZIP, zip);
  console.log(`  ✓ ${path.relative(ROOT, OUT_ZIP)} (plugin '${info.name}' v${info.version}, ${info.skillCount} skills, ${entries.length} files, ${zip.length} bytes)`);
  console.log(`Built the app-plugin ZIP into ${path.relative(ROOT, OUT_DIR)}/.`);
}

main();
