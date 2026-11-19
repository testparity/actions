import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import test from 'node:test';

const script = fileURLToPath(new URL('../check.mjs', import.meta.url));

for (const [name, custom, hosted, expectedSuite] of [
  ['default CLI receives suite evidence in JSON', false, false, true],
  ['older custom CLI preserves JSON compatibility', true, false, false],
  ['hosted custom CLI receives suite evidence in JSON', true, true, true],
]) {
  test(name, () => {
    const dir = mkdtempSync(join(tmpdir(), 'testparity-suite-'));
    try {
      const cli = join(dir, 'php');
      const output = join(dir, 'output');
      const args = join(dir, 'args');
      writeFileSync(cli, `#!/bin/sh
echo "$*" >> "$TP_TEST_ARGS"
case "$*" in
  *--format=json*) echo '{"passed":true,"structures":[]}'; exit 0 ;;
  *--format=github*) echo '## TestParity coverage'; exit 0 ;;
  *) exit 2 ;;
esac
`, { mode: 0o700 });
      const preload = join(dir, 'download.mjs');
      writeFileSync(preload, `import { createHash } from 'node:crypto';
const binary = Buffer.from('test binary');
globalThis.fetch = async url => {
  if (!url.startsWith('https://github.com/testparity/cli/releases/download/v1.5.0/')) throw new Error('Unexpected release URL');
  return new Response(url.endsWith('.sha256') ? createHash('sha256').update(binary).digest('hex') : binary);
};`);
      const result = spawnSync(process.execPath, ['--import', preload, script], { encoding: 'utf8', env: {
        ...process.env, PATH: dir + ':' + process.env.PATH, RUNNER_TEMP: dir, GITHUB_OUTPUT: output,
        GITHUB_STEP_SUMMARY: '', TP_CLI: custom ? cli : '', TP_HOSTED: String(hosted),
        TP_MODE: 'check', TP_CONFIG: 'parity.yaml', TP_SUITE: 'coverage.xml', TP_TEST_ARGS: args,
      } });
      assert.equal(result.status, 0, result.stderr);
      const calls = readFileSync(args, 'utf8').trim().split('\n');
      assert.equal(calls[0].includes('--suite-coverage=coverage.xml'), expectedSuite);
      assert.match(calls[1], /--suite-coverage=coverage.xml/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
}

test('line regression fails advisory action and retains line-number evidence', () => {
  const dir = mkdtempSync(join(tmpdir(), 'testparity-lines-'));
  try {
    const hash = value => createHash('sha256').update(value).digest('hex');
    const report = coveredLines => ({ passed: false, structures: [{ name: 'App', files: [{
      source: 'src/Payment.php', test: 'tests/PaymentTest.php', passed: false,
      rules: { 'matched-coverage': { passed: false, value: '50%' } },
      lineCoverage: { version: 1, complete: true, sourceHash: hash('first\nsecond\n'),
        lineHashes: [hash('first'), hash('second')], executableLines: [1, 2], coveredLines },
    }] }] });
    const cli = join(dir, 'parity');
    const baseline = join(dir, 'baseline.json');
    const output = join(dir, 'output');
    writeFileSync(baseline, JSON.stringify(report([1])));
    writeFileSync(cli, `#!/bin/sh
case "$*" in
  *--format=json*) echo '${JSON.stringify(report([2]))}'; exit 1 ;;
  *--format=github*) echo '## TestParity coverage'; exit 1 ;;
  *) exit 2 ;;
esac
`, { mode: 0o700 });
    const result = spawnSync(process.execPath, [script], { encoding: 'utf8', env: {
      ...process.env, RUNNER_TEMP: dir, GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: '',
      TP_CLI: cli, TP_MODE: 'check', TP_CONFIG: 'parity.yaml', TP_FAIL: 'false', TP_BASELINE: baseline,
    } });
    assert.equal(result.status, 0, result.stderr);
    const entries = Object.fromEntries(readFileSync(output, 'utf8').trim().split('\n').map(line => line.split('=')));
    assert.equal(Number(entries.status), 1);
    const comparison = JSON.parse(readFileSync(join(entries.directory, 'baseline-comparison.json')));
    assert.deepEqual(comparison.regressions[0].lostCoverageLines, [1]);
    assert.match(readFileSync(join(entries.directory, 'report.md'), 'utf8'), /associated coverage lost on lines: 1/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

for (const [name, fail, jsonStatus, markdownStatus, expected] of [
  ['strict findings fail', 'true', 1, 1, 1],
  ['advisory findings pass', 'false', 1, 1, 0],
  ['advisory mode preserves operational errors', 'false', 1, 2, 1],
]) {
  test(name, () => {
    const dir = mkdtempSync(join(tmpdir(), 'testparity-test-'));
    try {
      const cli = join(dir, 'parity');
      const output = join(dir, 'output');
      writeFileSync(cli, `#!/bin/sh
case "$*" in
  *--format=json*--show-tests*) echo '{"passed":false,"structures":[]}'; exit ${jsonStatus} ;;
  *--format=github*) echo '## TestParity coverage'; exit ${markdownStatus} ;;
  *) exit 2 ;;
esac
`, { mode: 0o700 });
      const result = spawnSync(process.execPath, [script], {
        encoding: 'utf8',
        env: {
          ...process.env, RUNNER_TEMP: dir, GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: '',
          TP_CLI: cli, TP_MODE: 'check', TP_CONFIG: 'parity.yaml', TP_FAIL: fail, TP_SHOW_TESTS: 'true',
        },
      });
      assert.equal(result.status, 0, result.stderr);
      const entries = Object.fromEntries(readFileSync(output, 'utf8').trim().split('\n').map(line => line.split('=')));
      assert.equal(Number(entries.status), expected);
      assert.equal(readFileSync(join(entries.directory, 'report.md'), 'utf8').trim(), '## TestParity coverage');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

for (const [name, percent, expected] of [
  ['baseline unchanged gaps pass in advisory mode', '30%', 0],
  ['baseline improvement passes in advisory mode', '40%', 0],
  ['baseline regression overrides advisory mode', '20%', 1],
]) {
  test(name, () => {
    const dir = mkdtempSync(join(tmpdir(), 'testparity-baseline-'));
    try {
      const report = percentage => ({ passed: false, structures: [{ name: 'App', files: [{
        source: 'src/Payment.php', test: 'tests/PaymentTest.php', passed: false,
        rules: { 'matched-coverage': { passed: false, value: percentage } },
      }] }] });
      const cli = join(dir, 'parity');
      const baseline = join(dir, 'baseline.json');
      const output = join(dir, 'output');
      writeFileSync(baseline, JSON.stringify(report('30%')));
      writeFileSync(cli, `#!/bin/sh
case "$*" in
  *--format=json*) echo '${JSON.stringify(report(percent))}'; exit 1 ;;
  *--format=github*) echo '## TestParity coverage'; exit 1 ;;
  *) exit 2 ;;
esac
`, { mode: 0o700 });
      const result = spawnSync(process.execPath, [script], { encoding: 'utf8', env: {
        ...process.env, RUNNER_TEMP: dir, GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: '',
        TP_CLI: cli, TP_MODE: 'check', TP_CONFIG: 'parity.yaml', TP_FAIL: 'false', TP_BASELINE: baseline,
      } });
      assert.equal(result.status, 0, result.stderr);
      const entries = Object.fromEntries(readFileSync(output, 'utf8').trim().split('\n').map(line => line.split('=')));
      assert.equal(Number(entries.status), expected);
      assert.equal(JSON.parse(readFileSync(join(entries.directory, 'baseline-comparison.json'))).passed, expected === 0);
      assert.match(readFileSync(join(entries.directory, 'report.md'), 'utf8'), /Baseline regression gate/);
      assert.equal(JSON.parse(readFileSync(join(entries.directory, 'report.json'))).passed, false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
}
