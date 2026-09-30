# Dispatch reliability repairs — September 30, 2026

Implementation base: `a130dab98e3e7f1e995df97bc47366e8916178f1` (the existing Codex runtime/durable-save branch, PR #122). Repair branch: `codex/dispatch-reliability`. This report distinguishes code and controlled acceptance tests from an installed-app release.

Three GPT-6 Luna agents at max reasoning implemented draft workers, durable attachment commands, and editor recovery/UI. The managing agent implemented file cache isolation, draft-conflict comparison, downloaded-body search, contracts and integration review. Review required extra regressions for stale attachment snapshots, edits reverting during a write, empty-file retries, typing during conflict resolution, incomplete pagination, and explicit file removal during a pending or failed append.

The combined browser gate also found legacy save fixtures still targeting the replaced synchronous draft endpoint, plus a real compose-state bug: unrelated unsaved drafts with empty IDs shared recipient-row state. Fixtures now use the durable save contract while retaining their original behavior assertions; compose identity requires a stable ID. Preserved provider HTML is sanitized at all three draft-preview entry points. Repeated Reply/Forward clicks reuse a locally accepted draft while Gmail is pending; switching Reply to Reply all updates recipients while retaining the body, files and recovery identity.

## Implemented contracts

| Audit item | Implementation | Regression evidence |
|---|---|---|
| D1: stale queued job overwrites newer work or cancellation | Workers select current SQLite records; recheck revision/cancellation after provider reads; preserve newer revisions after acknowledgment. | `draft-save-queue.test.ts`: later-job revision, cancellation, restart and in-flight reversion. |
| D2: concurrent attachment updates lose files | Durable operation-ID append intents and bytes use the same draft queue as editor saves; queued creation IDs work; retries compare exact bytes. | Queue and provider fixtures: concurrent files with the same name/different bytes, offline restart, lost response, queued create and stale editor snapshots. |
| D3: shared recovery array loses drafts | Independent synchronous draft/revision records, durable revision acknowledgments, non-destructive legacy migration and committed IndexedDB file bytes. | Controlled storage interleaving plus two real Playwright pages sharing localStorage; reload recovery of text, recipients and file bytes. |
| D4: cache lacks account identity/integrity | Account/message/file namespace with hashed original IDs, staged bytes/manifests, size/SHA-256 validation and zero-byte support. | Cache collisions, sanitization aliases, legacy rejection, corrupt/interrupted entries, coalescing and empty files. |
| G1: external draft changes are overwritten | Original editor baseline, field-specific changes, preserved same-field conflicts, expected-revision resolution and archived copies before choosing. | Field tests, durable queue conflict resolution and browser typing during delayed choices. |
| G2: slow account blocks other writes | Up to four independent account workers for drafts and actions; ordered account commands, retained backoff and active-work drain accounting. | Blocked account A/healthy account B, same-account order and runtime drain tests. |
| G3: provider sync capability | Retain supported bounded search scans; reject repeated token cycles before reconciliation; verify off-head moves/deletions and incomplete scan safety. | Complete two-page stream convergence, cyclic tokens, 100-page incomplete stream and retained Retry-After coverage. |
| G4: incomplete threads/offline coverage | Supplement missing indexed IDs with four bounded readers; explicit partial status at cap; preserve complete cache; full-body SQLite FTS; explicit thread attachment download/status/retry. | Threads above 100 messages, short-thread no-extra-read budget, failed supplement/download, offline body search/restart/filter isolation and browser file coverage. |

## Provider limits and acceptance still required

The installed adapter exposes search pagination but no Gmail history/list-history or conditional draft update capability. These changes retain the installed Codex connector. Direct Gmail OAuth requires a Dispatch-owned registration and native credential lifecycle; it was not introduced by this repair. A history checkpoint cannot be fabricated from search page tokens.

Draft conflict detection compares editable fields from a fresh Gmail read with the saved baseline. Legacy recovery records that never stored a baseline cannot reconstruct that evidence. It cannot prevent a remote edit made between that read and the subsequent write. A thread reaching the connector's 100-message cap remains partial without an authoritative total, even after every known indexed ID is loaded. Old ambiguous file-cache entries are deliberately fetched again; they cannot safely be attributed to an account.

Real Gmail and native desktop acceptance remains separate: sleep/wake with network recovery, simultaneous editing in Gmail/Dispatch, two native windows, actual provider attachment round-trip and long-running crash/restart testing. Fixture timings do not establish the proposed navigation or wake p95 targets. No email was sent or mutated by these tests, and no installed app was replaced.

## Validation

`bash scripts/dispatch_ci.sh` completed successfully against the final repair tree:

| Gate | Result |
|---|---|
| Service boundaries | Passed |
| Repository/native script tests | 41 passed |
| Mail typecheck and tests | Passed; 252 tests |
| Agent typecheck and tests | Passed; 100 tests |
| Web typecheck, tests and production build | Passed; 121 tests |
| Playwright browser acceptance | 172 passed; one optional public README screenshot test skipped |
| Whitespace check | `git diff --check` passed |

The repository gate passed **686 tests** in total. The final log is retained at `../audit/dispatch-gap-evidence-2026-09-30/repair-ci.log` in the audit workspace. Earlier failed integration logs are preserved separately; those failures drove the staging-timing fixture repair, durable-save fixture migration and compose-state fix described above. The preview sanitization test failed with sanitization temporarily disabled (unsafe attributes and actual script execution), then passed after restoration.

Native regression tests: `cargo test --offline --manifest-path apps/desktop/src-tauri/Cargo.toml` passed **43 tests**. The two localhost-listener tests needed sandbox escalation. Existing native dead-code warnings are unchanged. The isolated checkout used a copy of the existing bundled Node binary for the native build prerequisite; this was a test run, not a packaged app release.

## 1 October live release follow-up

PRs #122 and #123 landed in canonical main at `7da041240ab04e0700bf365869f0894d209c3e30`. That exact source was rebuilt, installed and opened on this Mac. Both live services reported the installed runtime ID and the native UI connected to all three Gmail accounts and the installed Codex harness. The initial source was verified by public CI run `36753546351`; private Actions remains disabled.

A controlled unsent Gmail draft to the owner's test account exposed an additional MIME case. Gmail stored an empty file as an explicit zero-byte MIME part, without an attachment download ID. Dispatch attempted to download the part as if it were an attachment ID and left its durable save pending. The repair distinguishes `mime-part:<part_id>` selectors from real attachment IDs, verifies the exact part and filename, and reads explicit embedded bytes. Missing content is not assumed empty; raw MIME is required instead. A fresh authoritative Gmail read through the repaired source verified both the 105-byte test file and the zero-byte file against their exact SHA-256 values.

Append operation Content-IDs also caused ordinary files to be sent as inline MIME. The adapter now uses inline disposition only for a CID referenced by the HTML body, preserving real inline images while keeping normal files as attachments. Regression tests cover the actual empty-file response, missing-content rejection, operation retry and MIME disposition. Remote CI is restricted to public repositories in the contributor guide, sandbox helper and every workflow job.

This follow-up does not establish sleep/wake timings, simultaneous external draft-edit acceptance, or long-duration crash testing. The installed runtime's healthy agent endpoint retains an available-model refresh timeout from startup; successful Gmail connector operations and the connected Codex UI are verified separately from that diagnostic.
