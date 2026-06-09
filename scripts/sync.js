#!/usr/bin/env node
/**
 * sync.js, Mirrors canonical skills/ into each 1:1 provider mirror
 *           (Claude Code plugin, OpenAI Codex) listed in TARGETS.
 *
 * Idempotent. Run after editing any skill in skills/ to propagate changes
 * to every 1:1-mirror distribution.
 *
 * Strategy: rm -rf the target, then recursively copy from source.
 * skills/ is canonical; the target directory's contents are derived
 * and disposable.
 *
 * Each copied file gets an HTML-comment "DO NOT EDIT" banner so humans
 * opening derived files in an editor see the warning. For files with
 * YAML frontmatter (SKILL.md), the banner is placed AFTER the closing
 * `---` so the file still starts with `---` (required by the Anthropic
 * skills-ref spec validator). For plain markdown files (READMEs,
 * references), the banner sits at the top.
 */

const fs = require('fs').promises;
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SOURCE = path.join(ROOT, 'skills');
const TARGETS = [
  path.join(ROOT, 'providers/claude/plugin/skills'),
  path.join(ROOT, 'providers/codex/plugin/skills'),
  // Future providers: add new targets here.
];

const SCRIPT_NAME = 'sync.js';

function buildHtmlBanner(canonicalRelPath) {
  return (
    `<!--\n` +
    `  ⚠️  DO NOT EDIT. Auto-generated from ${canonicalRelPath} by scripts/${SCRIPT_NAME}\n` +
    `  Edits here will be overwritten on the next sync.\n` +
    `  To change this content, edit the canonical source and re-run the sync script.\n` +
    `-->\n\n`
  );
}

async function copyWithBanner(src, dest) {
  const content = await fs.readFile(src, 'utf8');
  const canonicalRelPath = path.relative(ROOT, src).split(path.sep).join('/');
  const banner = buildHtmlBanner(canonicalRelPath);

  // Place the banner AFTER YAML frontmatter so the file still starts with
  // `---` (required by Anthropic's skills-ref validator). If the file has
  // no frontmatter (plain markdown like READMEs and references), prepend
  // at the top.
  let output;
  const fmMatch = content.match(/^(---\n[\s\S]*?\n---\n)([\s\S]*)$/);
  if (fmMatch) {
    output = fmMatch[1] + banner + fmMatch[2];
  } else {
    output = banner + content;
  }

  await fs.writeFile(dest, output);
}

async function copyRecursive(src, dest) {
  const stat = await fs.stat(src);
  if (stat.isDirectory()) {
    await fs.mkdir(dest, { recursive: true });
    const entries = await fs.readdir(src);
    for (const entry of entries) {
      await copyRecursive(path.join(src, entry), path.join(dest, entry));
    }
  } else {
    await copyWithBanner(src, dest);
  }
}

async function main() {
  console.log(`Source: ${SOURCE}`);

  // List canonical skill folders (top-level dirs in skills/).
  const entries = await fs.readdir(SOURCE, { withFileTypes: true });
  const items = entries.filter(e => e.isDirectory()).map(e => e.name);
  console.log(`Found ${items.length} top-level skill folder(s): ${items.join(', ')}`);

  for (const target of TARGETS) {
    console.log(`\nTarget: ${target}`);

    // Clean target to handle deletions cleanly.
    await fs.rm(target, { recursive: true, force: true });
    await fs.mkdir(target, { recursive: true });

    for (const item of items) {
      await copyRecursive(
        path.join(SOURCE, item),
        path.join(target, item)
      );
      console.log(`  ✓ ${item}`);
    }
  }

  console.log('\nSync complete.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
