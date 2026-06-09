#!/usr/bin/env node
/**
 * check-tool-references.js
 *
 * Validates that every MCP-tool-shaped identifier referenced in a canonical
 * skill markdown file (under skills/) actually exists in the MCP tool
 * catalog (tools/mcp-catalog.json).
 *
 * Catches drift between the names skills reference and the names the live MCP
 * server actually exposes. The catalog reflects the DEPLOYED server
 * (mcp.shippo.com, the 4-tool meta-API), whose operations are PascalCase
 * (CreateShipment, ValidateAddress, GetTrack), with the Webhooks ops in
 * camelCase (createWebhook, ...).
 *
 * Heuristic for "tool-shaped":
 *   - a backticked identifier with NO underscore (so snake_case field names
 *     like `address_line_1` are ignored)
 *   - starts with a known action verb (Create/Get/List/Update/Delete/Parse/
 *     Validate/Add/Remove/Purchase/Initiate), in either case, immediately
 *     followed by an uppercase letter, i.e. PascalCase `CreateShipment` or
 *     camelCase `createWebhook`. This excludes response fields like
 *     `ParsedAddress` or `ValidationResult` (the char after the verb is
 *     lowercase).
 *
 * This is intentionally narrow: the goal is to catch references to tools
 * that don't exist, not to lint every backticked field name.
 *
 * Additionally flags STALE KEBAB-CASE op-name tokens. The live server names
 * are PascalCase/camelCase; an old generator emitted kebab-case names like
 * `shipments-get` or `addresses-create-v1`. None of those exist on the server,
 * so any backticked `verb-noun` kebab token (a hyphenated lowercase token with
 * a known action verb as one of its segments) is drift and is rejected. Legit
 * kebab cross-references to sibling SKILLS (e.g. `rate-shopping`,
 * `label-purchase`) are exempted via SKILL_SLUGS, derived from the directory
 * names under skills/ at runtime.
 *
 * Exit codes:
 *   0  all references resolve
 *   1  one or more references unknown, see stderr for the list
 */

'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const CATALOG_PATH = path.join(REPO_ROOT, 'tools', 'mcp-catalog.json');
const SKILLS_DIR = path.join(REPO_ROOT, 'skills');

// Verbs that prefix the live MCP tool names. A tool-shaped token is one of
// these verbs (either case) followed immediately by an uppercase letter.
// PascalCase verbs (most tools) + the lowercase verbs used by the camelCase
// Webhooks ops. A tool-shaped token is one of these verbs followed immediately
// by an UPPERCASE letter (the noun's capital), matched case-exactly, so
// response types like `AddressPaginatedList`/`ParsedAddress` and status
// constants like `PURCHASED` are not flagged.
const PASCAL_VERBS = [
  'Create', 'Get', 'List', 'Update', 'Delete', 'Parse', 'Validate',
  'Add', 'Remove', 'Purchase', 'Initiate',
];
const CAMEL_VERBS = ['create', 'get', 'list', 'update', 'delete'];
const VERB_RE = new RegExp('^(' + [...PASCAL_VERBS, ...CAMEL_VERBS].join('|') + ')[A-Z]');

// Identifiers that match the verb+Noun shape but are demonstrably not MCP
// tool names. Add to this allowlist when a false positive shows up rather than
// loosening the heuristic.
const NON_TOOL_ALLOWLIST = new Set([]);

// Lowercase action verbs that mark a kebab token as a stale op name. The old
// generator put the verb either first (`parcels-create` -> noun-verb) or as
// any segment, so we flag a kebab token if ANY of its segments is one of these.
const KEBAB_VERBS = new Set([
  'create', 'get', 'list', 'update', 'delete', 'parse', 'validate',
  'add', 'remove', 'purchase', 'initiate', 'register',
]);

// Kebab cross-references to sibling skills (e.g. `rate-shopping`,
// `label-purchase`) are legitimate links, not op names. Derived from the
// directory names under skills/ so it stays in sync as skills are added.
function loadSkillSlugs() {
  const slugs = new Set();
  for (const entry of fs.readdirSync(SKILLS_DIR, { withFileTypes: true })) {
    if (entry.isDirectory()) slugs.add(entry.name);
  }
  return slugs;
}

// Backticked all-lowercase hyphenated token, e.g. `shipments-get`.
function extractKebabTokens(text, skillSlugs) {
  const re = /`([a-z][a-z0-9]*(?:-[a-z0-9]+)+)`/g;
  const found = new Set();
  let m;
  while ((m = re.exec(text)) !== null) {
    const tok = m[1];
    if (skillSlugs.has(tok)) continue;                 // sibling-skill link
    const segs = tok.split('-');
    if (!segs.some((s) => KEBAB_VERBS.has(s))) continue; // not a verb-noun op
    found.add(tok);
  }
  return found;
}

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile() && entry.name.endsWith('.md')) out.push(full);
  }
  return out;
}

function extractCandidates(text) {
  const re = /`([A-Za-z][A-Za-z0-9]+)`/g;
  const found = new Set();
  let m;
  while ((m = re.exec(text)) !== null) {
    const ident = m[1];
    if (ident.includes('_')) continue;        // snake_case field names, ignore
    if (!/[A-Z]/.test(ident)) continue;        // need an uppercase (Pascal/camel)
    if (!VERB_RE.test(ident)) continue;        // verb + uppercase noun
    if (NON_TOOL_ALLOWLIST.has(ident)) continue;
    found.add(ident);
  }
  return found;
}

function main() {
  if (!fs.existsSync(CATALOG_PATH)) {
    console.error(`ERROR: catalog file missing at ${CATALOG_PATH}`);
    process.exit(1);
  }
  const catalog = new Set(JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8')));
  const skillSlugs = loadSkillSlugs();

  const files = walk(SKILLS_DIR);
  const violationsByFile = new Map();
  let totalReferences = 0;

  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    const candidates = extractCandidates(text);
    totalReferences += candidates.size;
    const unknown = [...candidates].filter((c) => !catalog.has(c));
    // Stale kebab-case op names never exist in the catalog (PascalCase/camelCase
    // only), so every flagged kebab token is a violation.
    const kebab = [...extractKebabTokens(text, skillSlugs)];
    const all = [...unknown, ...kebab];
    if (all.length) {
      violationsByFile.set(path.relative(REPO_ROOT, file), all.sort());
    }
  }

  if (violationsByFile.size === 0) {
    console.log(
      `check-tool-references: OK, ${totalReferences} tool reference(s) ` +
      `across ${files.length} skill file(s) all resolve to entries in ` +
      `tools/mcp-catalog.json (${catalog.size} tools).`
    );
    process.exit(0);
  }

  console.error('check-tool-references: FAIL');
  console.error('');
  console.error('The following backticked identifiers look like MCP tool');
  console.error('names but are not present in tools/mcp-catalog.json:');
  console.error('');
  for (const [file, unknown] of violationsByFile) {
    console.error(`  ${file}`);
    for (const u of unknown) console.error(`    - ${u}`);
  }
  console.error('');
  console.error('Fix one of:');
  console.error('  1. Typo in the skill, correct the name to match the catalog');
  console.error('  2. The MCP server changed, regenerate tools/mcp-catalog.json');
  console.error('     from the live server (the names returned by shippo_list_tools');
  console.error('     at mcp.shippo.com), not from the OpenAPI spec');
  console.error('  3. Legitimately not a tool, add it to NON_TOOL_ALLOWLIST');
  console.error('     in scripts/check-tool-references.js');
  process.exit(1);
}

main();
