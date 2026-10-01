# Public source mirror and macOS release design

Date: 2026-09-20
Status: approved by Steve on 2026-09-20
Scope: clean public source snapshots, signed macOS releases, and stable automatic updates

## Goal

Publish Dispatch source in a clean public repository and let an Apple Silicon user download, verify, install, and update a signed macOS client.

The public repository is a release mirror. Private development remains in the canonical repository.

## Product decisions

- Rename the private canonical repository to `6th-Element-Labs/dispatch-private`.
- Create a fresh public repository at `6th-Element-Labs/dispatch`.
- Keep the private repository authoritative for normal development.
- Publish public source only when a signed release is prepared.
- Use Apache License 2.0.
- Name Steven Ridder as the copyright holder.
- Publish an Apple Silicon client for macOS 14 or later.
- Sign with a Developer ID Application certificate and notarize with Apple.
- Host downloads and updater files in public GitHub Releases.
- Support one stable update channel.
- Check for updates after launch and ask before download and restart.
- Enable public issues for feedback and private vulnerability reporting.
- Do not accept public pull requests because the public history contains release snapshots, not development history.
- Include product tests and simple public CI.
- Exclude internal plans, private CI machinery, and development-only files.

## Repository topology

### Private canonical repository

`6th-Element-Labs/dispatch-private` remains the authority for:

- normal branches and pull requests;
- product and architecture decisions;
- internal plans and specifications;
- the public export manifest and export command;
- release preparation;
- the existing `dispatch-ci` exact-SHA proof flow.

Renaming the existing repository preserves private issues, pull requests, branches, tags, settings, and history. Update local remotes, branch-protection references, CI scripts, and documentation to use `dispatch-private`. Do not depend on GitHub's old-name redirect.

### Public release mirror

`6th-Element-Labs/dispatch` starts with one clean release commit. Its history contains one source snapshot commit per public release:

```text
Release v0.1.0
Release v0.1.1
Release v0.2.0
```

The public repository is buildable and testable. It is not a live mirror of private `main`.

Issues remain enabled. The README and contribution policy state that pull requests are not accepted. Public issue templates forbid private email, OAuth data, tokens, account IDs, and unredacted logs.

## Public tree

The export uses an explicit allowlist. It includes:

- `apps/desktop`;
- `services/web`;
- `services/mail`;
- `services/agent`;
- `contracts`;
- `deploy/service-boundary-contract.json`;
- the scripts required to install, build, validate boundaries, and run public CI;
- product tests;
- public GitHub Actions;
- `README.md`;
- `LICENSE`;
- `NOTICE`;
- `SECURITY.md`;
- `CONTRIBUTING.md`;
- public issue templates;
- public product, architecture, and design documents.

The export excludes:

- `docs/superpowers`;
- `docs/CI-SANDBOX.md`;
- the private CI sandbox scripts;
- internal agent files and planning artifacts;
- `.superpowers`;
- local databases, mail, attachments, logs, caches, and test output;
- build output and Tauri targets;
- every `node_modules` path, including the current absolute symlinks;
- credentials, certificates, signing keys, API keys, auth files, and tokens.

The public `.gitignore` covers generated output and local data. Package `"private": true` fields remain because they prevent accidental npm or Cargo publication; they do not make the GitHub source private.

## Export contract

The private repository owns an export manifest and an export command. The command writes into a clean checkout of the public repository. It copies only allowlisted paths.

The export stops before changing the public repository when:

- private `main` is not clean;
- the private merge gate is not green;
- a required allowlisted file is missing;
- package, Cargo, and Tauri versions do not match;
- the target public tag already exists;
- a forbidden path enters the export;
- a secret scan finds a credential pattern;
- a tracked absolute path or `node_modules` symlink enters the export;
- the exported tree does not pass public tests;
- the public working tree contains unrelated changes.

The first release uses version `0.1.0`. The source commit is `Release v0.1.0`, and its tag is `v0.1.0`.

The first version of the export command uses the release operator's authenticated local GitHub session. It does not add a cross-repository write token to private CI.

## Licensing and notices

The public repository contains:

- the complete Apache License 2.0 text in `LICENSE`;
- a `NOTICE` file naming Steven Ridder;
- third-party notices for shipped Rust, npm, Tauri, and Node components.

Public CI checks shipped dependency licenses. It fails when:

- a dependency has no declared license;
- a required notice is absent;
- a dependency license is not approved for Apache 2.0 distribution.

The release archive and DMG include the required notices.

## Public documentation

### README

The public README starts with:

1. a screenshot that contains synthetic mail only;
2. a Download for Apple Silicon link to the latest signed DMG;
3. macOS 14 and Apple Silicon requirements;
4. the Codex CLI or current ChatGPT desktop requirement;
5. Gmail plugin connection steps;
6. a short privacy summary;
7. build-from-source instructions;
8. SHA-256 verification instructions.

The README does not claim that Dispatch supplies Codex, ChatGPT access, or Gmail credentials.

### Privacy

Public documentation states:

- Dispatch has no telemetry;
- Gmail credentials remain with Codex;
- Dispatch stores indexed mail in local SQLite;
- attachments, logs, and application data use documented macOS paths;
- removing the app does not remove the mail index;
- sending, deleting, recipient changes, and bulk actions require explicit approval;
- email content is untrusted and cannot grant authority.

The docs give exact commands or Finder paths to remove all Dispatch application data.

### Security and feedback

`SECURITY.md` directs security reports to GitHub private vulnerability reporting. Security reports do not belong in public issues.

`CONTRIBUTING.md` explains:

- public issues are welcome;
- the repository is a release snapshot mirror;
- public pull requests are not accepted;
- reports must use synthetic or redacted data.

## Public repository settings

Configure the public repository with:

- Issues enabled;
- Projects and Wiki disabled;
- private vulnerability reporting enabled;
- secret scanning and push protection enabled;
- Dependabot alerts enabled;
- protected `main`;
- no force pushes or branch deletion on `main`;
- required public CI;
- protected `v*` tags;
- a protected `release` environment with manual approval.

The public repository uses normal public Actions directly. It does not use `dispatch-ci`.

## macOS target

The first downloadable client supports:

- Apple Silicon (`aarch64-apple-darwin`);
- macOS 14 or later;
- one stable channel.

Set the macOS deployment target in Tauri and the build environment. Do not leave the generated bundle's current `10.13` minimum.

The existing ARM64 Node 22 sidecar remains pinned by version and SHA-256.

## Apple signing prerequisites

The local keychain currently has an Apple Development certificate, not a Developer ID Application certificate. Public distribution requires:

1. a Developer ID Application certificate;
2. a password-protected `.p12` export of that certificate;
3. an App Store Connect API issuer ID;
4. an App Store Connect API key ID;
5. its private `.p8` key;
6. the Apple Team ID.

No certificate or private key enters either repository.

Store release credentials in the public repository's protected `release` environment:

- `APPLE_CERTIFICATE`;
- `APPLE_CERTIFICATE_PASSWORD`;
- `APPLE_SIGNING_IDENTITY`;
- `APPLE_API_ISSUER`;
- `APPLE_API_KEY`;
- the `.p8` key content used to create `APPLE_API_KEY_PATH`;
- `APPLE_TEAM_ID`.

## Tauri updater

Add the Tauri v2 updater plugin to the native shell. Updating is shell lifecycle behavior. It does not move mail, agent, or presentation logic into Rust.

Configuration:

- `bundle.createUpdaterArtifacts` is `true`;
- the updater endpoint is the public repository's `latest.json`;
- the updater public key is compiled into the app;
- the updater private key and password exist only in the protected release environment and an offline backup.

Release secrets:

- `TAURI_SIGNING_PRIVATE_KEY`;
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.

Losing the updater private key prevents installed copies from trusting later updates. Keep an offline encrypted backup and recovery instructions.

### Update behavior

Dispatch checks once after launch without blocking service startup.

When a newer stable version exists:

1. show the version and release notes;
2. ask the user to download;
3. verify the signed updater artifact;
4. ask before restart;
5. install and restart only after approval.

A missing endpoint, GitHub outage, timeout, bad manifest, download failure, or bad signature leaves mail and Codex usable. The failure is visible from Check for Updates and does not create a false success state.

Add Check for Updates to the native application menu.

## Public release workflow

A pushed public `v*` tag starts the release workflow. The workflow:

1. checks out the tagged public source;
2. installs Node 22 and Rust;
3. adds the `aarch64-apple-darwin` target;
4. installs dependencies from lockfiles;
5. downloads and verifies the pinned ARM64 Node sidecar;
6. runs public boundary, unit, browser, and native checks;
7. verifies version consistency and dependency licenses;
8. builds for macOS 14 and Apple Silicon;
9. signs with Developer ID Application;
10. notarizes through the App Store Connect API;
11. staples the notarization ticket;
12. builds the DMG and updater archive;
13. creates signatures and `latest.json`;
14. creates `SHA256SUMS.txt`;
15. uploads all assets to a draft GitHub Release.

The protected `release` environment gates signing and publication. The release operator reviews the draft and approves publication only after acceptance passes.

Release assets:

- `Dispatch_<version>_aarch64.dmg`;
- the Tauri `.app.tar.gz` updater bundle;
- updater signature files;
- `latest.json`;
- `SHA256SUMS.txt`;
- GitHub source archives.

`latest.json` is published only after all referenced assets exist. Published release files are immutable.

## Verification and acceptance

### Export checks

- The export contains only allowlisted paths.
- The exported source builds without the private repository.
- No source file has an absolute path to the developer's computer.
- No local mail, account data, token, key, certificate, or log is present.
- Public tests pass from a fresh clone.

### macOS checks

Verify the release with:

- `codesign --verify --deep --strict`;
- `spctl --assess --type execute`;
- `xcrun stapler validate`;
- DMG mount and copy to Applications;
- launch from Finder on a Mac without the development checkout;
- bundled service startup;
- visible missing-Codex behavior;
- real Codex and Gmail connection acceptance;
- service logs at their documented location.

Browser tests do not count as native acceptance.

### Updater checks

Before enabling the production endpoint:

1. build two updater-signed local versions;
2. serve a test `latest.json`;
3. install the older version;
4. confirm detection of the newer version;
5. confirm download approval;
6. confirm restart approval;
7. confirm a bad signature is rejected;
8. confirm a network failure leaves the app usable.

### Release checks

- The public source commit matches the release tag.
- The DMG and updater archive come from that public workflow run.
- SHA-256 values match downloaded files.
- The GitHub Release is not published before all checks pass.
- A clean Mac can install and run the app without bypassing Gatekeeper.

## Failure and recovery rules

- Export failure does not modify the public repository.
- A version mismatch stops before commit or tag creation.
- Signing, notarization, or stapling failure leaves a draft release.
- A failed workflow never updates `latest.json`.
- A published release is never rebuilt or replaced under the same version.
- A faulty release gets a new patch version.
- The public source always matches its latest downloadable release.
- Updater failures never block normal startup.
- The release process never publishes credentials, private mail, account identifiers, or provider payloads in source, logs, artifacts, or issue templates.

## Migration sequence

1. Build and test the export manifest and public docs in the private repository.
2. Add macOS 14 targeting and updater behavior.
3. Add public CI and release workflows to the export.
4. Complete the Developer ID and App Store Connect credential setup.
5. Generate and back up the Tauri updater key.
6. Rename the private repository to `dispatch-private`.
7. Update private remotes, CI scripts, branch protection references, and documentation.
8. Create and configure the new public `dispatch`.
9. Export and push the clean `Release v0.1.0` commit.
10. Run public CI.
11. Push `v0.1.0`.
12. Review the signed and notarized draft release.
13. Complete clean-Mac and updater acceptance.
14. Publish the release.

## Implementation packages

This design is implemented as four reviewable packages:

1. Public export, license, documentation, and repository hygiene.
2. Signing, notarization, and public release workflow.
3. Tauri updater, menu action, prompts, and failure states.
4. GitHub repository migration and first `v0.1.0` release.

Each package must pass its own tests and review before the next package performs external repository or release changes.
