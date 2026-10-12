#!/usr/bin/env node
// One command that checks the whole app and says exactly what broke and where.
//
//   npm run verify            everything (~3 min)
//   npm run verify -- --quick skip the slow steps (video recording, native bundles, config)
//   npm run verify -- sync db only steps whose name contains "sync" or "db"
//
// Writes verify/out/report.md. Exit code 1 if anything failed.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
process.chdir(ROOT);
const args = process.argv.slice(2);
const quick = args.includes('--quick');
const only = args.filter(a => !a.startsWith('--'));

const test = file => ({ cmd: 'node', args: ['--enable-source-maps', '--import', 'tsx', '--test', '--test-reporter=tap', file], tap: true });
const STEPS = [
  { name: 'typecheck app', what: 'TypeScript errors in app/ and src/', ...{ cmd: 'npx', args: ['tsc', '--noEmit'] } },
  { name: 'typecheck tests', what: 'TypeScript errors in verify/', ...{ cmd: 'npx', args: ['tsc', '--noEmit', '-p', 'verify'] } },
  { name: 'cluster', what: 'Grouping photos into outings: gaps, moves, missing/bad GPS, big libraries', ...test('verify/tests/cluster.test.ts') },
  { name: 'face', what: 'Face detection + matching with the real TFLite models', ...test('verify/tests/face.test.ts') },
  { name: 'sync', what: 'Whole sync flow on a fake gallery/server: skips, waits, merges, retries', ...test('verify/tests/sync.test.ts') },
  { name: 'db', what: 'SQL migration, pairing, and row-level security between couples', ...test('verify/tests/db.test.ts') },
  { name: 'summary', what: 'Parsing the AI summary reply', ...test('verify/tests/summary.test.ts') },
  { name: 'privacy', what: 'Every network call is listed; no analytics SDKs; no location/face logging', ...test('verify/tests/privacy.test.ts') },
  { name: 'config', what: 'Native permissions for iOS/Android', slow: true, ...test('verify/tests/config.test.ts') },
  { name: 'video', what: 'Map video records in a real browser and comes back through the bridge', slow: true, ...test('verify/tests/video.test.ts') },
  { name: 'bundle android', what: 'JS bundle builds for Android', slow: true, cmd: 'npx', args: ['expo', 'export', '--platform', 'android', '--output-dir', 'verify/out/export-android'] },
  { name: 'bundle ios', what: 'JS bundle builds for iOS', slow: true, cmd: 'npx', args: ['expo', 'export', '--platform', 'ios', '--output-dir', 'verify/out/export-ios'] },
  { name: 'expo doctor', what: 'Dependency/SDK compatibility (warnings only)', slow: true, warnOnly: true, cmd: 'npx', args: ['expo-doctor'] },
];

/** Pull failing test names and their assertion details out of TAP output. */
function tapFailures(out) {
  const lines = out.split('\n');
  const fails = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\s*)not ok \d+ - (.*)$/);
    if (!m) continue;
    // Skip the parent "suite"/file wrapper lines; their children carry the detail.
    const indent = m[1].length;
    const child = lines.slice(i + 1, i + 3).some(l => /^\s*(not )?ok /.test(l) && l.search(/\S/) > indent);
    if (child) continue;
    const detail = [];
    for (let j = i + 1; j < lines.length && !/^\s*(not )?ok \d+/.test(lines[j]) && detail.length < 14; j++) {
      const l = lines[j].trim();
      if (/^(error:|expected:|actual:|\+|-|location:|code:|')/.test(l) && !/^---$/.test(l) && !l.startsWith('- ---')) detail.push(l);
    }
    if (fails.some(f => f.name === m[2]) || detail.some(d => /subtests? failed/.test(d))) continue;
    fails.push({ name: m[2], detail });
  }
  return fails;
}
const tapCount = (out, k) => Number((out.match(new RegExp(`^# ${k} (\\d+)`, 'm')) ?? [])[1] ?? 0);

const results = [];
const t0 = Date.now();
for (const s of STEPS) {
  if (quick && s.slow) { results.push({ ...s, status: 'skip', note: '--quick' }); continue; }
  if (only.length && !only.some(o => s.name.includes(o))) continue;
  process.stdout.write(`▸ ${s.name.padEnd(16)} `);
  const start = Date.now();
  const r = spawnSync(s.cmd, s.args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 10 * 60 * 1000, env: { ...process.env, FORCE_COLOR: '0', CI: '1' } });
  const out = `${r.stdout ?? ''}\n${r.stderr ?? ''}`;
  const secs = ((Date.now() - start) / 1000).toFixed(1);
  let status = r.status === 0 ? 'pass' : s.warnOnly ? 'warn' : 'fail';
  let note = '', fails = [];
  if (s.tap) {
    const pass = tapCount(out, 'pass'), fail = tapCount(out, 'fail'), skip = tapCount(out, 'skipped'), todo = tapCount(out, 'todo');
    note = `${pass} passed${fail ? `, ${fail} failed` : ''}${skip ? `, ${skip} skipped` : ''}${todo ? `, ${todo} known gap` : ''}`;
    const gaps = [...out.matchAll(/^\s*(?:not )?ok \d+ - (.*) # TODO (.*)$/gm)].map(m => `${m[1]} (${m[2]})`);
    if (gaps.length) note += `\n      known gaps: ${gaps.join('; ')}`;
    fails = tapFailures(out);
    if (skip && !fail && r.status === 0) status = 'skip-part';
    if (r.status !== 0 && !fails.length) fails = [{ name: 'could not run', detail: out.split('\n').filter(l => /Error|error/.test(l)).slice(0, 8) }];
  } else if (r.status !== 0) {
    fails = [{ name: s.name, detail: out.split('\n').filter(l => l.trim() && !/^\s+at /.test(l)).slice(-15) }];
  }
  if (r.error) fails.push({ name: 'runner', detail: [String(r.error)] });
  const icon = { pass: '✓', fail: '✗', warn: '!', 'skip-part': '~' }[status];
  console.log(`${icon} ${note || status}  (${secs}s)`);
  for (const f of fails) {
    console.log(`    ✗ ${f.name}`);
    for (const d of f.detail) console.log(`        ${d}`);
  }
  results.push({ ...s, status, note, fails, secs });
}

const failed = results.filter(r => r.status === 'fail');
const total = ((Date.now() - t0) / 1000).toFixed(0);
console.log(`\n${failed.length ? `✗ ${failed.length} step(s) failed` : '✓ all checks passed'}  (${total}s)`);

fs.mkdirSync('verify/out', { recursive: true });
const md = [
  `# Verify report`, '',
  `${new Date().toISOString()} · ${failed.length ? `**${failed.length} failed**` : 'all passed'} · ${total}s`, '',
  '| Step | Checks | Result | Time |', '|---|---|---|---|',
  ...results.map(r => `| ${r.name} | ${r.what} | ${{ pass: 'pass', fail: '**FAIL**', warn: 'warning', skip: 'skipped', 'skip-part': 'pass (some skipped)' }[r.status]}${r.note ? ` · ${r.note}` : ''} | ${r.secs ?? '-'}s |`),
  '',
  ...results.filter(r => r.fails?.length).flatMap(r => [`## ${r.name}`, '', ...r.fails.flatMap(f => [`- **${f.name}**`, ...(f.detail.length ? ['', '  ```', ...f.detail.map(d => `  ${d}`), '  ```'] : [])]), '']),
].join('\n');
fs.writeFileSync('verify/out/report.md', md);
console.log('report: verify/out/report.md');
process.exit(failed.length ? 1 : 0);
