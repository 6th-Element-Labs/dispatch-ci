# Durable Codex draft saves — 2026-09-30

Codex-created and updated drafts now reach a mail-owned durable queue before Gmail is contacted. A revoked login, disconnect, lost provider response or app/service restart leaves one editable pending draft in normal Drafts. The worker verifies the real Gmail headers, text and requested attachment bytes/removal before clearing pending. A stable creation UUID and MIME marker prevent duplicate creates. Partial updates preserve omitted MIME content, recipients and attachments. New editor revisions survive confirmation. Cancellation is immediate locally, with exact-ID provider cleanup retained across restart. Sends are excluded from retries.

The Reconnect control starts managed Codex sign-in after renewal fails. Its official OAuth URL opens in the system browser; App Server handles the callback. Automatic retries resume after recovery. Idle runtime replacement pauses the draft worker.

## Validation

- `bash scripts/dispatch_ci.sh`: 41 script tests, 193 mail tests, 98 agent tests, 108 web unit tests and 160 browser tests passed; one public-screenshot check skipped.
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml`: 43 native tests passed, including official OAuth URL routing.
- Failure tests cover token revocation, server acceptance followed by HTTP 500 or timeout, SQLite restart, stable create retries after confirmation, partial header changes, attachment bytes/removal, newer edits during create, cancellation during create, restarted cleanup and runtime-drain pause/resume.
- Browser tests open a pending Codex draft immediately, keep Send disabled until confirmation, adopt the Gmail identity without overwriting typing, and exercise the visible Reconnect action.
- Actual Codex 0.159.2 / GPT-6.1 Sol UAT used a synthetic connector and the real Dispatch mail service/MCP adapter. Live connectors were disabled only in this test thread. Under approval policy `never`, Codex called `dispatch_mail.create_draft`, received `syncState: pending` and reported that provider synchronization was not confirmed. Injected `HTTP 401 token_revoked` retained the exact submitted body. Restarting mail and restoring the synthetic connector produced exactly one verified provider draft. This proves harness integration with the failure/retry path, not a live Gmail outage test.
- Native app built with local updater-artifact creation disabled, ad hoc signed, signature verified, installed and reopened. Previous app retained at `/private/tmp/Dispatch-before-durable-drafts.app`.
- Both installed services report runtime ID `23642f48c3bd5155825cba5c34e0643c3c573641af09d935c68e658ece4ccd53` and healthy status. Agent reports Codex 0.159.2, automatic runtime updates enabled, and no App Server error. Native Inbox opened normally with all three accounts and GPT-6.1 Sol selected.

No real email was sent or real draft altered during this change's UAT. Login revocation was injected in isolation; live credentials were not revoked. Local tests and installation do not establish hosted CI or a merge to main.
