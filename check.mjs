import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const env = process.env;
if (env.GITHUB_EVENT_NAME === 'pull_request_target') {
  throw new Error('Use the pull_request event for TestParity.');
}
const directory = mkdtempSync(join(env.RUNNER_TEMP, 'testparity-'));
const mode = env.TP_MODE;
if (!['test', 'check'].includes(mode)) throw new Error('mode must be test or check.');
const config = '--config=' + env.TP_CONFIG;
const coverage = env.TP_SUITE ? ['--suite-coverage=' + env.TP_SUITE] : [];
const sha = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout?.trim();
if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(sha ?? '')) throw new Error('Check out the repository first.');

let executable = env.TP_CLI;
let prefix = [];
if (!executable) {
  const assets = 'https://github.com/testparity/cli/releases/download/v1.4.1/';
  const download = async name => {
    const response = await fetch(assets + name, { signal: AbortSignal.timeout(60_000) });
    if (!response.ok) throw new Error('Could not download TestParity release asset: ' + name);
    return response;
  };
  const [binary, checksum] = await Promise.all([download('parity.phar'), download('parity.phar.sha256')]);
  const contents = Buffer.from(await binary.arrayBuffer());
  if (createHash('sha256').update(contents).digest('hex') !== (await checksum.text()).trim().split(/\s+/)[0]) {
    throw new Error('TestParity release checksum did not match.');
  }
  const phar = join(directory, 'parity.phar');
  writeFileSync(phar, contents);
  executable = 'php';
  prefix = [phar];
}

function run(args, capture = true) {
  const result = spawnSync(executable, [...prefix, ...args], {
    encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
    stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status === null) throw new Error('The TestParity process did not complete.');
  return result;
}

if (mode === 'test' && run(['test', config, '--no-check'], false).status !== 0) {
  throw new Error('TestParity could not generate per-test coverage.');
}

const tests = env.TP_SHOW_TESTS === 'true' ? ['--show-tests'] : [];
const json = run(['check', config, '--format=json', ...tests, ...(env.TP_HOSTED === 'true' ? coverage : [])]);
let report;
try { report = JSON.parse(json.stdout); } catch {
  throw new Error('TestParity did not produce JSON. Check the configuration and use a CLI that supports JSON suite coverage when hosting gaps.');
}
if (typeof report.passed !== 'boolean' || !Array.isArray(report.structures)) throw new Error('Invalid TestParity JSON report.');
const markdown = run(['check', config, '--format=github', ...coverage]);
if (!markdown.stdout.startsWith('## TestParity coverage')) throw new Error('TestParity did not produce a GitHub report.');

writeFileSync(join(directory, 'report.json'), JSON.stringify(report));
writeFileSync(join(directory, 'report.md'), markdown.stdout);
if (env.GITHUB_STEP_SUMMARY && Buffer.byteLength(markdown.stdout) <= 950_000) {
  appendFileSync(env.GITHUB_STEP_SUMMARY, markdown.stdout + '\n');
}
const status = json.status || markdown.status || Number(!report.passed);
const advisoryFinding = env.TP_FAIL === 'false' && !report.passed && json.status === 1 && markdown.status === 1;
appendFileSync(env.GITHUB_OUTPUT, `directory=${directory}\nsha=${sha}\nstatus=${advisoryFinding ? 0 : status}\n`);
