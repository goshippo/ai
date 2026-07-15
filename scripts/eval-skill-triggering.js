#!/usr/bin/env node
/**
 * Skill-triggering evaluation harness.
 *
 * Reads test cases from tests/skill-triggering.json and, for each prompt,
 * invokes `claude -p --plugin-dir ./providers/claude/plugin
 *   --output-format=stream-json --include-partial-messages "<prompt>"`,
 * parses the streaming JSON output to detect which (if any) of our 9 skills
 * was activated, and aggregates pass/fail.
 *
 * Reliability: skill triggering is mildly nondeterministic, so a prompt that
 * fails on its first attempt is retried (up to --attempts total) and passes if
 * ANY attempt is correct. Only failing prompts are retried, so the common case
 * (a prompt that passes first try) still runs once and the suite stays fast.
 * This makes a single run reliable enough to gate on, while a genuinely-broken
 * skill still fails every attempt and is caught.
 *
 * Modeled on Anthropic's skill-creator plugin run_eval.py, same idea: watch
 * `content_block_start` for tool_use blocks named "Skill", accumulate JSON
 * deltas until the skill identifier appears, fall back to inspecting the full
 * assistant message tool_use input for the skill_name field.
 *
 * Exit code: 0 if pass rate >= PASS_THRESHOLD AND false-positive rate <= FP_THRESHOLD,
 * else 1.
 *
 * Flags:
 *   --tests <path>        path to test cases JSON (default: tests/skill-triggering.json)
 *   --plugin-dir <path>   plugin dir (default: ./providers/claude/plugin)
 *   --timeout <seconds>   per-prompt timeout (default: 30)
 *   --concurrency <n>     parallel workers (default: 4)
 *   --attempts <n>        max attempts per prompt, retried only on failure,
 *                         pass if any is correct (default: 3; set 1 to disable)
 *   --limit <n>           run only first N prompts (smoke test)
 *   --dry-run             print plan, don't invoke claude
 *   --json                emit machine-readable JSON to stdout (instead of human summary)
 *   --no-api-key          strip ANTHROPIC_API_KEY from the spawn env, forcing
 *                         claude-cli to use OAuth subscription auth. Use this
 *                         when running locally if your ANTHROPIC_API_KEY env
 *                         var is stale/invalid (CI should leave this off and
 *                         pass a valid key via secrets).
 *   --model <model-id>    pin a specific model (e.g. claude-opus-4-7). Without
 *                         this flag, claude-cli picks its default (Opus for
 *                         OAuth/Pro+Max, Sonnet for API-key). Pin it in CI to
 *                         keep eval results reproducible across auth modes.
 */

'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const PASS_THRESHOLD = 0.80;   // overall correctness
const FP_THRESHOLD = 0.20;     // false-positive rate ceiling

const SKILL_NAMES = new Set([
  'rate-shopping',
  'tracking',
  'address-validation',
  'label-purchase',
  'batch-shipping',
  'shipping-analysis',
  'shippo-best-practices',
  'upgrade-shippo',
  'shippo-support-ticket',
]);

function parseArgs(argv) {
  const args = {
    tests: 'tests/skill-triggering.json',
    pluginDir: './providers/claude/plugin',
    timeout: 30,
    concurrency: 4,
    limit: null,
    dryRun: false,
    json: false,
    noApiKey: false,
    model: null,
    attempts: 3,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--tests') args.tests = argv[++i];
    else if (a === '--plugin-dir') args.pluginDir = argv[++i];
    else if (a === '--timeout') args.timeout = Number(argv[++i]);
    else if (a === '--concurrency') args.concurrency = Number(argv[++i]);
    else if (a === '--limit') args.limit = Number(argv[++i]);
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--json') args.json = true;
    else if (a === '--no-api-key') args.noApiKey = true;
    else if (a === '--model') args.model = argv[++i];
    else if (a === '--attempts') args.attempts = Math.max(1, Number(argv[++i]));
    else if (a === '-h' || a === '--help') { printHelp(); process.exit(0); }
    else { console.error(`unknown flag: ${a}`); process.exit(2); }
  }
  return args;
}

function printHelp() {
  console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(1, 30).join('\n').replace(/^\/\*\*?|\s*\*\/?$/gm, ''));
}

function loadCases(file) {
  const abs = path.resolve(file);
  const groups = JSON.parse(fs.readFileSync(abs, 'utf8'));
  const cases = [];
  for (const g of groups) {
    for (const prompt of g.prompts) {
      cases.push({ skill: g.skill, shouldTrigger: g.should_trigger, prompt });
    }
  }
  return cases;
}

/**
 * Detect which of our 9 skills (if any) was activated in a single stream-json line.
 * The harness accumulates JSON-input deltas across lines per content_block_index,
 * and also handles full tool_use blocks emitted as part of complete assistant messages.
 *
 * State machine kept on the caller via `state`:
 *   { activated: string|null, blocks: Map<index, { name, jsonBuf }> }
 */
function processLine(rawLine, state) {
  const line = rawLine.trim();
  if (!line) return;
  let evt;
  try { evt = JSON.parse(line); } catch { return; }

  // Diagnostic: capture the model + tools list from the init event. Lets us
  // tell whether the Skill tool was actually loaded for this invocation
  // (debugging plugin-load issues across CI vs local).
  if (evt.type === 'system' && evt.subtype === 'init') {
    state.model = evt.model || null;
    state.toolsCount = Array.isArray(evt.tools) ? evt.tools.length : 0;
    state.hasSkillTool = Array.isArray(evt.tools) && evt.tools.includes('Skill');
    return;
  }

  // Capture the terminal result so we can tell a real triggering miss apart from
  // a CLI/auth FAILURE. An invalid ANTHROPIC_API_KEY makes every run
  // is_error=true with no skill firing, which previously masqueraded as a skill
  // regression for weeks. score()/main() surface this loudly.
  if (evt.type === 'result') {
    state.isError = evt.is_error === true;
    if (typeof evt.result === 'string') state.resultText = evt.result;
    return;
  }

  // Path A: --include-partial-messages stream events
  if (evt.type === 'stream_event' && evt.event) {
    const e = evt.event;
    if (e.type === 'content_block_start' && e.content_block && e.content_block.type === 'tool_use') {
      const idx = e.index;
      const name = e.content_block.name || '';
      // Some Claude builds use a generic "Skill" tool whose input is { skill_name: "..." };
      // others may name the tool after the skill itself.
      const direct = stripNamespace(name);
      if (SKILL_NAMES.has(direct)) state.activated ||= direct;
      state.blocks.set(idx, { name, jsonBuf: '' });
      checkInputForSkill(e.content_block.input, state);
      return;
    }
    if (e.type === 'content_block_delta' && e.delta && e.delta.type === 'input_json_delta') {
      const idx = e.index;
      const block = state.blocks.get(idx);
      if (!block) return;
      block.jsonBuf += e.delta.partial_json || '';
      // Cheap substring scan, definitive parse happens on stop.
      for (const s of SKILL_NAMES) {
        if (block.jsonBuf.includes(`"${s}"`)) { state.activated ||= s; return; }
      }
      return;
    }
    if (e.type === 'content_block_stop') {
      const idx = e.index;
      const block = state.blocks.get(idx);
      if (block && block.jsonBuf) {
        try {
          const input = JSON.parse(block.jsonBuf);
          checkInputForSkill(input, state);
        } catch { /* partial, ignore */ }
      }
      return;
    }
  }

  // Path B: full assistant message, fallback when partials weren't enough
  if (evt.type === 'assistant' && evt.message && Array.isArray(evt.message.content)) {
    for (const c of evt.message.content) {
      if (c.type === 'text' && typeof c.text === 'string') state.text += c.text;
      if (c.type !== 'tool_use') continue;
      const direct = stripNamespace(c.name || '');
      if (SKILL_NAMES.has(direct)) { state.activated ||= direct; continue; }
      checkInputForSkill(c.input, state);
    }
  }
}

function stripNamespace(name) {
  // "shippo:rate-shopping" -> "rate-shopping"; "Skill" -> "Skill"
  const i = name.indexOf(':');
  return i === -1 ? name : name.slice(i + 1);
}

function checkInputForSkill(input, state) {
  if (!input || typeof input !== 'object') return;
  const candidates = [input.skill, input.skill_name, input.name, input.command];
  for (const v of candidates) {
    if (typeof v !== 'string') continue;
    const s = stripNamespace(v);
    if (SKILL_NAMES.has(s)) { state.activated ||= s; return; }
  }
}

function runOne(testCase, opts) {
  return new Promise((resolve) => {
    const args = [
      '-p', testCase.prompt,
      '--plugin-dir', opts.pluginDir,
      '--output-format', 'stream-json',
      '--include-partial-messages',
      '--verbose',
      // NO --permission-mode plan. Plan mode makes the model PLAN the task
      // (ToolSearch / AskUserQuestion / ExitPlanMode) instead of activating the
      // workflow Skill, which collapses "do"-skill activation: measured 25% in
      // plan vs 98% in default mode across the 40 should-trigger prompts. The
      // eval was scoring plan-mode behavior, not skill triggering. Read-only
      // safety still holds: we early-exit on activation below (the child is
      // killed the instant a Skill fires, before any downstream tool runs), and
      // CI has no SHIPPO_API_KEY so the bundled MCP tools cannot execute side
      // effects anyway.
    ];
    if (opts.model) args.push('--model', opts.model);
    const spawnEnv = opts.noApiKey
      ? Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'ANTHROPIC_API_KEY'))
      : process.env;
    const child = spawn('claude', args, { stdio: ['ignore', 'pipe', 'pipe'], env: spawnEnv });
    const state = { activated: null, blocks: new Map(), model: null, toolsCount: 0, hasSkillTool: false, isError: false, text: '', resultText: '' };
    let stderrBuf = '';
    let buf = '';

    const killTimer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch {}
    }, opts.timeout * 1000);

    child.stdout.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      let nl;
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        processLine(line, state);
        if (state.activated) {
          // Early-exit: we've seen activation, no need to wait.
          try { child.kill('SIGTERM'); } catch {}
        }
      }
    });
    child.stderr.on('data', (c) => { stderrBuf += c.toString('utf8'); });

    child.on('close', (code, signal) => {
      clearTimeout(killTimer);
      if (buf.trim()) processLine(buf, state);
      // Surface the init-event diagnostic when activation failed unexpectedly,
      // to make plugin-load issues visible in CI logs.
      const expectedToTrigger = testCase.shouldTrigger;
      if (expectedToTrigger && !state.activated) {
        process.stderr.write(
          `       ↳ diag: model=${state.model || '?'} tools=${state.toolsCount} skill_tool=${state.hasSkillTool ? 'yes' : 'NO'}\n`
        );
      }
      resolve({
        ...testCase,
        activated: state.activated,
        isError: state.isError,
        exitCode: code,
        signal,
        stderr: stderrBuf.slice(0, 500),
        response: (state.resultText || state.text || '').trim().slice(0, 1200),
        diag: { model: state.model, toolsCount: state.toolsCount, hasSkillTool: state.hasSkillTool },
      });
    });
    child.on('error', (err) => {
      clearTimeout(killTimer);
      resolve({ ...testCase, activated: null, error: err.message });
    });
  });
}

// A result is "correct" iff a should-trigger prompt activated its skill, or a
// should-NOT-trigger prompt activated nothing.
function isCorrect(r) {
  return r.shouldTrigger ? r.activated === r.skill : r.activated === null;
}

// Retry-on-fail with best-of-N. A prompt that is correct on its first attempt
// runs exactly once, so the suite stays fast; only failing prompts are retried,
// up to opts.attempts total, and the prompt passes if ANY attempt is correct.
// This absorbs single-run LLM nondeterminism (a prompt that wobble-fails once
// gets rescued) while still failing prompts that are consistently wrong, which
// is what makes the eval reliable enough to gate on.
async function runOneWithRetry(testCase, opts, label) {
  const maxAttempts = Math.max(1, opts.attempts || 1);
  let last = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const r = await runOne(testCase, opts);
    if (isCorrect(r)) return { ...r, attempts: attempt };
    last = r;
    if (attempt < maxAttempts) {
      process.stderr.write(`       ${label} retry ${attempt + 1}/${maxAttempts} (attempt ${attempt} ${testCase.shouldTrigger ? 'did not activate' : 'false-activated'})\n`);
    }
  }
  return { ...last, attempts: maxAttempts };
}

async function runAll(cases, opts) {
  const results = [];
  let cursor = 0;
  async function worker() {
    while (cursor < cases.length) {
      const i = cursor++;
      const c = cases[i];
      const label = `[${i + 1}/${cases.length}]`;
      process.stderr.write(`${label} ${c.skill} (${c.shouldTrigger ? '+' : '-'}): ${c.prompt.slice(0, 60)}\n`);
      const r = await runOneWithRetry(c, opts, label);
      results[i] = r;
    }
  }
  const workers = Array.from({ length: opts.concurrency }, worker);
  await Promise.all(workers);
  return results;
}

function score(results) {
  // Each result -> pass iff:
  //   shouldTrigger=true  : activated === expected skill
  //   shouldTrigger=false : activated === null
  let pass = 0;
  const perSkill = new Map();
  let fpDenominator = 0, fpCount = 0;

  for (const r of results) {
    const correct = isCorrect(r);
    if (correct) pass++;
    if (!r.shouldTrigger) {
      fpDenominator++;
      if (r.activated !== null) fpCount++;
    }
    let s = perSkill.get(r.skill);
    if (!s) { s = { pos: 0, posPass: 0, neg: 0, negPass: 0, fpInto: 0 }; perSkill.set(r.skill, s); }
    if (r.shouldTrigger) { s.pos++; if (correct) s.posPass++; }
    else { s.neg++; if (correct) s.negPass++; }
    // Track which skill mis-fired (false-positive INTO this skill)
    if (!r.shouldTrigger && r.activated && SKILL_NAMES.has(r.activated)) {
      const ts = perSkill.get(r.activated) || { pos: 0, posPass: 0, neg: 0, negPass: 0, fpInto: 0 };
      ts.fpInto++;
      perSkill.set(r.activated, ts);
    }
  }
  return {
    total: results.length,
    pass,
    passRate: results.length ? pass / results.length : 0,
    fpRate: fpDenominator ? fpCount / fpDenominator : 0,
    perSkill: Object.fromEntries(perSkill),
  };
}

function formatHuman(summary, results) {
  const lines = [];
  lines.push('=== Skill Triggering Eval ===');
  lines.push(`Total:      ${summary.total}`);
  lines.push(`Pass:       ${summary.pass} (${(summary.passRate * 100).toFixed(1)}%)`);
  lines.push(`FP rate:    ${(summary.fpRate * 100).toFixed(1)}% (should-NOT-trigger that did)`);
  lines.push('');
  lines.push('Per-skill (trigger-rate / FP-into):');
  for (const [skill, s] of Object.entries(summary.perSkill)) {
    const tr = s.pos ? (s.posPass / s.pos * 100).toFixed(0) : '--';
    lines.push(`  ${skill.padEnd(24)} trigger=${tr}% (${s.posPass}/${s.pos})  FP-into=${s.fpInto}`);
  }
  const fails = results.filter((r) => (r.shouldTrigger ? r.activated !== r.skill : r.activated !== null));
  if (fails.length) {
    lines.push('');
    lines.push('Failures:');
    for (const f of fails) {
      const want = f.shouldTrigger ? f.skill : '(none)';
      lines.push(`  [${f.skill}] want=${want} got=${f.activated || '(none)'}  "${f.prompt.slice(0, 70)}"`);
    }
  }
  return lines.join('\n');
}

// GitHub-flavored Markdown summary for the Actions job summary + PR comment.
function mdCell(s) { return String(s).replace(/\|/g, '\\|').replace(/\r?\n/g, ' '); }

function formatMarkdown(summary, results, opts) {
  const ok = summary.passRate >= PASS_THRESHOLD && summary.fpRate <= FP_THRESHOLD;
  const L = [];
  L.push('## 🎯 Skill-triggering eval');
  L.push('');
  L.push(`### ${ok ? '✅ PASS' : '❌ FAIL'} &nbsp; ${(summary.passRate * 100).toFixed(1)}% pass &nbsp;·&nbsp; ${(summary.fpRate * 100).toFixed(1)}% false-positive`);
  L.push('');
  L.push(`| Metric | Result | Threshold |`);
  L.push(`|---|---|---|`);
  L.push(`| Pass rate | **${summary.pass}/${summary.total}** (${(summary.passRate * 100).toFixed(1)}%) | ≥ ${(PASS_THRESHOLD * 100).toFixed(0)}% |`);
  L.push(`| False-positive rate | ${(summary.fpRate * 100).toFixed(1)}% | ≤ ${(FP_THRESHOLD * 100).toFixed(0)}% |`);
  L.push('');
  L.push('| Skill | Should trigger | Should NOT trigger |');
  L.push('|---|---|---|');
  for (const [skill, s] of Object.entries(summary.perSkill)) {
    const pos = s.pos ? `${s.posPass}/${s.pos} ${s.posPass === s.pos ? '✅' : '⚠️'}` : 'n/a';
    const neg = s.neg ? `${s.negPass}/${s.neg} ${s.negPass === s.neg ? '✅' : '⚠️'}` : 'n/a';
    L.push(`| \`${skill}\` | ${pos} | ${neg} |`);
  }
  L.push('');

  // Per-prompt detail block: full prompt + the model's actual response, so a
  // miss can be diagnosed (why didn't the skill fire?). Used for failures and
  // for retried prompts.
  const detail = (r) => {
    const d = [];
    const got = r.activated ? `\`${r.activated}\`` : '_(none, no skill activated)_';
    const exp = r.shouldTrigger ? `\`${r.skill}\`` : '_(none, should NOT trigger)_';
    d.push(`> ${r.prompt.replace(/\r?\n/g, ' ')}`);
    d.push('');
    d.push(`**Expected:** ${exp} &nbsp; **Activated:** ${got} &nbsp; **Attempts:** ${r.attempts || 1}`);
    if (r.diag) d.push(`<sub>model \`${r.diag.model || '?'}\` · tools loaded: ${r.diag.toolsCount} · Skill tool present: ${r.diag.hasSkillTool ? 'yes' : 'NO'}</sub>`);
    d.push('');
    d.push('**Model response:**');
    d.push('');
    d.push('```');
    d.push(
      r.response && r.response.length
        ? r.response
        : r.activated
          ? `(activated ${r.activated}; the model called the skill with no preamble text)`
          : '(no assistant text emitted)',
    );
    d.push('```');
    return d.join('\n');
  };

  const retried = results.filter((r) => (r.attempts || 1) > 1);
  if (retried.length) {
    L.push(`<details><summary>🔁 ${retried.length} prompt(s) needed a retry (single-run wobble), expand for prompts + responses</summary>`);
    L.push('');
    for (const r of retried) {
      L.push(`<details><summary>${isCorrect(r) ? '✅' : '❌'} <code>${r.skill}</code> : ${mdCell(r.prompt.slice(0, 80))}</summary>`);
      L.push('');
      L.push(detail(r));
      L.push('');
      L.push('</details>');
    }
    L.push('');
    L.push('</details>');
    L.push('');
  }

  const failures = results.filter((r) => !isCorrect(r));
  if (failures.length) {
    L.push(`<details open><summary>❌ ${failures.length} failing prompt(s), expand for prompts + responses</summary>`);
    L.push('');
    for (const r of failures) {
      L.push(`<details><summary><code>${r.skill}</code> : ${mdCell(r.prompt.slice(0, 80))}</summary>`);
      L.push('');
      L.push(detail(r));
      L.push('');
      L.push('</details>');
    }
    L.push('');
    L.push('</details>');
    L.push('');
  }

  L.push(`<sub>model \`${opts.model || 'default'}\` · up to ${opts.attempts || 1} attempts (retried on fail) · ${summary.total} prompts</sub>`);
  return L.join('\n');
}

async function main() {
  const args = parseArgs(process.argv);
  let cases = loadCases(args.tests);
  if (args.limit) cases = cases.slice(0, args.limit);

  if (args.dryRun) {
    console.log(JSON.stringify({ planned: cases.length, sample: cases.slice(0, 3) }, null, 2));
    return 0;
  }

  const results = await runAll(cases, args);
  const summary = score(results);

  // Markdown summary: append to the Actions job summary if present, and always
  // write a file the workflow can post as a sticky PR comment.
  const md = formatMarkdown(summary, results, args);
  if (process.env.GITHUB_STEP_SUMMARY) {
    try { fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n'); } catch {}
  }
  try { fs.writeFileSync('eval-summary.md', md + '\n'); } catch {}

  if (args.json) {
    console.log(JSON.stringify({ summary, results }, null, 2));
  } else {
    console.log(formatHuman(summary, results));
  }

  // Distinguish a HARNESS/AUTH failure from a real triggering miss. If runs
  // came back is_error (e.g. an invalid/expired ANTHROPIC_API_KEY), the
  // skill-trigger numbers above are meaningless, not a skill regression.
  const cliErrors = results.filter((r) => r.isError || r.error).length;
  if (cliErrors > 0) {
    console.error(`\n!! ${cliErrors}/${results.length} runs failed to EXECUTE (is_error / spawn error). This is a harness/auth problem, NOT skill triggering. Check the ANTHROPIC_API_KEY secret and the claude CLI; the numbers above are unreliable while these fail.`);
  }

  const ok = summary.passRate >= PASS_THRESHOLD && summary.fpRate <= FP_THRESHOLD;
  if (!ok) {
    console.error(`\nFAIL: pass=${(summary.passRate * 100).toFixed(1)}% (need >=${PASS_THRESHOLD * 100}%)  fp=${(summary.fpRate * 100).toFixed(1)}% (need <=${FP_THRESHOLD * 100}%)`);
  }
  return ok ? 0 : 1;
}

main().then((code) => process.exit(code)).catch((err) => {
  console.error(err);
  process.exit(2);
});
