import assert from 'node:assert/strict';
import test from 'node:test';
import { compareBaseline, baselineMarkdown } from '../baseline.mjs';
const file = (percent = '30%', exists = true) => ({ source: 'src/Payment.php', test: 'tests/PaymentTest.php', passed: false, rules: {
  'matched-coverage': { passed: false, value: percent },
  'test-exists': { passed: exists, value: exists ? 'Y' : 'N' },
} });
const report = (...files) => ({ passed: false, structures: [{ name: 'App', files }] });
test('unchanged pre-existing failures are tolerated', () => {
  assert.equal(compareBaseline(report(file()), report(file())).passed, true);
});
test('coverage improvements pass even below the configured minimum', () => {
  assert.equal(compareBaseline(report(file()), report(file('40%'))).passed, true);
});
test('coverage decrease fails even when matched rule already failed', () => {
  assert.match(compareBaseline(report(file()), report(file('29%'))).regressions[0].reasons[0], /decreased/);
});
test('losing a test fails and removing evidence cannot conceal it', () => {
  const result = compareBaseline(report(file()), report(file('-', false)));
  assert.equal(result.passed, false);
  assert.deepEqual(result.regressions[0].reasons, ['new failure: test-exists', 'associated coverage evidence removed']);
});
test('new source or structure with findings fails; new clean source passes', () => {
  assert.equal(compareBaseline(report(), report(file())).passed, false);
  const clean = file('100%');
  clean.passed = true;
  clean.rules['matched-coverage'].passed = true;
  assert.equal(compareBaseline(report(), report(clean)).passed, true);
  const renamed = report(file()); renamed.structures[0].name = 'New';
  assert.equal(compareBaseline(report(file()), renamed).passed, false);
});
test('deleted source is allowed; renamed clean source is allowed', () => {
  assert.equal(compareBaseline(report(file()), report(), () => false).passed, true);
  const clean = file('100%'); clean.source = 'src/Renamed.php'; clean.passed = true; clean.rules['matched-coverage'].passed = true;
  assert.equal(compareBaseline(report(file()), report(clean), () => false).passed, true);
});
test('removed rules and malformed/duplicate baselines fail closed', () => {
  const changed = file(); delete changed.rules['test-exists'];
  assert.equal(compareBaseline(report(file()), report(changed)).passed, false);
  for (const invalid of [{}, report(file(), file()), report(file('NaN%')), report({ source: 'x' })]) {
    assert.throws(() => compareBaseline(invalid, report(file())));
  }
});
test('report escapes repository controlled text', () => {
  const markdown = baselineMarkdown({ passed: false, regressions: [{ source: '<img>\n`|@user[x](y)*_!\\', reasons: ['<script>'] }] });
  assert.doesNotMatch(markdown, /<img>|<script>|@user|\[x\]|\*_!/);
  assert.match(markdown, /&#64;user&#91;x&#93;/);
});
test('decimal percentages compare numerically', () => {
  assert.equal(compareBaseline(report(file('30.25%')), report(file('30.24%'))).passed, false);
});
test('existing source omitted from configured structures fails', () => {
  assert.equal(compareBaseline(report(file()), report(), () => true).passed, false);
});
test('new report-level failure cannot hide behind unchanged file rules', () => {
  const base = report(); base.passed = true;
  assert.equal(compareBaseline(base, report()).passed, false);
});
