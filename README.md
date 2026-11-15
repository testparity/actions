# TestParity GitHub Action

Run TestParity in an existing workflow after checkout and after setting up your project's test runner. The action uses Node.js 22+ and PHP 8.4+ to run the CLI. It downloads the pinned TestParity PHAR and verifies its release checksum, unless you pass an installed executable with `cli`.

```yaml
name: TestParity
on:
  push:
    branches: [main]
  pull_request:

permissions:
  contents: read
  pull-requests: write

jobs:
  coverage:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: shivammathur/setup-php@v2
        with:
          php-version: '8.4'
      # Install your project's test dependencies here.
      - uses: testparity/actions@v1
```

The action runs the test command from `parity.yaml` to generate per-test coverage. Use `mode: check` if your workflow already generates coverage. Failed parity checks still produce a report and fail the workflow. PR commenting is on by default for same-repository PRs and updates a single comment. To turn it off, set `post-on-pr: 'false'`.

## Hosted reports

Copy the upload URL from TestParity project settings to the `TESTPARITY_UPLOAD_URL` GitHub Actions variable and store the project token as the `TESTPARITY_UPLOAD_TOKEN` secret. Replace the action step with:

```yaml
- uses: testparity/actions@v1
  id: testparity
  with:
    hosted-url: ${{ vars.TESTPARITY_UPLOAD_URL }}
    hosted-token: ${{ secrets.TESTPARITY_UPLOAD_TOKEN }}
```

Pushes upload under the branch name. PR uploads use `pull/<number>` and record the commit actually checked out by the workflow. PR comments link directly to the uploaded run, and the link is available as `steps.testparity.outputs.report-url`. Links are public only for projects with public reports enabled. If the token is omitted, the check and PR comment still work without hosted publishing.

### Compare the gap against the PR target

1. Generate full-suite Clover XML in both the target branch and PR workflows.
2. Add `suite-coverage: coverage.xml` and point `cli` at an executable that supports `parity check --format=json --suite-coverage=...`. This capability is in [CLI PR #6](https://github.com/testparity/cli/pull/6) and is absent from the default v1.4.1 PHAR.
3. Run both workflows against the same hosted project on a platform release with action comparison support. The target branch must upload the exact base commit shown on the PR. The comment reports the mean percentage-point change and file counts by direction across comparable files. A missing base or missing gap data is shown explicitly.

## Inputs

| Input | Default | Purpose |
| --- | --- | --- |
| `mode` | `test` | Generate per-test coverage before checking, or use `check` for existing artifacts. |
| `config` | `parity.yaml` | Project configuration file. |
| `working-directory` | `.` | Directory used for tests and checks. |
| `cli` | v1.4.1 PHAR | An installed executable or path relative to the working directory. |
| `suite-coverage` | | Full-suite Clover XML file path. |
| `post-on-pr` | `true` | Set to `false` to skip the comment. |
| `comment-key` | `default` | Set a different key per project if several action steps post on the same PR. |
| `hosted-url` | | HTTPS project upload endpoint. |
| `hosted-token` | | Project CI token from GitHub Actions secrets. |

Fork and Dependabot PRs run the check without uploading or commenting. Use the `pull_request` event. See [GitHub's workflow permissions documentation](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#permissions).
