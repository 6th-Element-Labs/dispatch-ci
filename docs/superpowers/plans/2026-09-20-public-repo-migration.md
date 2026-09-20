# Public Repository Migration and v0.1.0 Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the private canonical repository, create and secure a fresh public release mirror, export one clean `v0.1.0` source commit, run public CI, and publish the signed, notarized first release after explicit acceptance.

**Architecture:** Packages 1–3 prepare all code, export, signing, and updater behavior before any repository mutation. The migration uses guarded GitHub CLI commands with verification after each external step. Public source and release assets come from the same immutable public commit and tag.

**Tech Stack:** Git, GitHub CLI, GitHub REST API, GitHub Actions, Tauri release workflow, Apple signing and notarization

## Global Constraints

- Packages 1, 2, and 3 must be merged and green first.
- Rename private `6th-Element-Labs/dispatch` to `6th-Element-Labs/dispatch-private`.
- Create a fresh public `6th-Element-Labs/dispatch`.
- Keep `6th-Element-Labs/dispatch-ci` as private-development verification infrastructure.
- Public source has one release snapshot commit per release.
- Public issues are enabled; pull requests are not accepted by policy.
- Do not create or push `v0.1.0` until public `main` CI is green.
- Do not publish the draft release until clean-Mac and updater acceptance pass.
- Do not overwrite a published asset or tag.
- Stop at every human credential or approval gate.

---

## File map

- Create: `scripts/check-release-readiness.mjs` — local and GitHub prerequisite checks
- Create: `scripts/check-release-readiness.test.mjs`
- Create: `docs/REPOSITORY-MIGRATION.md` — private operator runbook
- Modify: `scripts/ci-sandbox.sh` — derive canonical repo from `origin`
- Modify: `docs/CI-SANDBOX.md` — private canonical name
- Modify: `README.md` — private canonical and public mirror roles
- Modify: `scripts/dispatch_ci.sh` — readiness unit tests
- External: rename private repo
- External: create/configure public repo
- External: protected environment secrets
- External: public source commit, CI, tag, draft, and publication

---

### Task 1: Make private CI survive the repository rename

**Files:**
- Modify: `scripts/ci-sandbox.sh`
- Create: `scripts/check-release-readiness.test.mjs`
- Modify: `docs/CI-SANDBOX.md`
- Modify: `README.md`

**Interfaces:**
- Produces:

```bash
canonical_repo
```

which prints `CANONICAL_REPO` when set, otherwise reads `origin` with:

```bash
gh repo view --json nameWithOwner --jq .nameWithOwner
```

- [ ] **Step 1: Write a failing topology test**

Create a test that reads private scripts and docs and asserts:

```js
assert.match(script, /canonical_repo\(\)/)
assert.doesNotMatch(script, /CANONICAL_REPO="\$\{CANONICAL_REPO:-6th-Element-Labs\/dispatch\}"/)
assert.match(ciDocs, /6th-Element-Labs\/dispatch-private/)
assert.match(readme, /public release mirror/)
```

- [ ] **Step 2: Run and verify failure**

Run: `node --test scripts/check-release-readiness.test.mjs`

Expected: FAIL because the script hard-codes the current private name.

- [ ] **Step 3: Make repository discovery dynamic**

Replace the hard-coded default with:

```bash
canonical_repo() {
  if [ -n "${CANONICAL_REPO:-}" ]; then
    printf '%s\n' "$CANONICAL_REPO"
    return
  fi
  gh repo view --json nameWithOwner --jq .nameWithOwner
}

CANONICAL_REPO="$(canonical_repo)"
```

Keep `CI_REPO=6th-Element-Labs/dispatch-ci`.

Update private documentation to name `dispatch-private` as the target canonical name and `dispatch` as the release mirror. State that old-name redirects are not part of the contract.

- [ ] **Step 4: Verify before rename**

Run:

```bash
node --test scripts/check-release-readiness.test.mjs
scripts/ci-sandbox.sh doctor
CANONICAL_REPO=6th-Element-Labs/dispatch scripts/ci-sandbox.sh doctor
```

Expected: current private topology passes before rename.

- [ ] **Step 5: Commit**

```bash
git add scripts/ci-sandbox.sh scripts/check-release-readiness.test.mjs docs/CI-SANDBOX.md README.md
git commit -m "build: make private CI follow the canonical remote"
```

---

### Task 2: Add a release-readiness preflight

**Files:**
- Create: `scripts/check-release-readiness.mjs`
- Modify: `scripts/check-release-readiness.test.mjs`
- Modify: `scripts/dispatch_ci.sh`
- Create: `docs/REPOSITORY-MIGRATION.md`

**Interfaces:**
- Produces:

```bash
node scripts/check-release-readiness.mjs \
  --version 0.1.0 \
  --public-repo 6th-Element-Labs/dispatch
```

- [ ] **Step 1: Write failing pure checks**

Export and test:

```js
export function localReadiness({ status, versions, exportOk, updaterConfigured })
export function githubReadiness({ privateRepo, publicRepo, tagExists, secrets })
```

Assert:

- dirty status fails;
- any version other than `0.1.0` fails;
- failed public export fails;
- missing updater public key fails;
- existing public `v0.1.0` fails;
- missing release secret names fail;
- `dispatch-private` may be absent before the rename but must be present after `--post-rename`.

- [ ] **Step 2: Run and verify failure**

Run: `node --test scripts/check-release-readiness.test.mjs`

Expected: FAIL because the readiness module is missing.

- [ ] **Step 3: Implement local and GitHub reads**

Use:

```bash
git status --porcelain
node scripts/version-contract.mjs --expect 0.1.0
bash scripts/verify-public-export.sh
gh repo view
gh secret list --env release --repo 6th-Element-Labs/dispatch
git ls-remote --tags https://github.com/6th-Element-Labs/dispatch.git refs/tags/v0.1.0
```

The required secret-name set is:

```text
APPLE_CERTIFICATE
APPLE_CERTIFICATE_PASSWORD
APPLE_SIGNING_IDENTITY
APPLE_API_ISSUER
APPLE_API_KEY
APPLE_API_KEY_P8
APPLE_TEAM_ID
TAURI_SIGNING_PRIVATE_KEY
TAURI_SIGNING_PRIVATE_KEY_PASSWORD
```

Never read secret values.

- [ ] **Step 4: Write the migration runbook**

`docs/REPOSITORY-MIGRATION.md` contains Tasks 3–7 from this plan, rollback rules, and a checkbox for each human gate. It names the exact old, private, CI, and public repositories.

- [ ] **Step 5: Verify**

Run:

```bash
node --test scripts/check-release-readiness.test.mjs
node scripts/check-release-readiness.mjs --version 0.1.0 --public-repo 6th-Element-Labs/dispatch
```

Expected before migration: local checks pass; GitHub checks report the expected missing `dispatch-private`, public repo, and secret prerequisites without mutating anything.

- [ ] **Step 6: Commit**

```bash
git add scripts/check-release-readiness.mjs scripts/check-release-readiness.test.mjs scripts/dispatch_ci.sh docs/REPOSITORY-MIGRATION.md
git commit -m "build: add guarded public release preflight"
```

---

### Task 3: Final private merge gate

**Files:** none

**Interfaces:**
- Consumes: Packages 1–3 and Tasks 1–2
- Produces: exact private `main` SHA approved for export

- [ ] **Step 1: Merge implementation packages through normal private PRs**

Do not perform migration from an unmerged feature branch.

- [ ] **Step 2: Verify private main**

Run:

```bash
git checkout main
git pull --ff-only origin main
bash scripts/dispatch_ci.sh
bash scripts/verify-public-export.sh
npm --prefix apps/desktop run test:native
scripts/ci-sandbox.sh doctor
```

Expected: all green.

- [ ] **Step 3: Record provenance**

Run:

```bash
git rev-parse HEAD
git status --short
```

Record the clean private SHA in the release checklist. Stop if status is not empty.

---

### Task 4: Rename the private canonical repository

**Files:** external GitHub state and local Git remote

**Interfaces:**
- Consumes: admin access to `6th-Element-Labs/dispatch`
- Produces: private `6th-Element-Labs/dispatch-private`

- [ ] **Step 1: Confirm the target name is free**

Run:

```bash
if gh repo view 6th-Element-Labs/dispatch-private >/dev/null 2>&1; then
  echo "dispatch-private already exists" >&2
  exit 1
fi
```

- [ ] **Step 2: Rename**

Run:

```bash
gh repo rename dispatch-private \
  --repo 6th-Element-Labs/dispatch \
  --yes
```

- [ ] **Step 3: Update the local canonical remote immediately**

Run:

```bash
git remote set-url origin https://github.com/6th-Element-Labs/dispatch-private.git
git fetch origin
```

- [ ] **Step 4: Verify preserved private settings**

Run:

```bash
gh repo view 6th-Element-Labs/dispatch-private \
  --json nameWithOwner,visibility,isPrivate,defaultBranchRef
gh api repos/6th-Element-Labs/dispatch-private/branches/main/protection \
  --jq '.required_status_checks.contexts'
scripts/ci-sandbox.sh doctor
scripts/ci-sandbox.sh refresh-main
```

Expected: private visibility, `main`, required `dispatch-ci/full-suite`, and green sandbox doctor.

- [ ] **Step 5: Roll back only if verification fails before public creation**

Run:

```bash
gh repo rename dispatch \
  --repo 6th-Element-Labs/dispatch-private \
  --yes
git remote set-url origin https://github.com/6th-Element-Labs/dispatch.git
```

Do not use this rollback after creating the public `dispatch`.

---

### Task 5: Create and secure the public repository

**Files:** external GitHub state

**Interfaces:**
- Consumes: GitHub organization admin access
- Produces: empty, configured `6th-Element-Labs/dispatch`

- [ ] **Step 1: Create the public repository**

Run:

```bash
gh repo create 6th-Element-Labs/dispatch \
  --public \
  --description "Dispatch — signed macOS release mirror and source snapshots" \
  --disable-wiki
gh repo edit 6th-Element-Labs/dispatch \
  --enable-issues=true \
  --enable-projects=false \
  --enable-wiki=false
```

- [ ] **Step 2: Enable security features**

Run:

```bash
gh api --method PUT repos/6th-Element-Labs/dispatch/private-vulnerability-reporting
gh api --method PUT repos/6th-Element-Labs/dispatch/vulnerability-alerts
gh api --method PATCH repos/6th-Element-Labs/dispatch --input - <<'JSON'
{
  "security_and_analysis": {
    "secret_scanning": { "status": "enabled" },
    "secret_scanning_push_protection": { "status": "enabled" }
  }
}
JSON
```

If organization policy rejects a feature, record the exact API response and stop. Do not silently omit security controls.

- [ ] **Step 3: Create the protected release environment**

Get Steve's GitHub user ID:

```bash
USER_ID="$(gh api user --jq .id)"
```

Create the environment:

```bash
jq -n --argjson id "$USER_ID" '{
  wait_timer: 0,
  prevent_self_review: false,
  reviewers: [{ type: "User", id: $id }],
  deployment_branch_policy: {
    protected_branches: false,
    custom_branch_policies: true
  }
}' | gh api --method PUT \
  repos/6th-Element-Labs/dispatch/environments/release \
  --input -
```

Restrict the environment to tags matching `v*`:

```bash
gh api --method POST \
  repos/6th-Element-Labs/dispatch/environments/release/deployment-branch-policies \
  -f name='v*' -f type='tag'
```

- [ ] **Step 4: Add secrets interactively**

Run the nine `gh secret set ... --env release` commands from `deploy/public/docs/RELEASING.md`. Never echo secret values.

- [ ] **Step 5: Verify settings and secret names**

Run:

```bash
gh repo view 6th-Element-Labs/dispatch --json visibility,hasIssuesEnabled,hasProjectsEnabled,hasWikiEnabled
gh secret list --env release --repo 6th-Element-Labs/dispatch
```

Expected: PUBLIC, issues true, projects/wiki false, and all nine secret names.

---

### Task 6: Export and push the clean v0.1.0 source snapshot

**Files:** public repository first commit

**Interfaces:**
- Consumes: private `main` and Package 1 export command
- Produces: public `main` commit `Release v0.1.0`

- [ ] **Step 1: Create a clean temporary public clone**

Run:

```bash
WORK="$(mktemp -d "${TMPDIR:-/tmp}/dispatch-public-release.XXXXXX")"
git clone https://github.com/6th-Element-Labs/dispatch.git "$WORK/public"
```

- [ ] **Step 2: Export with verification**

Run from private canonical:

```bash
node scripts/export-public-release.mjs \
  --destination "$WORK/public" \
  --ref HEAD \
  --version 0.1.0 \
  --verify
```

- [ ] **Step 3: Review and commit**

Run:

```bash
git -C "$WORK/public" status --short
git -C "$WORK/public" diff --check
git -C "$WORK/public" add -A
git -C "$WORK/public" \
  -c user.name="StevenRidder" \
  -c user.email="steve@6elementlabs.com" \
  commit -m "Release v0.1.0"
```

Review `git -C "$WORK/public" ls-files` before push. Confirm no forbidden path or private repository reference.

- [ ] **Step 4: Push public main**

Run:

```bash
git -C "$WORK/public" push origin main
PUBLIC_SHA="$(git -C "$WORK/public" rev-parse HEAD)"
```

- [ ] **Step 5: Wait for public CI**

Run:

```bash
RUN_ID="$(gh run list --repo 6th-Element-Labs/dispatch \
  --workflow verify.yml --branch main --limit 1 --json databaseId --jq '.[0].databaseId')"
gh run watch "$RUN_ID" --repo 6th-Element-Labs/dispatch --exit-status
```

Stop if CI is not green.

- [ ] **Step 6: Protect public main**

Run:

```bash
gh api --method PUT \
  repos/6th-Element-Labs/dispatch/branches/main/protection \
  --input - <<'JSON'
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["public-ci/full-suite"]
  },
  "enforce_admins": true,
  "required_pull_request_reviews": null,
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false
}
JSON
```

Verify protection with `gh api repos/6th-Element-Labs/dispatch/branches/main/protection`.

---

### Task 7: Protect release tags and create v0.1.0

**Files:** external GitHub tag and ruleset

**Interfaces:**
- Consumes: green public main
- Produces: protected `v0.1.0` and running release workflow

- [ ] **Step 1: Protect release tags**

Run:

```bash
gh api --method POST repos/6th-Element-Labs/dispatch/rulesets --input - <<'JSON'
{
  "name": "Protect release tags",
  "target": "tag",
  "enforcement": "active",
  "conditions": {
    "ref_name": {
      "include": ["refs/tags/v*"],
      "exclude": []
    }
  },
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" }
  ],
  "bypass_actors": []
}
JSON
```

- [ ] **Step 2: Run post-migration readiness**

Run:

```bash
node scripts/check-release-readiness.mjs \
  --version 0.1.0 \
  --public-repo 6th-Element-Labs/dispatch \
  --post-rename
```

Expected: PASS.

- [ ] **Step 3: Create the annotated tag on the public release commit**

Run:

```bash
git -C "$WORK/public" tag -a v0.1.0 -m "Dispatch v0.1.0" "$PUBLIC_SHA"
git -C "$WORK/public" push origin v0.1.0
```

- [ ] **Step 4: Approve the release environment**

When GitHub pauses the signed job, Steve reviews the source SHA and approves the `release` environment. Do not bypass the environment.

- [ ] **Step 5: Wait for the release workflow**

Run:

```bash
RUN_ID="$(gh run list --repo 6th-Element-Labs/dispatch \
  --workflow release.yml --branch v0.1.0 --limit 1 --json databaseId --jq '.[0].databaseId')"
gh run watch "$RUN_ID" --repo 6th-Element-Labs/dispatch --exit-status
```

Expected: green workflow and a draft `v0.1.0` release.

---

### Task 8: Validate and publish the first release

**Files:** external draft GitHub Release

**Interfaces:**
- Consumes: draft assets
- Produces: published `v0.1.0`

- [ ] **Step 1: Download draft assets**

Run:

```bash
ASSETS="$(mktemp -d "${TMPDIR:-/tmp}/dispatch-v0.1.0.XXXXXX")"
gh release download v0.1.0 \
  --repo 6th-Element-Labs/dispatch \
  --dir "$ASSETS"
```

- [ ] **Step 2: Verify checksums and updater manifest**

Run:

```bash
(cd "$ASSETS" && shasum -a 256 -c SHA256SUMS.txt)
node apps/desktop/scripts/validate-updater-manifest.mjs \
  --manifest "$ASSETS/latest.json" \
  --assets "$ASSETS" \
  --version 0.1.0
```

- [ ] **Step 3: Verify native signing and notarization**

Mount the DMG and run:

```bash
codesign --verify --deep --strict "/Volumes/Dispatch/Dispatch.app"
spctl --assess --type execute "/Volumes/Dispatch/Dispatch.app"
xcrun stapler validate "/Volumes/Dispatch/Dispatch.app"
```

- [ ] **Step 4: Complete clean-Mac and updater acceptance**

Use a Mac without the development checkout. Verify:

- Finder installation without Gatekeeper bypass;
- bundled services;
- missing-Codex state;
- real Codex/Gmail connection;
- service logs;
- two-version updater acceptance from Package 3.

Record only synthetic or redacted evidence.

- [ ] **Step 5: Publish**

After Steve explicitly approves the acceptance result:

```bash
gh release edit v0.1.0 \
  --repo 6th-Element-Labs/dispatch \
  --draft=false \
  --latest
```

- [ ] **Step 6: Verify public availability**

Run:

```bash
gh release view v0.1.0 --repo 6th-Element-Labs/dispatch
curl -I https://github.com/6th-Element-Labs/dispatch/releases/latest/download/latest.json
curl -I https://github.com/6th-Element-Labs/dispatch/releases/latest
```

Expected: release is public, `latest.json` is 200, DMG is downloadable, and public source commit matches `v0.1.0`.

---

## Rollback rules

- Before public repo creation: rename `dispatch-private` back to `dispatch` if private verification fails.
- After public repo creation: do not rename back. Repair forward.
- Before tag creation: fix the public source snapshot and rerun public CI.
- After tag creation but before publication: keep or delete the draft only if no user could install it; use a new patch tag when signed assets have escaped.
- After publication: never replace `v0.1.0`; publish `v0.1.1`.
- Never delete or rotate the updater private key without a signed key-rotation design.

## Package 4 completion gate

Required evidence:

- private canonical is `dispatch-private`;
- private `dispatch-ci` proof flow is green;
- public `dispatch` has one clean release commit;
- public security settings and protected environment are active;
- public CI passed before tag creation;
- signed and notarized draft assets passed checksum, Gatekeeper, staple, clean-Mac, and updater acceptance;
- `v0.1.0` is public and immutable;
- no credential, private mail, account identifier, internal plan, or machine path is public.
