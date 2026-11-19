import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import test from 'node:test';

const script = fileURLToPath(new URL('../check.mjs', import.meta.url));

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
