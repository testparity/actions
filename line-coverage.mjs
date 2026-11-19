// Line hashes identify unchanged source without putting source code in reports.
const digest = /^[a-f0-9]{64}$/;
const MAX_ALIGNMENT_CELLS = 4_000_000;

export function validateLineCoverage(value) {
  if (value === undefined) return undefined;
  if (!value || value.version !== 1 || typeof value.complete !== 'boolean') throw new Error('Invalid line coverage evidence.');
  if (!value.complete) {
    if (typeof value.reason !== 'string' || !value.reason.trim()) throw new Error('Incomplete line coverage requires a reason.');
    return value;
  }
  if (!digest.test(value.sourceHash ?? '') || !Array.isArray(value.lineHashes) || !value.lineHashes.every(hash => typeof hash === 'string' && digest.test(hash))) throw new Error('Invalid source line identities.');
  for (const field of ['executableLines', 'coveredLines']) {
    if (!Array.isArray(value[field]) || value[field].some((line, i, lines) => !Number.isSafeInteger(line) || line < 1 || line > value.lineHashes.length || (i > 0 && line <= lines[i - 1]))) throw new Error('Invalid executable or covered source lines.');
  }
  const executable = new Set(value.executableLines);
  if (value.coveredLines.some(line => !executable.has(line))) throw new Error('Covered source lines must be executable.');
  return value;
}

// Return all possible old counterparts in an optimal unchanged-line alignment.
// An ambiguous line is never automatically exempted as an historical gap.
function align(old, current) {
  if (old.length === current.length && old.every((hash, i) => hash === current[i])) {
    return current.map((_, i) => ({ candidates: [i + 1], unmatched: false }));
  }
  const width = current.length + 1;
  const cells = (old.length + 1) * width;
  if (cells > MAX_ALIGNMENT_CELLS) throw new Error('Source line alignment exceeds the safe comparison limit.');
  const forward = new Uint32Array(cells);
  const backward = new Uint32Array(cells);
  for (let i = 0; i < old.length; i++) {
    for (let j = 0; j < current.length; j++) {
      forward[(i + 1) * width + j + 1] = old[i] === current[j] ? forward[i * width + j] + 1 : Math.max(forward[i * width + j + 1], forward[(i + 1) * width + j]);
    }
  }
  for (let i = old.length - 1; i >= 0; i--) {
    for (let j = current.length - 1; j >= 0; j--) {
      backward[i * width + j] = old[i] === current[j] ? backward[(i + 1) * width + j + 1] + 1 : Math.max(backward[(i + 1) * width + j], backward[i * width + j + 1]);
    }
  }
  const length = forward[cells - 1];
  return current.map((hash, j) => {
    const candidates = [];
    let unmatched = false;
    for (let i = 0; i <= old.length; i++) {
      if (forward[i * width + j] + backward[i * width + j + 1] === length) unmatched = true;
      if (i < old.length && old[i] === hash && forward[i * width + j] + 1 + backward[(i + 1) * width + j + 1] === length) candidates.push(i + 1);
    }
    return { candidates, unmatched };
  });
}

export function compareLines(before, current) {
  const reasons = [];
  const details = { lostCoverageLines: [], newlyUncoveredLines: [], ambiguousLines: [], removedExecutableLines: [] };
  if (before?.complete === false) reasons.push('baseline line coverage incomplete: ' + before.reason);
  if (current?.complete === false) reasons.push('current line coverage incomplete: ' + current.reason);
  if (before?.complete && !current) reasons.push('line coverage evidence removed');
  if (reasons.length) return { mode: 'unavailable', reasons, ...details };
  if (!current) return { mode: 'percentage', reasons, ...details };
  if (before === undefined) return { mode: 'percentage', reasons, ...details };
  if (before === null) {
    details.newlyUncoveredLines = current.executableLines.filter(line => !current.coveredLines.includes(line));
  } else {
    if (before.sourceHash === current.sourceHash && (before.lineHashes.length !== current.lineHashes.length || before.lineHashes.some((hash, i) => hash !== current.lineHashes[i]))) throw new Error('Conflicting line identities for the same source hash.');
    let mapping;
    try { mapping = align(before.lineHashes, current.lineHashes); } catch (error) {
      return { mode: 'unavailable', reasons: [error.message], ...details };
    }
    const oldExecutable = new Set(before.executableLines);
    const oldCovered = new Set(before.coveredLines);
    const executable = new Set(current.executableLines);
    const covered = new Set(current.coveredLines);
    for (let j = 0; j < mapping.length; j++) {
      const line = j + 1;
      const { candidates, unmatched } = mapping[j];
      if (!executable.has(line)) {
        if (!unmatched && candidates.some(oldLine => oldExecutable.has(oldLine))) details.removedExecutableLines.push(line);
        continue;
      }
      if (covered.has(line)) continue;
      if (candidates.length === 0) details.newlyUncoveredLines.push(line);
      else if (unmatched || candidates.length > 1) {
        // Only certain historical uncovered executable statements are exempt.
        if (unmatched || candidates.some(oldLine => !oldExecutable.has(oldLine) || oldCovered.has(oldLine))) details.ambiguousLines.push(line);
      } else if (!oldExecutable.has(candidates[0])) details.newlyUncoveredLines.push(line);
      else if (oldCovered.has(candidates[0])) details.lostCoverageLines.push(line);
    }
  }
  for (const [field, label] of [['lostCoverageLines', 'associated coverage lost on lines'], ['newlyUncoveredLines', 'new executable lines uncovered'], ['ambiguousLines', 'uncovered lines have ambiguous source alignment'], ['removedExecutableLines', 'executable line evidence removed on lines']]) {
    if (details[field].length) reasons.push(label + ': ' + details[field].join(', '));
  }
  return { mode: 'line', reasons, ...details };
}
