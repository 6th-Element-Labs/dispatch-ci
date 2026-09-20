# macOS Signing and Public Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an Apple Silicon, macOS 14 Dispatch DMG from public source, sign it with Developer ID, notarize and staple it, verify it, and upload it with checksums to a draft GitHub Release.

**Architecture:** Release-safe Node scripts verify versions, artifacts, signatures, and checksums. A public tag workflow runs tests without secrets, then enters a protected `release` environment for the signed macOS build and draft publication. Tauri owns signing and notarization through environment variables; no signing logic enters product services.

**Tech Stack:** Tauri 2, Rust, Node 22 ESM, GitHub Actions, Apple Developer ID, App Store Connect API, `codesign`, `spctl`, `stapler`

## Global Constraints

- Package 1 public export and public CI must be complete first.
- Target only `aarch64-apple-darwin`.
- Minimum system version is macOS 14.0.
- Build from the tagged public source commit.
- Use a Developer ID Application certificate, not Apple Development or ad-hoc signing.
- Use App Store Connect API credentials for notarization.
- Keep all credentials in the protected public `release` environment.
- Create a draft release. Do not publish from the build job.
- A failed build, signing, notarization, staple, or verification step must not publish a release.
- Published assets are immutable.
- Updater archives, updater signatures, and `latest.json` are added by Package 3.

---

## File map

- Create: `scripts/version-contract.mjs` — shared version reader and validator
- Create: `scripts/version-contract.test.mjs`
- Create: `apps/desktop/scripts/write-sha256sums.mjs`
- Create: `apps/desktop/scripts/write-sha256sums.test.mjs`
- Create: `apps/desktop/scripts/verify-release.mjs`
- Create: `apps/desktop/scripts/verify-release.test.mjs`
- Create: `deploy/public/.github/workflows/release.yml`
- Create: `deploy/public/docs/RELEASING.md`
- Create: `scripts/release-workflow.test.mjs`
- Modify: `apps/desktop/src-tauri/tauri.conf.json` — macOS 14 target
- Modify: `apps/desktop/package.json` — release scripts
- Modify: `.github/workflows/native.yml` — assert macOS target
- Modify: `deploy/public-export-manifest.json` — include release docs and workflow
- Modify: `scripts/dispatch_ci.sh` — run release script unit tests

---

### Task 1: Enforce one release version and macOS 14

**Files:**
- Create: `scripts/version-contract.mjs`
- Create: `scripts/version-contract.test.mjs`
- Modify: `apps/desktop/src-tauri/tauri.conf.json`
- Modify: `.github/workflows/native.yml`
- Modify: `scripts/dispatch_ci.sh`

**Interfaces:**
- Produces:

```js
export async function readVersions(root)
export function assertOneVersion(records, expected)
```

CLI:

```bash
node scripts/version-contract.mjs --expect 0.1.0
```

- [ ] **Step 1: Write failing version tests**

Create fixture manifests in a temporary directory and assert:

```js
const records = await readVersions(fixture)
assert.deepEqual(records.map(item => item.version), ['0.1.0', '0.1.0', '0.1.0', '0.1.0', '0.1.0', '0.1.0'])
assert.doesNotThrow(() => assertOneVersion(records, '0.1.0'))
assert.throws(() => assertOneVersion([{ path: 'a', version: '0.1.0' }, { path: 'b', version: '0.1.1' }], '0.1.0'), /b.*0\.1\.1/)
```

The six inputs are desktop package, Tauri config, Cargo manifest, and three service packages.

- [ ] **Step 2: Run and verify failure**

Run: `node --test scripts/version-contract.test.mjs`

Expected: FAIL because `version-contract.mjs` is missing.

- [ ] **Step 3: Implement the version contract**

Read JSON directly. Read the Cargo package version with a line-anchored regular expression limited to the first `[package]` section:

```js
const match = cargo.match(/\[package\][\s\S]*?^version\s*=\s*"([^"]+)"/m)
```

Reject missing versions, prerelease version disagreement, and an `--expect` mismatch. Print one `path: version` line for each record.

- [ ] **Step 4: Set the deployment target**

Add to `bundle` in `apps/desktop/src-tauri/tauri.conf.json`:

```json
"macOS": {
  "minimumSystemVersion": "14.0"
}
```

Do not set a committed signing identity. Local builds may remain ad-hoc; release CI supplies `APPLE_SIGNING_IDENTITY`.

- [ ] **Step 5: Assert the generated bundle target in native CI**

After `Build Dispatch.app` in `.github/workflows/native.yml`, add:

```yaml
      - name: Verify macOS deployment target
        run: |
          value="$(/usr/libexec/PlistBuddy -c 'Print :LSMinimumSystemVersion' \
            apps/desktop/src-tauri/target/release/bundle/macos/Dispatch.app/Contents/Info.plist)"
          test "$value" = "14.0"
```

Wire `node --test scripts/version-contract.test.mjs` and `node scripts/version-contract.mjs --expect 0.1.0` into `scripts/dispatch_ci.sh`.

- [ ] **Step 6: Verify**

Run:

```bash
node --test scripts/version-contract.test.mjs
node scripts/version-contract.mjs --expect 0.1.0
npm --prefix apps/desktop run build:native -- --bundles app
/usr/libexec/PlistBuddy -c 'Print :LSMinimumSystemVersion' \
  apps/desktop/src-tauri/target/release/bundle/macos/Dispatch.app/Contents/Info.plist
```

Expected: tests pass and the plist reports `14.0`.

- [ ] **Step 7: Commit**

```bash
git add scripts/version-contract.mjs scripts/version-contract.test.mjs scripts/dispatch_ci.sh apps/desktop/src-tauri/tauri.conf.json .github/workflows/native.yml
git commit -m "build: require one version and macOS 14"
```

---

### Task 2: Generate deterministic release checksums

**Files:**
- Create: `apps/desktop/scripts/write-sha256sums.mjs`
- Create: `apps/desktop/scripts/write-sha256sums.test.mjs`
- Modify: `apps/desktop/package.json`

**Interfaces:**
- Produces:

```js
export async function checksums(directory, names)
export function formatChecksums(records)
```

CLI:

```bash
node apps/desktop/scripts/write-sha256sums.mjs \
  --output /tmp/dispatch-release/SHA256SUMS.txt \
  /tmp/dispatch-release/Dispatch_0.1.0_aarch64.dmg
```

- [ ] **Step 1: Write failing checksum tests**

Use two fixture files and assert:

```js
assert.deepEqual(records.map(record => record.name), ['a.dmg', 'b.tar.gz'])
assert.match(formatChecksums(records), /^[a-f0-9]{64}  a\.dmg\n[a-f0-9]{64}  b\.tar\.gz\n$/)
```

Also assert duplicate basenames and missing files fail.

- [ ] **Step 2: Run and verify failure**

Run: `node --test apps/desktop/scripts/write-sha256sums.test.mjs`

Expected: FAIL because the script is missing.

- [ ] **Step 3: Implement checksums**

Use `createReadStream` and `createHash('sha256')`. Sort by basename. Write the output through `` `${output}.${process.pid}.tmp` ``, then rename it atomically. Refuse to overwrite an existing checksum file unless its content is identical.

Add:

```json
"release:checksums": "node scripts/write-sha256sums.mjs"
```

to `apps/desktop/package.json`.

- [ ] **Step 4: Verify**

Run:

```bash
node --test apps/desktop/scripts/write-sha256sums.test.mjs
npm --prefix apps/desktop run release:checksums -- \
  --output /tmp/SHA256SUMS.txt \
  apps/desktop/src-tauri/target/release/bundle/dmg/Dispatch_0.1.0_aarch64.dmg
shasum -a 256 -c /tmp/SHA256SUMS.txt
```

Expected: tests and checksum verification pass.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/scripts/write-sha256sums.mjs apps/desktop/scripts/write-sha256sums.test.mjs apps/desktop/package.json
git commit -m "build: generate release checksums"
```

---

### Task 3: Verify signed, notarized app and DMG artifacts

**Files:**
- Create: `apps/desktop/scripts/verify-release.mjs`
- Create: `apps/desktop/scripts/verify-release.test.mjs`
- Modify: `apps/desktop/package.json`

**Interfaces:**
- Produces:

```js
export function verificationCommands({ app, dmg, mount })
export async function verifyRelease(options, run)
```

CLI:

```bash
node apps/desktop/scripts/verify-release.mjs \
  --app apps/desktop/src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Dispatch.app \
  --dmg apps/desktop/src-tauri/target/aarch64-apple-darwin/release/bundle/dmg/Dispatch_0.1.0_aarch64.dmg
```

- [ ] **Step 1: Write failing command-plan tests**

Assert the command list contains:

```js
[
  ['codesign', ['--verify', '--deep', '--strict', app]],
  ['spctl', ['--assess', '--type', 'execute', app]],
  ['xcrun', ['stapler', 'validate', app]],
]
```

For a DMG, assert it uses `hdiutil attach -readonly -nobrowse -plist`, locates `Dispatch.app`, repeats the three checks, and always detaches the mount in `finally`.

Assert a failed runner surfaces the command and exit status.

- [ ] **Step 2: Run and verify failure**

Run: `node --test apps/desktop/scripts/verify-release.test.mjs`

Expected: FAIL because the verifier is missing.

- [ ] **Step 3: Implement verification**

Use `execFile` without a shell. Parse the `hdiutil` plist with `/usr/libexec/PlistBuddy` or `plutil -extract system-entities json -o - -`. Reject a DMG with no `Dispatch.app`. Always detach in `finally`.

Add:

```json
"release:verify": "node scripts/verify-release.mjs"
```

to `apps/desktop/package.json`.

- [ ] **Step 4: Verify tests and unsigned failure**

Run:

```bash
node --test apps/desktop/scripts/verify-release.test.mjs
npm --prefix apps/desktop run release:verify -- \
  --app apps/desktop/src-tauri/target/release/bundle/macos/Dispatch.app
```

Expected: unit tests pass; the current ad-hoc app fails `spctl`. This proves the verifier rejects an unsigned public build.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/scripts/verify-release.mjs apps/desktop/scripts/verify-release.test.mjs apps/desktop/package.json
git commit -m "build: verify signed notarized macOS releases"
```

---

### Task 4: Add the public draft-release workflow

**Files:**
- Create: `deploy/public/.github/workflows/release.yml`
- Create: `scripts/release-workflow.test.mjs`
- Modify: `deploy/public-export-manifest.json`
- Modify: `scripts/dispatch_ci.sh`

**Interfaces:**
- Consumes: public `v*` tags and protected `release` environment secrets
- Produces: a draft GitHub Release with signed DMG and `SHA256SUMS.txt`

- [ ] **Step 1: Write failing static workflow tests**

Read the YAML as text and assert:

```js
for (const required of [
  "tags: ['v*']",
  'environment: release',
  'aarch64-apple-darwin',
  'MACOSX_DEPLOYMENT_TARGET: "14.0"',
  'APPLE_CERTIFICATE',
  'APPLE_API_ISSUER',
  'releaseDraft: true',
  'release:verify',
  'release:checksums',
]) assert.match(workflow, new RegExp(escape(required)))
assert.doesNotMatch(workflow, /pull_request_target|dispatch-ci/)
```

- [ ] **Step 2: Run and verify failure**

Run: `node --test scripts/release-workflow.test.mjs`

Expected: FAIL because the workflow is missing.

- [ ] **Step 3: Add the release workflow**

Create two jobs:

1. `verify` on `ubuntu-latest`, with read-only contents permission, Node 22, Chromium, and `bash scripts/public_ci.sh`.
2. `macos-release` on `macos-14`, `needs: verify`, `environment: release`, and `contents: write`.

The signed job:

- installs Node 22 and Rust;
- adds `aarch64-apple-darwin`;
- installs all four npm workspaces with `npm ci`;
- fetches the pinned sidecar;
- writes `APPLE_API_KEY_P8` to `$RUNNER_TEMP/AuthKey.p8` with mode `600`;
- sets `APPLE_API_KEY_PATH`;
- runs `tauri-apps/tauri-action@v1` with:

```yaml
        with:
          projectPath: apps/desktop
          tagName: v__VERSION__
          releaseName: Dispatch v__VERSION__
          releaseDraft: true
          prerelease: false
          args: --target aarch64-apple-darwin --bundles app,dmg
```

- supplies `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_API_ISSUER`, `APPLE_API_KEY`, `APPLE_API_KEY_PATH`, and `APPLE_TEAM_ID`;
- runs `release:verify`;
- runs `release:checksums`;
- uploads `SHA256SUMS.txt` to the draft with `gh release upload "$GITHUB_REF_NAME"`.

Do not add Apple secrets to the `verify` job.

- [ ] **Step 4: Export and validate the workflow**

Add the workflow and release scripts to the public manifest. Wire `release-workflow.test.mjs`, checksum tests, and verifier tests into `scripts/dispatch_ci.sh`.

Run:

```bash
node --test scripts/release-workflow.test.mjs \
  apps/desktop/scripts/write-sha256sums.test.mjs \
  apps/desktop/scripts/verify-release.test.mjs
bash scripts/verify-public-export.sh
```

Expected: PASS; exported workflow has no private CI reference.

- [ ] **Step 5: Commit**

```bash
git add deploy/public/.github/workflows/release.yml deploy/public-export-manifest.json scripts/release-workflow.test.mjs scripts/dispatch_ci.sh
git commit -m "ci: add signed macOS draft releases"
```

---

### Task 5: Add the release operator runbook

**Files:**
- Create: `deploy/public/docs/RELEASING.md`
- Modify: `deploy/public-export-manifest.json`
- Test: `scripts/release-workflow.test.mjs`

**Interfaces:**
- Consumes: Apple and GitHub administrator access
- Produces: exact credential setup and draft acceptance procedure

- [ ] **Step 1: Add failing runbook assertions**

Assert the runbook names:

```text
Developer ID Application
APPLE_CERTIFICATE
APPLE_API_KEY_P8
TAURI_SIGNING_PRIVATE_KEY
codesign --verify --deep --strict
spctl --assess --type execute
xcrun stapler validate
```

- [ ] **Step 2: Run and verify failure**

Run: `node --test scripts/release-workflow.test.mjs`

Expected: FAIL because `RELEASING.md` is missing.

- [ ] **Step 3: Write the runbook**

Document exact operator commands:

```bash
security find-identity -v -p codesigning
base64 -i DeveloperID.p12 | pbcopy
gh secret set APPLE_CERTIFICATE --env release --repo 6th-Element-Labs/dispatch
gh secret set APPLE_CERTIFICATE_PASSWORD --env release --repo 6th-Element-Labs/dispatch
gh secret set APPLE_SIGNING_IDENTITY --env release --repo 6th-Element-Labs/dispatch
gh secret set APPLE_API_ISSUER --env release --repo 6th-Element-Labs/dispatch
gh secret set APPLE_API_KEY --env release --repo 6th-Element-Labs/dispatch
gh secret set APPLE_API_KEY_P8 --env release --repo 6th-Element-Labs/dispatch
gh secret set APPLE_TEAM_ID --env release --repo 6th-Element-Labs/dispatch
```

State that the current Apple Development certificate is insufficient. Document draft review, checksum download, Gatekeeper checks, clean-Mac install, and the rule that published assets are never replaced.

- [ ] **Step 4: Verify**

Run:

```bash
node --test scripts/release-workflow.test.mjs
bash scripts/verify-public-export.sh
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add deploy/public/docs/RELEASING.md deploy/public-export-manifest.json scripts/release-workflow.test.mjs
git commit -m "docs: add signed release operator runbook"
```

---

## Package 2 human blocker

Before a signed workflow can pass, Steve must create:

- Developer ID Application certificate;
- password-protected `.p12`;
- App Store Connect API issuer and key;
- downloaded `.p8`;
- Apple Team ID;
- protected `release` environment.

Do not create `v0.1.0` or publish a release in this package.

## Package 2 completion gate

Run:

```bash
bash scripts/dispatch_ci.sh
bash scripts/verify-public-export.sh
npm --prefix apps/desktop run test:native
git diff --check
```

Then perform one credentialed local build and verify:

```bash
npm --prefix apps/desktop run build:native -- --target aarch64-apple-darwin --bundles app,dmg
npm --prefix apps/desktop run release:verify -- \
  --app apps/desktop/src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Dispatch.app \
  --dmg apps/desktop/src-tauri/target/aarch64-apple-darwin/release/bundle/dmg/Dispatch_0.1.0_aarch64.dmg
```

Required evidence:

- macOS minimum is 14.0;
- version contract passes;
- ad-hoc builds are rejected by public release verification;
- credentialed build passes codesign, Gatekeeper, notarization, and staple checks;
- workflow creates a draft only;
- no public repo tag has been pushed yet.
