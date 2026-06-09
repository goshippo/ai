#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SKILL_DIRS = [
  'skills',
  'providers/claude/plugin/skills',
  'providers/clawhub/skills',
];

function findSkillFiles() {
  const files = [];
  for (const dir of SKILL_DIRS) {
    const abs = path.join(ROOT, dir);
    if (!fs.existsSync(abs)) continue;
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const skill = path.join(abs, entry.name, 'SKILL.md');
      if (fs.existsSync(skill)) files.push(skill);
    }
  }
  return files.sort();
}

function extractFrontmatter(content) {
  const lines = content.split('\n');
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === '---') { start = i; break; }
  }
  if (start === -1) return null;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i] === '---') return lines.slice(start + 1, i).join('\n');
  }
  return null;
}

function parseFields(yaml) {
  const fields = {};
  const lines = yaml.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/);
    if (!m) continue;
    fields[m[1]] = m[2].trim();
  }
  return fields;
}

function main() {
  const files = findSkillFiles();
  const errors = [];
  for (const file of files) {
    const rel = path.relative(ROOT, file);
    const content = fs.readFileSync(file, 'utf8');
    const fm = extractFrontmatter(content);
    if (fm === null) {
      errors.push(`${rel}: missing or malformed frontmatter`);
      continue;
    }
    const fields = parseFields(fm);
    if (!fields.name) {
      errors.push(`${rel}: missing name field`);
      continue;
    }
    if (!('description' in fields)) {
      errors.push(`${rel}: missing description field`);
      continue;
    }
    console.log(`  ✓ ${rel}: name=${fields.name}`);
  }
  if (errors.length) {
    console.error('\nFrontmatter validation failed:');
    for (const e of errors) console.error(`  ✗ ${e}`);
    process.exit(1);
  }
}

main();
