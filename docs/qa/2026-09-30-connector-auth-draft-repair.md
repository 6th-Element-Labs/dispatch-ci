# Connector login and draft approval repair — 2026-09-30

## Diagnosis

Dispatch's Gmail adapter and the selected email's Codex turn failed with a first-party transport HTTP 401 (`token_revoked`). The same Gmail account was accessible through the current desktop Codex connector. A supported `account/read` with `refreshToken: true` restored Dispatch's existing connector process without relinking Gmail.

The failed turn's internal `create_draft` returned `MCP tool call requires approval, but approval policy is never`. The existing chat retained `never`; a newly started default chat used `on-request`. Per-tool approval now permits user-authorized create/update draft operations without changing global or send policy.

## Validation

- Required `bash scripts/dispatch_ci.sh` passed: 41 script checks, 178 mail, 95 agent, 108 web unit tests, 157 browser tests; one browser test skipped.
- Final agent suite: 96 passed after adding coverage for a second in-flight account read arriving after token renewal.
- Actual Codex 0.159.2 agent turn under `approvalPolicy: never` completed `dispatch_mail.create_draft` against an isolated fake mail owner. No real mail was sent by this test.
- The user's failed reply was saved through the normal mail command, read back from Gmail with its exact proposed text above quoted history, and opened in the native editor as an unsent draft.
- The native build completed with release updater artifact generation disabled for this local installation. The local bundle passed deep, strict ad hoc code-sign verification.
- Installed mail and agent runtime ID: `daca8a82f7b24212632d17a93a1a6f190b2a6ce74a7f391015780ca33989dd6a`; both healthy. Managed Codex 0.159.2 reported no runtime or App Server errors. Gmail sync completed and continued without an authentication error after restart.

Token renewal is coalesced and rate bounded. Only rejected Gmail reads receive one retry. Sends and draft writes are not replayed automatically, and unrelated provider failures remain failures. Agent-driven failures renew the login for subsequent actions without restarting or replaying the turn.
