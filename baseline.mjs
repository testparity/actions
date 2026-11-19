import { validateLineCoverage, compareLines } from './line-coverage.mjs';

// Compare attribution evidence and rule states, never executable baseline code.
export function compareBaseline(baseline, current, sourceExists = () => true) {
  function index(report) {
    if (!report || typeof report.passed !== 'boolean' || !Array.isArray(report.structures)) throw new Error('Invalid baseline comparison report.');
    const files = new Map();
    for (const structure of report.structures) {
      if (typeof structure.name !== 'string' || !Array.isArray(structure.files)) throw new Error('Invalid comparison structure.');
      for (const file of structure.files) {
        if (typeof file.source !== 'string' || !file.source || typeof file.test !== 'string' || typeof file.passed !== 'boolean' || !file.rules || Array.isArray(file.rules) || typeof file.rules !== 'object') throw new Error('Invalid comparison file.');
        const key = JSON.stringify([structure.name, file.source]);
        if (files.has(key)) throw new Error('Duplicate comparison source.');
        for (const rule of Object.values(file.rules)) {
          if (!rule || typeof rule.passed !== 'boolean') throw new Error('Invalid comparison rule.');
        }
        const matched = file.rules['matched-coverage'];
        let percentage = null;
        if (matched) {
          if (typeof matched.value === 'string' && /^(?:100(?:\.0+)?|\d{1,2}(?:\.\d+)?)%$/.test(matched.value)) percentage = Number(matched.value.slice(0, -1));
          else if (matched.value !== '-') throw new Error('Invalid associated coverage percentage.');
        }
        files.set(key, { ...file, percentage, lineCoverage: validateLineCoverage(file.lineCoverage) });
      }
    }
    return files;
  }
  const previous = index(baseline);
  const next = index(current);
  const regressions = [];
  const comparisons = [];
  if (baseline.passed && !current.passed) regressions.push({ source: '(report)', reasons: ['new report-level failure'] });
  for (const [key, file] of previous) {
    if (!next.has(key) && sourceExists(file.source)) regressions.push({ source: file.source, reasons: ['existing source removed from comparison'] });
  }
  for (const [key, file] of next) {
    const before = previous.get(key);
    const reasons = [];
    const lineComparison = compareLines(before ? before.lineCoverage : null, file.lineCoverage);
    comparisons.push({ source: file.source, ...lineComparison });
    reasons.push(...lineComparison.reasons);
    for (const [name, rule] of Object.entries(file.rules)) {
      if (!rule.passed && before?.rules[name]?.passed !== false) reasons.push(`new failure: ${name}`);
    }
    if (!file.passed && (!before || before.passed) && reasons.length === 0) reasons.push('new failed check');
    if (before?.percentage !== null && before?.percentage !== undefined) {
      if (file.percentage === null) reasons.push('associated coverage evidence removed');
      else if (file.percentage < before.percentage) reasons.push(`associated coverage decreased: ${before.percentage}% → ${file.percentage}%`);
    }
    if (before) {
      for (const name of Object.keys(before.rules)) {
        if (!(name in file.rules)) reasons.push(`comparison rule removed: ${name}`);
      }
    }
    if (reasons.length) regressions.push({ source: file.source, reasons, ...Object.fromEntries(Object.entries(lineComparison).filter(([key]) => key.endsWith('Lines'))) });
  }
  return { passed: regressions.length === 0, regressions, comparisons };
}

export function baselineMarkdown(result) {
  const lines = ['### Baseline regression gate', '', result.passed ? '**Passed:** no new coverage regressions.' : '**Failed:** coverage regressed against the baseline.'];
  const fallback = result.comparisons?.filter(item => item.mode === 'percentage') ?? [];
  if (fallback.length) lines.push('', `Percentage-only comparison for ${fallback.length} file(s): the baseline or current report has no line-level evidence. Equal percentages cannot establish line-level coverage.`);
  // Escape baseline-derived text rather than interpreting it as Markdown/HTML.
  const escape = value => String(value).replace(/[&<>|`@\[\]*_!\\\r\n]/g, char => /[\r\n]/.test(char) ? ' ' : `&#${char.charCodeAt(0)};`);
  for (const item of result.regressions) lines.push(`- <code>${escape(item.source)}</code>: ${item.reasons.map(escape).join('; ')}`);
  return lines.join('\n');
}
