# Stable Tauri Updater Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let signed Dispatch installations detect one stable update channel, ask before download, verify the updater signature, ask before install and restart, and leave mail and Codex usable on every failure.

**Architecture:** Updater lifecycle stays inside the native Rust shell. A small coordinator owns last result and one in-flight check. Tauri's updater plugin downloads and verifies bytes; Dispatch uses the existing launchd drain contract before install, resumes services after an install failure, and restarts only after explicit approval.

**Tech Stack:** Rust, Tauri 2 updater and dialog plugins, GitHub Releases `latest.json`, Tauri updater signatures, native unit tests

## Global Constraints

- Packages 1 and 2 must be complete.
- One stable channel only.
- Endpoint: `https://github.com/6th-Element-Labs/dispatch/releases/latest/download/latest.json`.
- Generate one real Tauri updater keypair before committing configuration.
- Commit only the updater public key.
- Store the updater private key in the protected `release` environment and an encrypted offline backup.
- Keep updater logic out of `services/web`.
- Check once after launch without blocking service startup.
- Ask before download.
- Ask again before install and restart.
- A failed check, download, verification, install, or restart preparation must leave the current app usable.
- Do not show a launch-time network error dialog. Manual Check for Updates must show the last or current error.
- Browser tests do not prove updater acceptance.

---

## File map

- Create: `apps/desktop/src-tauri/src/updater.rs` — native update coordinator and flow
- Create: `apps/desktop/scripts/validate-updater-manifest.mjs`
- Create: `apps/desktop/scripts/validate-updater-manifest.test.mjs`
- Create: `deploy/public/docs/UPDATES.md` — updater behavior and recovery
- Modify: `apps/desktop/src-tauri/src/lib.rs` — plugin, state, post-launch check, menu event
- Modify: `apps/desktop/src-tauri/src/menu.rs` — Check for Updates item
- Modify: `apps/desktop/src-tauri/src/background.rs` — drain/resume update boundary
- Modify: `apps/desktop/src-tauri/Cargo.toml`
- Modify: `apps/desktop/src-tauri/Cargo.lock`
- Modify: `apps/desktop/src-tauri/tauri.conf.json`
- Modify: `deploy/public/.github/workflows/release.yml` — updater keys and assets
- Modify: `deploy/public/docs/RELEASING.md`
- Modify: `deploy/public-export-manifest.json`
- Modify: `scripts/dispatch_ci.sh`

---

### Task 1: Generate and protect the updater signing key

**Files:**
- Modify: `apps/desktop/src-tauri/tauri.conf.json`
- Create outside Git: `~/.tauri/dispatch.key`
- Create outside Git: encrypted offline backup of `dispatch.key`

**Interfaces:**
- Consumes: Tauri signer CLI
- Produces: real public key in config and private key GitHub secrets

- [ ] **Step 1: Generate the keypair**

Run:

```bash
mkdir -p "$HOME/.tauri"
npm --prefix apps/desktop exec tauri signer generate -- \
  -w "$HOME/.tauri/dispatch.key"
```

Use a non-empty password. Save the private key and password in the approved password manager. Copy the private key to an encrypted offline backup.

- [ ] **Step 2: Record the public key**

Write the exact generated public key into Tauri config:

```bash
PUBKEY="$(cat "$HOME/.tauri/dispatch.key.pub")"
PUBKEY="$PUBKEY" node - <<'NODE'
const fs = require('node:fs')
const path = 'apps/desktop/src-tauri/tauri.conf.json'
const config = JSON.parse(fs.readFileSync(path, 'utf8'))
config.bundle.createUpdaterArtifacts = true
config.plugins ??= {}
config.plugins.updater = {
  pubkey: process.env.PUBKEY,
  endpoints: ['https://github.com/6th-Element-Labs/dispatch/releases/latest/download/latest.json'],
}
fs.writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`)
NODE
```

Do not use a file path and do not commit a sample key.

- [ ] **Step 3: Add the endpoint and updater artifacts**

Verify that the command in Step 2 set `bundle.createUpdaterArtifacts` to `true`, wrote the generated key content to `plugins.updater.pubkey`, and set the one stable endpoint.

- [ ] **Step 4: Add protected environment secrets**

Run interactively against the public repository after Package 4 creates it:

```bash
gh secret set TAURI_SIGNING_PRIVATE_KEY \
  --env release --repo 6th-Element-Labs/dispatch \
  < "$HOME/.tauri/dispatch.key"
gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD \
  --env release --repo 6th-Element-Labs/dispatch
```

If the public repository does not exist yet, stop after the offline backup. Package 4 adds the secrets before the first tag.

- [ ] **Step 5: Commit only the public config**

Run:

```bash
git status --short
git check-ignore "$HOME/.tauri/dispatch.key" || true
git add apps/desktop/src-tauri/tauri.conf.json
git commit -m "build: configure signed stable updates"
```

Verify no private key path appears in `git status` or `git diff --cached`.

---

### Task 2: Add pure updater state and prompt tests

**Files:**
- Create: `apps/desktop/src-tauri/src/updater.rs`
- Modify: `apps/desktop/src-tauri/src/lib.rs`

**Interfaces:**
- Produces:

```rust
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum UpdatePhase { Check, Download, Install }

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum UpdateOutcome {
    NeverChecked,
    UpToDate,
    Available { version: String, notes: String },
    Installed { version: String },
    Failed { phase: UpdatePhase, message: String },
}

#[derive(Default)]
pub struct UpdateCoordinator {
    outcome: Mutex<UpdateOutcome>,
    checking: AtomicBool,
}

pub fn available_prompt(version: &str, notes: Option<&str>) -> String
pub fn failure_message(phase: UpdatePhase, error: &str) -> String
pub fn should_check_on_launch(is_dev: bool) -> bool
```

- [ ] **Step 1: Write failing Rust tests**

Add tests in `updater.rs`:

```rust
#[test]
fn update_prompt_has_version_and_notes() {
    assert_eq!(
        available_prompt("0.1.1", Some("Fix Gmail sync.")),
        "Dispatch 0.1.1 is available.\n\nFix Gmail sync."
    );
}

#[test]
fn failures_name_the_failed_phase() {
    assert_eq!(
        failure_message(UpdatePhase::Download, "signature rejected"),
        "Dispatch could not download and verify the update: signature rejected"
    );
}

#[test]
fn development_builds_do_not_poll_production_updates() {
    assert!(!should_check_on_launch(true));
    assert!(should_check_on_launch(false));
}

#[test]
fn coordinator_rejects_a_second_check() {
    let state = UpdateCoordinator::default();
    assert!(state.begin_check());
    assert!(!state.begin_check());
    state.finish(UpdateOutcome::UpToDate);
    assert!(state.begin_check());
}
```

- [ ] **Step 2: Run and verify failure**

Run: `npm --prefix apps/desktop run test:native`

Expected: FAIL because the updater module and functions do not exist.

- [ ] **Step 3: Implement the pure state**

Implement `Default` as `NeverChecked`, use `AtomicBool::compare_exchange` for `begin_check`, and store outcomes behind `Mutex`. `finish` updates the outcome and clears `checking`. Strip notes and limit displayed notes to 2,000 UTF-8 characters.

Add `mod updater;` in `lib.rs`.

- [ ] **Step 4: Verify**

Run: `npm --prefix apps/desktop run test:native`

Expected: all native tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src-tauri/src/updater.rs apps/desktop/src-tauri/src/lib.rs
git commit -m "test(desktop): define stable update state"
```

---

### Task 3: Add the updater plugin and native menu action

**Files:**
- Modify: `apps/desktop/src-tauri/Cargo.toml`
- Modify: `apps/desktop/src-tauri/Cargo.lock`
- Modify: `apps/desktop/src-tauri/src/menu.rs`
- Modify: `apps/desktop/src-tauri/src/lib.rs`
- Modify: `apps/desktop/src-tauri/src/updater.rs`

**Interfaces:**
- Consumes: `tauri_plugin_updater::UpdaterExt`
- Produces:

```rust
pub fn spawn_post_launch_check(app: AppHandle)
pub fn check_from_menu(app: AppHandle)
```

- [ ] **Step 1: Add failing menu tests**

Refactor menu item IDs into a pure list helper:

```rust
#[test]
fn application_menu_includes_update_check() {
    assert!(application_item_ids().contains(&CHECK_FOR_UPDATES));
}
```

Add:

```rust
pub const CHECK_FOR_UPDATES: &str = "check-for-updates";
```

and expect the test to fail until it enters `application_item_ids`.

- [ ] **Step 2: Run and verify failure**

Run: `npm --prefix apps/desktop run test:native`

Expected: FAIL because the update item is absent.

- [ ] **Step 3: Add dependencies and plugins**

Add:

```toml
tauri-plugin-updater = "2"
```

to desktop dependencies. Tauri's `AppHandle::restart()` is sufficient; do not add the process plugin.

Initialize:

```rust
.plugin(tauri_plugin_updater::Builder::new().build())
```

before setup. Build checks with:

```rust
app.updater_builder()
    .timeout(std::time::Duration::from_secs(15))
    .build()?
    .check()
    .await?
```

- [ ] **Step 4: Add the menu item**

Build `Check for Updates…` after `Open Service Logs` and before the separator. Handle it in `lib.rs`:

```rust
menu::CHECK_FOR_UPDATES => updater::check_from_menu(app.clone()),
```

- [ ] **Step 5: Implement check-only behavior**

Use:

```rust
if let Some(update) = app.updater()?.check().await? {
    UpdateOutcome::Available {
        version: update.version.clone(),
        notes: update.body.clone().unwrap_or_default(),
    }
} else {
    UpdateOutcome::UpToDate
}
```

For post-launch checks, store failures and write them to stderr without a dialog. For manual checks, show:

- "Dispatch is up to date." for no update;
- a visible error dialog for failure;
- the download prompt for an available update.

Spawn `spawn_post_launch_check` only after services start successfully. Skip it when `tauri::is_dev()`.

- [ ] **Step 6: Verify**

Run:

```bash
npm --prefix apps/desktop run test:native
npm --prefix apps/desktop run stage
npm --prefix apps/desktop run build:native -- --bundles app
```

Expected: native tests and updater-enabled app compilation pass.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src-tauri/Cargo.toml apps/desktop/src-tauri/Cargo.lock apps/desktop/src-tauri/src/menu.rs apps/desktop/src-tauri/src/lib.rs apps/desktop/src-tauri/src/updater.rs
git commit -m "feat(desktop): check the stable update channel"
```

---

### Task 4: Coordinate download, service drain, install, and restart

**Files:**
- Modify: `apps/desktop/src-tauri/src/background.rs`
- Modify: `apps/desktop/src-tauri/src/updater.rs`

**Interfaces:**
- Produces:

```rust
pub fn prepare_for_app_update() -> Result<(), String>
pub fn resume_after_failed_app_update()
```

- [ ] **Step 1: Write failing drain boundary tests**

Extract a testable decision helper:

```rust
#[test]
fn update_requires_every_loaded_service_to_be_idle() {
    assert!(all_services_idle(&[true, true]));
    assert!(!all_services_idle(&[true, false]));
}
```

Add a test that `available_prompt` does not imply permission to download and that install failure maps to `UpdatePhase::Install`.

- [ ] **Step 2: Run and verify failure**

Run: `npm --prefix apps/desktop run test:native`

Expected: FAIL because update drain functions do not exist.

- [ ] **Step 3: Expose the update drain boundary**

Implement:

```rust
pub fn prepare_for_app_update() -> Result<(), String> {
    if drain()? { Ok(()) }
    else { Err("Codex or a mail operation is still working. Let it finish before installing the update.".into()) }
}

pub fn resume_after_failed_app_update() {
    for service in Service::ALL {
        if loaded(service) {
            let _ = request(service, "/v1/runtime/resume", "POST");
        }
    }
}
```

Do not unload services before replacing the app. Their versioned runtime copies remain valid. The next launch performs the existing runtime-id drain and upgrade.

- [ ] **Step 4: Implement two approvals**

Use `MessageDialogButtons::OkCancelCustom`:

1. `Download` / `Not Now` before calling `update.download`.
2. `Install and Restart` / `Later` after verified bytes return.

Download with:

```rust
let bytes = update.download(|_, _| {}, || {}).await?;
```

The plugin verifies the signature before returning bytes.

Before install:

```rust
background::prepare_for_app_update()?;
if let Err(error) = update.install(bytes) {
    background::resume_after_failed_app_update();
    return Err(error.into());
}
app.restart();
```

If the user chooses Later, drop the bytes and leave services unchanged.

- [ ] **Step 5: Verify**

Run:

```bash
npm --prefix apps/desktop run test:native
npm --prefix apps/desktop run build:native -- --bundles app
```

Expected: all tests and native compilation pass.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src-tauri/src/background.rs apps/desktop/src-tauri/src/updater.rs
git commit -m "feat(desktop): approve and drain before updates"
```

---

### Task 5: Generate and validate updater release artifacts

**Files:**
- Create: `apps/desktop/scripts/validate-updater-manifest.mjs`
- Create: `apps/desktop/scripts/validate-updater-manifest.test.mjs`
- Modify: `apps/desktop/package.json`
- Modify: `deploy/public/.github/workflows/release.yml`
- Modify: `scripts/dispatch_ci.sh`

**Interfaces:**
- Produces:

```bash
node apps/desktop/scripts/validate-updater-manifest.mjs \
  --manifest /tmp/dispatch-updater/latest.json \
  --assets /tmp/dispatch-updater \
  --version 0.1.0
```

- [ ] **Step 1: Write failing manifest tests**

Fixture tests assert:

```js
assert.equal(manifest.version, '0.1.0')
assert.ok(manifest.platforms['darwin-aarch64'])
assert.match(platform.signature, /^untrusted comment:/)
assert.ok(platform.url.endsWith('.app.tar.gz'))
```

Reject a URL without a matching local archive, a signature that is a URL or path, a missing `.sig`, and a version mismatch.

- [ ] **Step 2: Run and verify failure**

Run: `node --test apps/desktop/scripts/validate-updater-manifest.test.mjs`

Expected: FAIL because the validator is missing.

- [ ] **Step 3: Implement validation**

Parse JSON, require HTTPS GitHub release URLs, require `darwin-aarch64`, compare the signature field to the complete local `.sig` file content, and reject any extra platform for the first release.

Add:

```json
"release:verify-updater": "node scripts/validate-updater-manifest.mjs"
```

to `apps/desktop/package.json`.

- [ ] **Step 4: Extend the release workflow**

Supply:

```yaml
          TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
          TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
```

to `tauri-apps/tauri-action@v1`. Keep its updater JSON and signature uploads enabled. After build, download or locate `latest.json`, `.app.tar.gz`, and `.sig`, then run `release:verify-updater` before draft publication completes.

Add validator tests to `scripts/dispatch_ci.sh`.

- [ ] **Step 5: Verify unsigned local artifact generation**

Run:

```bash
export TAURI_SIGNING_PRIVATE_KEY="$(cat "$HOME/.tauri/dispatch.key")"
read -rs TAURI_SIGNING_PRIVATE_KEY_PASSWORD
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD
npm --prefix apps/desktop run build:native -- --target aarch64-apple-darwin
find apps/desktop/src-tauri/target/aarch64-apple-darwin/release/bundle \
  \( -name '*.app.tar.gz' -o -name '*.sig' \) -print
```

Do not save the password in shell history. Use a temporary shell with leading-space history suppression or `read -s`.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/scripts/validate-updater-manifest.mjs apps/desktop/scripts/validate-updater-manifest.test.mjs apps/desktop/package.json deploy/public/.github/workflows/release.yml scripts/dispatch_ci.sh
git commit -m "build: publish signed stable updater artifacts"
```

---

### Task 6: Document and execute updater acceptance

**Files:**
- Create: `deploy/public/docs/UPDATES.md`
- Modify: `deploy/public/docs/RELEASING.md`
- Modify: `deploy/public-export-manifest.json`

**Interfaces:**
- Consumes: two locally updater-signed versions
- Produces: recorded acceptance evidence for detection, approval, signature rejection, network failure, install, and restart

- [ ] **Step 1: Add the acceptance runbook**

Document:

1. build `0.1.0` and install it;
2. build `0.1.1`;
3. create a test `latest.json` with `darwin-aarch64`;
4. serve it over local HTTPS or a controlled GitHub draft asset;
5. use a test-only Tauri config overlay for the endpoint;
6. verify Download and Not Now;
7. verify Install and Restart and Later;
8. corrupt one signature and verify rejection;
9. stop the server and verify manual Check for Updates shows a failure while mail remains usable;
10. verify launch-time failure does not show a blocking dialog.

Do not set `dangerousInsecureTransportProtocol` in production config.

- [ ] **Step 2: Perform the two-version acceptance**

Record:

- old and new version;
- updater archive SHA-256;
- manifest SHA-256;
- bad-signature result;
- offline result;
- successful installed version after restart.

Store only redacted evidence in the private release checklist. Do not commit private keys, passwords, or real mail.

- [ ] **Step 3: Run package checks**

Run:

```bash
npm --prefix apps/desktop run test:native
node --test apps/desktop/scripts/validate-updater-manifest.test.mjs
bash scripts/dispatch_ci.sh
bash scripts/verify-public-export.sh
```

Expected: PASS.

- [ ] **Step 4: Commit docs**

```bash
git add deploy/public/docs/UPDATES.md deploy/public/docs/RELEASING.md deploy/public-export-manifest.json
git commit -m "docs: add stable update recovery and acceptance"
```

---

## Package 3 completion gate

Required evidence:

- real updater public key is committed;
- private key is absent from Git and backed up offline;
- native tests pass;
- update checks do not run in development;
- menu check shows up-to-date and error states;
- download and restart have separate approvals;
- active mail or Codex work blocks install;
- failed install resumes drained services;
- `latest.json` and signature validator pass;
- two-version native acceptance passes;
- production endpoint remains one stable channel.
