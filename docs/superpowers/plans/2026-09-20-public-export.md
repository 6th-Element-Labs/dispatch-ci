# Public Export and Repository Hygiene Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a clean, buildable, tested public source snapshot from the private Dispatch repository without copying private planning, private CI, credentials, local data, or machine-specific paths.

**Architecture:** Private-side Node scripts export a Git ref through an explicit JSON allowlist into a temporary staging tree, overlay public-only root files, scan the result, and only then update a clean public checkout. Public tests and workflows live under `deploy/public/` in the private repo and are mapped to their public-root destinations.

**Tech Stack:** Node 22 ESM, `node:test`, Bash, npm lockfiles, Cargo metadata, Git, GitHub Actions

## Global Constraints

- Private canonical remains authoritative.
- Public source updates only for releases.
- The public tree includes product source, required build files, tests, and public CI.
- Exclude `docs/superpowers`, `.superpowers`, `AGENTS.md`, private CI sandbox files, local data, build output, and every `node_modules` path.
- Do not copy and then sanitize the private tree. Copy only manifest entries.
- Apache License 2.0; copyright Steven Ridder.
- Public issues are accepted. Public pull requests are not accepted.
- Package `"private": true` fields remain.
- Export failure must not modify the public checkout.
- Keep all signing, notarization, updater, and repository-rename work out of this package.

---

## File map

- Create: `deploy/public-export-manifest.json` — source-to-public copy contract
- Create: `deploy/public-license-policy.json` — approved SPDX expressions and explicit overrides
- Create: `deploy/public/README.md` — public root README
- Create: `deploy/public/CONTRIBUTING.md` — issue and pull-request policy
- Create: `deploy/public/SECURITY.md` — private vulnerability reporting policy
- Create: `deploy/public/.github/ISSUE_TEMPLATE/bug_report.yml`
- Create: `deploy/public/.github/ISSUE_TEMPLATE/feature_request.yml`
- Create: `deploy/public/.github/ISSUE_TEMPLATE/config.yml`
- Create: `deploy/public/.github/workflows/verify.yml` — direct public CI
- Create: `LICENSE` — Apache License 2.0
- Create: `NOTICE` — Steven Ridder copyright notice
- Create: `scripts/public-export-lib.mjs` — manifest copy, version, path, and secret validation
- Create: `scripts/export-public-release.mjs` — private-side export CLI
- Create: `scripts/public-export.test.mjs` — unit and fixture tests
- Create: `scripts/check-dependency-licenses.mjs` — npm/Cargo license policy and notices
- Create: `scripts/check-dependency-licenses.test.mjs`
- Create: `scripts/verify-public-export.sh` — end-to-end dry-run gate
- Create: `docs/assets/dispatch-screenshot.png` — synthetic-mail public screenshot
- Modify: `.gitignore` — public export and release work directories
- Modify: `scripts/dispatch_ci.sh` — run private-side export and license unit tests
- Delete from Git tracking: `apps/desktop/node_modules`, `services/web/node_modules`, `services/mail/node_modules`, `services/agent/node_modules`

---

### Task 1: Remove machine-specific dependency symlinks

**Files:**
- Delete from Git tracking: `apps/desktop/node_modules`
- Delete from Git tracking: `services/web/node_modules`
- Delete from Git tracking: `services/mail/node_modules`
- Delete from Git tracking: `services/agent/node_modules`
- Modify: `.gitignore`
- Test: `scripts/public-export.test.mjs`

**Interfaces:**
- Consumes: existing npm lockfiles
- Produces: a clone that installs dependencies only with `npm ci`

- [ ] **Step 1: Write the failing symlink hygiene test**

Create `scripts/public-export.test.mjs`:

```js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')

describe('private tree hygiene', () => {
  it('does not track or require node_modules links', async () => {
    const tracked = execFileSync('git', ['ls-files', '-s'], { cwd: root, encoding: 'utf8' })
    assert.doesNotMatch(tracked, /^120000 .*\s(?:apps\/desktop|services\/(?:web|mail|agent))\/node_modules$/m)
  })
})
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
node --test scripts/public-export.test.mjs
```

Expected: FAIL because the four tracked paths exist as symlinks.

- [ ] **Step 3: Remove the links from Git and strengthen ignore rules**

Run:

```bash
git rm apps/desktop/node_modules services/web/node_modules services/mail/node_modules services/agent/node_modules
```

Ensure root `.gitignore` contains:

```gitignore
node_modules/
.public-export/
.public-release/
```

- [ ] **Step 4: Verify fresh dependency installation**

Run:

```bash
for dir in services/web services/mail services/agent apps/desktop; do
  npm --prefix "$dir" ci --prefer-offline --no-audit --no-fund
done
node --test scripts/public-export.test.mjs
```

Expected: npm installs from lockfiles and the hygiene test passes after generated `node_modules` directories are ignored.

- [ ] **Step 5: Commit**

```bash
git add .gitignore scripts/public-export.test.mjs
git commit -m "chore: remove machine-specific dependency links"
```

---

### Task 2: Add Apache licensing and public policy files

**Files:**
- Create: `LICENSE`
- Create: `NOTICE`
- Create: `deploy/public/README.md`
- Create: `deploy/public/SECURITY.md`
- Create: `deploy/public/CONTRIBUTING.md`
- Create: `deploy/public/.github/ISSUE_TEMPLATE/bug_report.yml`
- Create: `deploy/public/.github/ISSUE_TEMPLATE/feature_request.yml`
- Create: `deploy/public/.github/ISSUE_TEMPLATE/config.yml`
- Test: `scripts/public-export.test.mjs`

**Interfaces:**
- Consumes: Apache License 2.0 standard text
- Produces: public root legal and support policy files

- [ ] **Step 1: Add failing policy assertions**

Append to `scripts/public-export.test.mjs`:

```js
import { readFile } from 'node:fs/promises'

describe('public policy sources', () => {
  it('contains the approved license and issue policy', async () => {
    const license = await readFile(resolve(root, 'LICENSE'), 'utf8')
    const notice = await readFile(resolve(root, 'NOTICE'), 'utf8')
    const readme = await readFile(resolve(root, 'deploy/public/README.md'), 'utf8')
    const contributing = await readFile(resolve(root, 'deploy/public/CONTRIBUTING.md'), 'utf8')
    const security = await readFile(resolve(root, 'deploy/public/SECURITY.md'), 'utf8')
    assert.match(license, /Apache License\s+Version 2\.0/)
    assert.match(notice, /Copyright 2026 Steven Ridder/)
    assert.match(readme, /Download for Apple Silicon/)
    assert.match(readme, /macOS 14/)
    assert.match(readme, /Dispatch has no telemetry/)
    assert.match(contributing, /Pull requests are not accepted/)
    assert.match(contributing, /Do not include private email/)
    assert.match(security, /private vulnerability reporting/)
  })
})
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `node --test scripts/public-export.test.mjs`

Expected: FAIL with missing `LICENSE`.

- [ ] **Step 3: Add exact legal and support files**

Add the unmodified Apache License 2.0 text from `https://www.apache.org/licenses/LICENSE-2.0.txt` to `LICENSE`.

Create `NOTICE`:

```text
Dispatch
Copyright 2026 Steven Ridder

This product includes software developed by third parties. See
THIRD_PARTY_NOTICES.md in the source distribution and application bundle.
```

Create `deploy/public/CONTRIBUTING.md`:

```markdown
# Contributing

This repository contains source snapshots for published Dispatch releases.
Public issues are welcome. Pull requests are not accepted because normal
development uses a separate private history.

Do not include private email, message bodies, OAuth data, tokens, account IDs,
or unredacted Dispatch logs. Use synthetic data and the issue templates.
```

Create `deploy/public/SECURITY.md`:

```markdown
# Security

Use GitHub private vulnerability reporting for security reports. Do not open a
public issue for a vulnerability.

Do not include Gmail content, OAuth data, tokens, account IDs, or unredacted
logs in a report unless GitHub marks the report private.
```

Create `deploy/public/README.md` as a complete public landing page with:

````markdown
# Dispatch

Dispatch is a native macOS Gmail workbench with messages, rendered mail, and
Codex in one window.

![Dispatch with synthetic mail](docs/assets/dispatch-screenshot.png)

## Download for Apple Silicon

Download the latest signed DMG from
https://github.com/6th-Element-Labs/dispatch/releases/latest.

Requirements: Apple Silicon, macOS 14 or later, and an installed Codex CLI or
current ChatGPT desktop app.

## First run

1. Install Codex from https://developers.openai.com/codex/cli
2. Sign in with `codex login`, or sign in in ChatGPT desktop.
3. Open `codex://plugins/gmail@openai-curated`, or use `/plugins` in Codex, and
   connect Gmail.

Dispatch has no telemetry. Gmail credentials remain with Codex. Dispatch stores
indexed mail under `~/Library/Application Support/Dispatch`, attachments under
`~/Library/Caches/Dispatch`, and logs under `~/Library/Logs/Dispatch`.

## Verify a download

```bash
shasum -a 256 -c SHA256SUMS.txt
```

## Build from source

Install Node 22, Rust, and the Codex CLI. Then run:

```bash
for dir in services/web services/mail services/agent apps/desktop; do
  npm --prefix "$dir" ci
done
npm --prefix apps/desktop run fetch-node
npm --prefix apps/desktop run build:native
```

## Remove local data

Quit Dispatch, then remove the app and its local files:

```bash
launchctl bootout "gui/$(id -u)/com.taikun.dispatch.mail" 2>/dev/null || true
launchctl bootout "gui/$(id -u)/com.taikun.dispatch.agent" 2>/dev/null || true
rm -rf "/Applications/Dispatch.app" \
  "$HOME/Library/Application Support/Dispatch" \
  "$HOME/Library/Caches/Dispatch" \
  "$HOME/Library/Logs/Dispatch"
rm -f "$HOME/Library/LaunchAgents/com.taikun.dispatch.mail.plist" \
  "$HOME/Library/LaunchAgents/com.taikun.dispatch.agent.plist"
```

## Feedback

Public issues are welcome. Pull requests are not accepted because this
repository contains release snapshots from a separate development history.

Licensed under Apache License 2.0.
````

Create YAML issue forms with required macOS version, Dispatch version, Codex surface, reproduction steps, and a required checkbox confirming that all private data is redacted. Set `.github/ISSUE_TEMPLATE/config.yml` to disable blank issues and link security reports to `/security/advisories/new`.

- [ ] **Step 4: Run the policy test**

Run: `node --test scripts/public-export.test.mjs`

Expected: PASS for policy source assertions.

- [ ] **Step 5: Commit**

```bash
git add LICENSE NOTICE deploy/public scripts/public-export.test.mjs
git commit -m "docs: add public license and support policies"
```

---

### Task 3: Build the explicit export manifest and engine

**Files:**
- Create: `deploy/public-export-manifest.json`
- Create: `scripts/public-export-lib.mjs`
- Create: `scripts/export-public-release.mjs`
- Modify: `scripts/public-export.test.mjs`

**Interfaces:**
- Consumes:

```js
await exportPublicTree({
  root,
  ref: 'HEAD',
  destination,
  version: '0.1.0',
})
```

- Produces:

```js
export async function loadManifest(root)
export async function exportPublicTree(options)
export async function validatePublicTree(directory, manifest, version)
export function secretFindings(text, path)
export function versionsFromTree(directory)
```

- [ ] **Step 1: Write failing manifest and scanner tests**

Append tests that create temporary fixture trees and assert:

```js
it('copies only manifest paths and overlays public-root files', async () => {
  const destination = await mkdtemp(resolve(tmpdir(), 'dispatch-export-'))
  await exportPublicTree({ root, ref: 'HEAD', destination, version: '0.1.0' })
  assert.equal(await readFile(resolve(destination, 'README.md'), 'utf8'),
    await readFile(resolve(root, 'deploy/public/README.md'), 'utf8'))
  await assert.rejects(lstat(resolve(destination, 'AGENTS.md')), { code: 'ENOENT' })
  await assert.rejects(lstat(resolve(destination, 'docs/superpowers')), { code: 'ENOENT' })
  await assert.rejects(lstat(resolve(destination, 'scripts/ci-sandbox.sh')), { code: 'ENOENT' })
})

it('rejects private paths and credential shapes', () => {
  assert.deepEqual(secretFindings('/Users/steveridder/private', 'x.md'), ['machine path'])
  assert.deepEqual(secretFindings('ghp_abcdefghijklmnopqrstuvwxyz123456', 'x.md'), ['GitHub token'])
})

it('rejects version disagreement', async () => {
  const versions = await versionsFromTree(root)
  assert.deepEqual([...new Set(versions.map(item => item.version))], ['0.1.0'])
})
```

Import `lstat`, `mkdtemp`, `tmpdir`, `exportPublicTree`, `secretFindings`, and `versionsFromTree`.

- [ ] **Step 2: Run the tests and verify they fail**

Run: `node --test scripts/public-export.test.mjs`

Expected: FAIL because `public-export-lib.mjs` does not exist.

- [ ] **Step 3: Add the manifest**

Create `deploy/public-export-manifest.json` with this shape:

```json
{
  "schema": "dispatch.public_export.v1",
  "copies": [
    { "source": ".gitignore", "destination": ".gitignore" },
    { "source": "LICENSE", "destination": "LICENSE" },
    { "source": "NOTICE", "destination": "NOTICE" },
    { "source": "apps/desktop", "destination": "apps/desktop" },
    { "source": "services/web", "destination": "services/web" },
    { "source": "services/mail", "destination": "services/mail" },
    { "source": "services/agent", "destination": "services/agent" },
    { "source": "contracts", "destination": "contracts" },
    { "source": "deploy/service-boundary-contract.json", "destination": "deploy/service-boundary-contract.json" },
    { "source": "docs/PRODUCT.md", "destination": "docs/PRODUCT.md" },
    { "source": "docs/ARCHITECTURE.md", "destination": "docs/ARCHITECTURE.md" },
    { "source": "docs/DESIGN.md", "destination": "docs/DESIGN.md" },
    { "source": "docs/assets", "destination": "docs/assets" },
    { "source": "scripts/check-boundaries.mjs", "destination": "scripts/check-boundaries.mjs" },
    { "source": "scripts/dispatch_ci.sh", "destination": "scripts/dispatch_ci.sh" },
    { "source": "scripts/install.sh", "destination": "scripts/install.sh" },
    { "source": "scripts/dev.sh", "destination": "scripts/dev.sh" },
    { "source": "scripts/dev-service.sh", "destination": "scripts/dev-service.sh" },
    { "source": "deploy/public", "destination": "." }
  ],
  "required": [
    "README.md",
    "LICENSE",
    "NOTICE",
    "apps/desktop/src-tauri/tauri.conf.json",
    "services/web/package-lock.json",
    "services/mail/package-lock.json",
    "services/agent/package-lock.json",
    "contracts/mail.v1.json",
    "scripts/dispatch_ci.sh"
  ],
  "forbiddenPrefixes": [
    ".superpowers/",
    "docs/superpowers/",
    "docs/CI-SANDBOX.md",
    "scripts/ci-sandbox.sh",
    "AGENTS.md"
  ]
}
```

- [ ] **Step 4: Implement the export library**

Implement `scripts/public-export-lib.mjs` with:

- `git archive` into a temporary source tree;
- `lstat` rejection for every symlink before copy;
- `cp(..., { recursive: true, dereference: false })` for each manifest entry;
- overlay order as listed, so `deploy/public` supplies public root files;
- recursive file enumeration that skips `.git`;
- hard-secret patterns for private keys, GitHub tokens, AWS keys, `/Users/steveridder`, `CloudStorage/`, and `/Dropbox/Git`;
- required and forbidden path checks;
- version reads from all service package files, desktop package, Cargo manifest, and Tauri config;
- atomic replacement of destination contents only after staging validation passes.

The CLI `scripts/export-public-release.mjs` accepts:

```text
--destination /tmp/dispatch-public   required absolute path
--ref HEAD                          default HEAD
--version 0.1.0                    required release version
--verify                       run public_ci.sh in the staged export
```

It rejects a dirty private tree and a destination with uncommitted changes.

- [ ] **Step 5: Run unit and real-tree tests**

Run:

```bash
node --test scripts/public-export.test.mjs
node scripts/export-public-release.mjs \
  --destination "$(mktemp -d)/dispatch-public" \
  --ref HEAD \
  --version 0.1.0
```

Expected: tests pass; export contains required paths and no forbidden paths.

- [ ] **Step 6: Commit**

```bash
git add deploy/public-export-manifest.json scripts/public-export-lib.mjs scripts/export-public-release.mjs scripts/public-export.test.mjs
git commit -m "feat(release): add allowlisted public source export"
```

---

### Task 4: Add the synthetic public screenshot

**Files:**
- Create: `docs/assets/dispatch-screenshot.png`
- Modify: `scripts/public-export.test.mjs`

**Interfaces:**
- Consumes: the complete public README from Task 2
- Produces: a synthetic-data screenshot for the public landing page

- [ ] **Step 1: Add a failing screenshot contract assertion**

Assert the file is a PNG and is large enough to be a real screenshot:

```js
const screenshot = await readFile(resolve(root, 'docs/assets/dispatch-screenshot.png'))
assert.deepEqual([...screenshot.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10])
assert.ok(screenshot.length > 100_000)
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `node --test scripts/public-export.test.mjs`

Expected: FAIL because `docs/assets/dispatch-screenshot.png` is missing.

- [ ] **Step 3: Capture the screenshot**

Run the web app with explicit demo mail, use a fresh browser profile, and capture a 1440×900 screenshot:

```bash
DISPATCH_DEMO_MAIL=1 bash scripts/dev.sh
```

Verify manually that no real account address, message, attachment, token, or filesystem path is visible. Save it as `docs/assets/dispatch-screenshot.png`.

- [ ] **Step 4: Run screenshot and secret scans**

Run:

```bash
node --test scripts/public-export.test.mjs
node scripts/export-public-release.mjs --destination "$(mktemp -d)/dispatch-public" --version 0.1.0
```

Expected: PASS; the screenshot and README are present.

- [ ] **Step 5: Commit**

```bash
git add docs/assets/dispatch-screenshot.png scripts/public-export.test.mjs
git commit -m "docs: add public Dispatch landing page"
```

---

### Task 5: Generate and enforce third-party notices

**Files:**
- Create: `deploy/public-license-policy.json`
- Create: `scripts/check-dependency-licenses.mjs`
- Create: `scripts/check-dependency-licenses.test.mjs`
- Modify: `apps/desktop/scripts/stage.mjs`
- Modify: `deploy/public-export-manifest.json`

**Interfaces:**
- Consumes:

```bash
node scripts/check-dependency-licenses.mjs --output THIRD_PARTY_NOTICES.md
```

- Produces: `THIRD_PARTY_NOTICES.md` and exit code 1 for missing or unapproved licenses

- [ ] **Step 1: Write failing policy tests**

Use fixture npm lock and Cargo metadata JSON. Assert:

```js
assert.equal(normalizeLicense('MIT OR Apache-2.0'), 'Apache-2.0 OR MIT')
assert.equal(isApproved('Apache-2.0'), true)
assert.equal(isApproved('GPL-3.0-only'), false)
assert.throws(() => validatePackages([{ name: 'unknown', license: null }]), /missing license/)
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `node --test scripts/check-dependency-licenses.test.mjs`

Expected: FAIL because the checker does not exist.

- [ ] **Step 3: Add the license policy**

Create `deploy/public-license-policy.json`:

```json
{
  "schema": "dispatch.license_policy.v1",
  "approved": [
    "0BSD",
    "Apache-2.0",
    "BSD-2-Clause",
    "BSD-3-Clause",
    "BSL-1.0",
    "CC0-1.0",
    "ISC",
    "MIT",
    "MPL-2.0 OR Apache-2.0",
    "Unicode-3.0",
    "Zlib"
  ],
  "overrides": {}
}
```

- [ ] **Step 4: Implement metadata collection and notice output**

The checker:

- reads all four npm lockfiles;
- calls `cargo metadata --format-version=1 --manifest-path apps/desktop/src-tauri/Cargo.toml`;
- reports package name, version, source, and license;
- accepts only normalized expressions in policy;
- requires an explicit override for a missing license;
- sorts notices by ecosystem, name, and version;
- writes atomically;
- supports `--check THIRD_PARTY_NOTICES.md` to fail when notices are stale.

Do not add an override without checking the dependency's upstream license file.

- [ ] **Step 5: Run against the real dependency graph**

Run:

```bash
for dir in services/web services/mail services/agent apps/desktop; do npm --prefix "$dir" ci; done
node scripts/check-dependency-licenses.mjs --output THIRD_PARTY_NOTICES.md
node scripts/check-dependency-licenses.mjs --check THIRD_PARTY_NOTICES.md
```

Expected: PASS after adding only evidence-backed overrides.

- [ ] **Step 6: Bundle notices**

Update `apps/desktop/scripts/stage.mjs` to copy `LICENSE`, `NOTICE`, and `THIRD_PARTY_NOTICES.md` into Tauri resources. Add those resources to `tauri.conf.json`.

- [ ] **Step 7: Commit**

```bash
git add deploy/public-license-policy.json scripts/check-dependency-licenses.mjs scripts/check-dependency-licenses.test.mjs THIRD_PARTY_NOTICES.md apps/desktop/scripts/stage.mjs apps/desktop/src-tauri/tauri.conf.json deploy/public-export-manifest.json
git commit -m "build: enforce public dependency licenses"
```

---

### Task 6: Add direct public CI and the end-to-end export gate

**Files:**
- Create: `deploy/public/.github/workflows/verify.yml`
- Create: `scripts/public_ci.sh`
- Create: `scripts/verify-public-export.sh`
- Modify: `scripts/dispatch_ci.sh`
- Modify: `deploy/public-export-manifest.json`
- Test: `scripts/public-export.test.mjs`

**Interfaces:**
- Consumes: exported public tree
- Produces:

```bash
bash scripts/public_ci.sh
bash scripts/verify-public-export.sh
```

- [ ] **Step 1: Add failing workflow and gate assertions**

Assert the exported workflow:

- runs on `push` to `main` and `workflow_dispatch`;
- uses `permissions: contents: read`;
- runs `bash scripts/public_ci.sh`;
- contains no `dispatch-ci`, `ci-sandbox`, or private repo name.

- [ ] **Step 2: Run the tests and verify they fail**

Run: `node --test scripts/public-export.test.mjs`

Expected: FAIL because the public workflow and gate are missing.

- [ ] **Step 3: Add public CI**

Create `scripts/public_ci.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

node scripts/check-dependency-licenses.mjs --check THIRD_PARTY_NOTICES.md
bash scripts/dispatch_ci.sh
```

Create `deploy/public/.github/workflows/verify.yml` with Node 22, Chromium installation, dependency cache, and one `public-ci/full-suite` job that runs `bash scripts/public_ci.sh`.

- [ ] **Step 4: Add the private end-to-end export gate**

Create `scripts/verify-public-export.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/dispatch-public-export.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

node "$ROOT/scripts/export-public-release.mjs" \
  --destination "$WORK/public" \
  --ref HEAD \
  --version 0.1.0

bash "$WORK/public/scripts/public_ci.sh"
```

Wire the Node unit tests into `scripts/dispatch_ci.sh` before service installs:

```bash
node --test "${ROOT}/scripts/public-export.test.mjs" "${ROOT}/scripts/check-dependency-licenses.test.mjs"
```

Do not run the full exported-tree npm install inside every private unit loop; run `verify-public-export.sh` as its own package gate and release prerequisite.

- [ ] **Step 5: Run all package 1 checks**

Run:

```bash
node --test scripts/public-export.test.mjs scripts/check-dependency-licenses.test.mjs
bash scripts/verify-public-export.sh
bash scripts/dispatch_ci.sh
```

Expected: all pass from a clean private checkout and from the exported tree.

- [ ] **Step 6: Review the exported file list**

Run:

```bash
WORK="$(mktemp -d)"
node scripts/export-public-release.mjs --destination "$WORK/public" --version 0.1.0
(cd "$WORK/public" && find . -type f | LC_ALL=C sort)
```

Confirm there is no private CI, internal plan, local path, credential, or generated output.

- [ ] **Step 7: Commit**

```bash
git add deploy/public/.github/workflows/verify.yml scripts/public_ci.sh scripts/verify-public-export.sh scripts/dispatch_ci.sh deploy/public-export-manifest.json scripts/public-export.test.mjs
git commit -m "ci: verify clean public source snapshots"
```

---

## Package 1 completion gate

Run:

```bash
bash scripts/dispatch_ci.sh
bash scripts/verify-public-export.sh
git diff --check
git status --short
```

Required evidence:

- private gate passes;
- public export gate passes from a clean temporary tree;
- dependency notices are current;
- exported source has no forbidden files or machine paths;
- screenshot contains synthetic data only;
- no GitHub repository has been renamed or created yet.
