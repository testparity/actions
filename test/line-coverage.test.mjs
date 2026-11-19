import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { compareBaseline, baselineMarkdown } from '../baseline.mjs';

const hash = text => createHash('sha256').update(text).digest('hex');
function file(lines, executableLines, coveredLines, percent = '50%') {
  return { source: 'src/Payment.php', test: 'tests/PaymentTest.php', passed: false, rules: { 'matched-coverage': { passed: false, value: percent } }, lineCoverage: { version: 1, complete: true, sourceHash: hash(lines.join('\n')), lineHashes: lines.map(hash), executableLines, coveredLines } };
}
const report = (...files) => ({ passed: false, structures: [{ name: 'App', files }] });
const compare = (old, current) => compareBaseline(report(old), report(current));

test('equal percentage cannot hide coverage moving to another line', () => {
  const result = compare(file(['a', 'b'], [1, 2], [1]), file(['a', 'b'], [1, 2], [2]));
  assert.equal(result.passed, false);
  assert.deepEqual(result.regressions[0].lostCoverageLines, [1]);
  assert.match(baselineMarkdown(result), /associated coverage lost on lines: 1/);
});
test('a percentage improvement cannot hide an old covered line being lost', () => {
  const result = compare(file(['a', 'b'], [1, 2], [1]), file(['a', 'b', 'c', 'd'], [1, 2, 3, 4], [2, 3, 4], '75%'));
  assert.equal(result.passed, false);
  assert.deepEqual(result.regressions[0].lostCoverageLines, [1]);
});
test('added non-executable lines shift both coverage and historical gaps safely', () => {
  const result = compare(file(['open', 'a', 'b', 'close'], [2, 3], [2]), file(['comment', 'open', 'a', 'b', 'close'], [3, 4], [3]));
  assert.equal(result.passed, true);
  assert.equal(result.comparisons[0].mode, 'line');
});
test('new uncovered executable lines fail while existing gaps are tolerated', () => {
  assert.equal(compare(file(['a', 'b'], [1, 2], [1]), file(['a', 'b'], [1, 2], [1])).passed, true);
  const result = compare(file(['a', 'b'], [1, 2], [1]), file(['a', 'b', 'c'], [1, 2, 3], [1], '50%'));
  assert.deepEqual(result.regressions[0].newlyUncoveredLines, [3]);
});
test('new files must cover every executable line regardless of configured threshold', () => {
  const newFile = file(['a', 'b'], [1, 2], [1]);
  newFile.passed = true; newFile.rules['matched-coverage'].passed = true;
  const result = compareBaseline(report(), report(newFile));
  assert.equal(result.passed, false);
  assert.deepEqual(result.regressions[0].newlyUncoveredLines, [2]);
});
test('deleted lines are allowed; an unchanged executable line cannot disappear from evidence', () => {
  assert.equal(compare(file(['a', 'b', 'c'], [1, 2, 3], [1, 3]), file(['a', 'b'], [1, 2], [1], '66%')).passed, true);
  const result = compare(file(['a', 'b'], [1, 2], [1]), file(['a', 'b'], [2], [2], '100%'));
  assert.deepEqual(result.regressions[0].removedExecutableLines, [1]);
});
test('duplicate statements cannot conceal lost coverage after a deletion', () => {
  const result = compare(file(['same', 'same'], [1, 2], [1]), file(['same'], [1], [], '50%'));
  assert.equal(result.passed, false);
  assert.deepEqual(result.regressions[0].ambiguousLines, [1]);
  // If every possible old counterpart was an existing uncovered gap, it is safe.
  assert.equal(compare(file(['same', 'same'], [1, 2], []), file(['same'], [1], [])).passed, true);
});
test('identical duplicate-containing files still compare by line number', () => {
  assert.equal(compare(file(['same', 'same'], [1, 2], [1]), file(['same', 'same'], [1, 2], [1])).passed, true);
});
test('legacy reports explicitly use percentage mode; enriched baseline cannot downgrade', () => {
  const old = file(['a'], [1], [1]); delete old.lineCoverage;
  const current = file(['a'], [1], [1]);
  const mixed = compare(old, current);
  assert.equal(mixed.passed, true);
  assert.equal(mixed.comparisons[0].mode, 'percentage');
  assert.match(baselineMarkdown(mixed), /Percentage-only comparison/);
  assert.match(compare(current, old).regressions[0].reasons.join(), /line coverage evidence removed/);
});
test('incomplete line evidence fails explicitly rather than falling back', () => {
  const incomplete = file(['a'], [1], [1]); incomplete.lineCoverage = { version: 1, complete: false, reason: 'Coverage lacks executable lines.' };
  assert.match(compare(incomplete, file(['a'], [1], [1])).regressions[0].reasons.join(), /baseline line coverage incomplete/);
  assert.match(compare(file(['a'], [1], [1]), incomplete).regressions[0].reasons.join(), /current line coverage incomplete/);
});
test('malformed line evidence rejects invalid versions, hashes, sets and subset violations', () => {
  for (const mutate of [v => v.version = 2, v => v.complete = 'true', v => v.sourceHash = 'x', v => v.lineHashes = ['x'], v => v.executableLines = [1, 1], v => v.executableLines = [2, 1], v => v.executableLines = [0], v => v.coveredLines = [2], v => v.coveredLines = [1.5]]) {
    const current = file(['a', 'b'], [1], [1]); mutate(current.lineCoverage);
    assert.throws(() => compare(file(['a', 'b'], [1], [1]), current));
  }
});
test('large changed source cannot silently skip alignment', () => {
  const lines = Array.from({ length: 2_001 }, (_, i) => String(i));
  const result = compare(file(lines, [1], [1]), file(['insert', ...lines], [2], [2]));
  assert.equal(result.passed, false);
  assert.equal(result.comparisons[0].mode, 'unavailable');
  assert.match(result.regressions[0].reasons.join(), /safe comparison limit/);
});
test('empty source has valid complete empty line evidence', () => {
  assert.equal(compare(file([], [], [], '-'), file([], [], [], '-')).passed, true);
});
