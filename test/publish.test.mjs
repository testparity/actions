import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

for (const scenario of ['same repository', 'fork', 'posting disabled']) {
  test(scenario, t => {
    const directory = mkdtempSync(join(tmpdir(), 'testparity-action-'));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const sha = 'b'.repeat(40);
    const project = '12345678-1234-1234-1234-123456789012';
    const event = join(directory, 'event.json');
    const output = join(directory, 'output');
    writeFileSync(event, JSON.stringify({ pull_request: {
      number: 5,
      head: { sha, repo: { full_name: scenario === 'fork' ? 'fork/repo' : 'owner/repo' } },
      base: { ref: 'main', sha: 'a'.repeat(40) },
    } }));
    writeFileSync(join(directory, 'report.md'), '## TestParity coverage');
    writeFileSync(join(directory, 'report.json'), '{"passed":true,"structures":[]}');
    writeFileSync(output, '');
    const mock = `
      import assert from 'node:assert/strict';
      globalThis.fetch = async (input, options) => {
        const url = new URL(input);
        assert.notEqual(${JSON.stringify(scenario)}, 'fork');
        if (url.hostname === 'testparity.example') {
          assert.equal(options.method, 'POST');
          assert.equal(options.redirect, 'error');
          assert.equal(url.searchParams.get('base_branch'), 'main');
          assert.equal(url.searchParams.get('base_sha'), 'a'.repeat(40));
          assert.equal(JSON.parse(options.body).branch, 'pull/5');
          assert.equal(JSON.parse(options.body).sha, '${sha}');
          return Response.json({ id: 10, reportPath: '/reports/${project}?branch=pull%2F5&run=10',
            comparison: { compared: 2, meanDelta: -3, widened: 0, narrowed: 2 } });
        }
        assert.notEqual(${JSON.stringify(scenario)}, 'posting disabled');
        if (url.pathname.endsWith('/pulls/5')) return Response.json({head:{sha:'${sha}'}});
        if (options.method === 'GET') return Response.json([{id:8,user:{login:'github-actions[bot]'},body:'<!-- testparity-coverage:default -->'}]);
        assert.equal(options.method, 'PATCH');
        assert.match(url.pathname, /comments\\/8$/);
        assert.match(JSON.parse(options.body).body, /Average gap change: \\*\\*-3 percentage points/);
        assert.match(JSON.parse(options.body).body, /Open the hosted report/);
        return Response.json({});
      };
    `;
    const result = spawnSync(process.execPath, ['--import', 'data:text/javascript,' + encodeURIComponent(mock), 'publish.mjs'], {
      encoding: 'utf8',
      env: {
        ...process.env, GITHUB_EVENT_NAME: 'pull_request', GITHUB_EVENT_PATH: event,
        GITHUB_REPOSITORY: 'owner/repo', GITHUB_OUTPUT: output, GITHUB_API_URL: 'https://api.github.com',
        GITHUB_ACTOR: 'owner', TP_DIRECTORY: directory, TP_CHECKOUT_SHA: sha, TP_COMMENT_KEY: 'default',
        TP_POST: String(scenario !== 'posting disabled'),
        TP_HOSTED_URL: 'https://testparity.example/api/v1/projects/' + project + '/runs',
        TP_HOSTED_TOKEN: 'upload-token', TP_GITHUB_TOKEN: 'github-token',
      },
    });
    assert.equal(result.status, 0, result.stderr);
    const outputs = readFileSync(output, 'utf8');
    if (scenario === 'fork') assert.equal(outputs, '');
    else assert.equal(outputs, `report-url=https://testparity.example/reports/${project}?branch=pull%2F5&run=10\n`);
  });
}
