import { appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const env = process.env;
if (!['true', 'false'].includes(env.TP_POST)) throw new Error('post-on-pr must be true or false.');
if (!/^[a-zA-Z0-9_.-]{1,64}$/.test(env.TP_COMMENT_KEY)) throw new Error('Invalid comment-key.');
const event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8'));
const pr = env.GITHUB_EVENT_NAME === 'pull_request' ? event.pull_request : null;
const sha = env.TP_CHECKOUT_SHA;
const trustedPR = pr && pr.head.repo?.full_name === env.GITHUB_REPOSITORY && env.GITHUB_ACTOR !== 'dependabot[bot]';
const branch = pr ? 'pull/' + pr.number : env.GITHUB_REF_TYPE === 'branch' ? env.GITHUB_REF_NAME : null;
const data = name => readFileSync(join(env.TP_DIRECTORY, name), 'utf8');

async function upload() {
  const target = URL.parse(env.TP_HOSTED_URL);
  const path = /^\/api\/v1\/projects\/([a-f0-9-]{36})\/runs$/.exec(target?.pathname ?? '');
  if (target?.protocol !== 'https:' || target.username || target.password || !path) {
    throw new Error('hosted-url must be the HTTPS upload endpoint from project settings.');
  }
  target.search = new URLSearchParams({ details: '1' });
  if (pr) {
    target.searchParams.set('base_branch', pr.base.ref);
    target.searchParams.set('base_sha', pr.base.sha);
  }
  const request = {
    method: 'POST', redirect: 'error',
    headers: { Authorization: 'Bearer ' + env.TP_HOSTED_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ version: 1, branch, sha, report: JSON.parse(data('report.json')) }),
  };
  let response;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      response = await fetch(target, { ...request, signal: AbortSignal.timeout(15_000) });
      if (response.ok || ![408, 429, 500, 502, 503, 504].includes(response.status) || attempt === 2) break;
      await response.body?.cancel();
    } catch {
      if (attempt === 2) throw new Error('Could not reach the TestParity upload endpoint.');
    }
    await delay(1000 * (attempt + 1));
  }
  if (!response.ok) throw new Error('TestParity upload failed with HTTP ' + response.status + '.');
  const result = await response.json();
  if (!Number.isSafeInteger(result.id) || result.id < 1) throw new Error('TestParity upload returned an invalid run ID.');
  const shared = result.reportPath?.startsWith('/reports/' + path[1] + '?');
  const reportUrl = new URL((shared ? '/reports/' : '/projects/') + path[1], target);
  reportUrl.search = new URLSearchParams({ branch, run: String(result.id) });
  appendFileSync(env.GITHUB_OUTPUT, `report-url=${reportUrl.href}\n`);
  return { url: reportUrl.href, comparison: result.comparison };
}

function comparisonLine(comparison) {
  if (!comparison) return 'No hosted run is available for the exact target commit, or the platform does not support this comparison yet.';
  if (!comparison.compared) return 'The two runs have no matching files with gap data.';
  const delta = comparison.meanDelta;
  return `Average gap change: **${delta > 0 ? '+' : ''}${delta} percentage points** across ${comparison.compared} matching files (${comparison.widened} widened, ${comparison.narrowed} narrowed).`;
}

async function comment(hosted) {
  const root = `/repos/${env.GITHUB_REPOSITORY}`;
  const api = async (path, method = 'GET', body) => {
    const response = await fetch(env.GITHUB_API_URL + root + path, {
      method, redirect: 'error', signal: AbortSignal.timeout(15_000),
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: 'Bearer ' + env.TP_GITHUB_TOKEN,
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify({ body }),
    });
    if (!response.ok) throw new Error('GitHub API returned HTTP ' + response.status + '. Check pull-requests: write permissions.');
    return response.json();
  };
  const marker = `<!-- testparity-coverage:${env.TP_COMMENT_KEY} -->`;
  const links = hosted ? `\n\n[Open the hosted report](${hosted.url})\n\n${comparisonLine(hosted.comparison)}` : '';
  const heading = '## TestParity coverage';
  const report = marker + '\n' + data('report.md') + links;
  const body = Buffer.byteLength(report) <= 65_000 ? report
    : marker + '\n' + heading + `\n\nThe report exceeds GitHub’s comment size limit.` + links;

  const endpoint = `/issues/${pr.number}/comments`;
  let existing;
  for (let page = 1; ; page++) {
    const comments = await api(`${endpoint}?per_page=100&page=${page}`);
    existing = comments.find(item => item.user?.login === 'github-actions[bot]' && (
      item.body?.startsWith(marker) ||
      (env.TP_COMMENT_KEY === 'default' && item.body?.startsWith('<!-- testparity-coverage -->'))
    ));
    if (existing || comments.length < 100) break;
  }
  if ((await api(`/pulls/${pr.number}`)).head.sha !== pr.head.sha) return;
  if (existing) await api(`/issues/comments/${existing.id}`, 'PATCH', body);
  else await api(endpoint, 'POST', body);
}

const publishingAllowed = env.GITHUB_EVENT_NAME === 'push' || trustedPR;
const hosted = env.TP_HOSTED_TOKEN && publishingAllowed && branch ? await upload() : null;
if (env.TP_POST === 'true' && trustedPR) await comment(hosted);
