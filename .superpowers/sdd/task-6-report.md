# Task 6 report: Web editor

## Status

Implemented and committed on `compose-drafts`.

Commit: `7ce09dd feat(web): Markdown compose, confirm send, discard, open drafts`

## Changes

- Aligned the web `DraftProjection` with the mail projection. It now includes `bodyMarkdown`, `bodyHtml`, `bodyText`, and draft attachments.
- Added mail API methods for Markdown preview, draft read, discard, and opening a Gmail draft from a Drafts row.
- Made create and update send the same Markdown value as `bodyMarkdown` and `bodyText`.
- Added the Markdown editor preview. It uses only HTML returned by the mail service.
- Added the 300 ms preview debounce and the 1500 ms saved-draft autosave debounce.
- Changed reply and forward to select the newest message by `latestMessageId`, with the first projected message as the fallback.
- Added the newest-message Markdown reply quote. Forward now passes the newest-message attachments.
- Opened Drafts-folder rows directly in the editor without loading the thread reader.
- Added the in-panel send confirm. Only `data-send-confirm-go` calls `api.sendDraft`.
- Added discard and attach controls. Attachment failures, including `gmail_attachment_unsupported`, appear in `data-draft-error`.
- Added the exact Codex revise prompt. The editor reloads the active draft from mail after a Codex turn completes.
- Added focused unit coverage for all new draft API routes and the Markdown compatibility payload.

## Verification

- `npm --prefix services/web run typecheck`: PASS.
- `npm --prefix services/web test`: PASS. 3 test files and 6 tests passed.
- Edited-file IDE diagnostics: PASS. No errors.
- `bash scripts/dispatch_ci.sh`: PARTIAL.
  - Service boundary check: PASS.
  - Mail typecheck and tests: PASS. 38 tests passed.
  - Agent typecheck and tests: PASS. 24 tests passed.
  - Web typecheck, unit tests, and build: PASS.
  - Playwright: 21 passed and 2 failed.

## Concerns

The two Playwright failures use the old Task 5 behavior:

1. The compose-save test expects only `bodyText`. The new required payload also has `bodyMarkdown` and `attachments`.
2. The send test expects the first Send click to send. The new required flow needs a second click on `Send now`.

Task 7 owns `services/web/tests/ui.spec.ts`, so this task did not change those tests.

The unrelated untracked `docs/superpowers/` files were not committed.

## Important review fixes

- Made send confirmation single-flight and disabled both send controls until the request completes.
- Serialized draft saves through one in-flight promise.
- Prevented a completed save from changing a different active draft.
- Tracked dirty body edits and flushed a pending autosave before conversation selection.
- A failed flush keeps the current draft open and shows the save error.

## Review fix verification

- `npm --prefix services/web run typecheck && npm --prefix services/web test`: PASS.
- 3 test files and 6 tests passed.
- No unit test module exists for the private `main.ts` editor state. The existing draft API tests do not cover browser state locks.

## Task 6 review fixes (second pass)

- Demo `openDraft` now sends the same `bodyMarkdown`/`bodyText` reply quote as the Gmail create path.
- Revise prompt now has a blank line after `Current draft:`.

Verification: `npm --prefix services/web run typecheck && npm --prefix services/web test` — PASS. 3 test files, 6 tests.

## Task 6 race fix

- Discard now ignores an in-flight send and disables its button for the send duration.
- Discard invalidates the editor session, waits for an in-flight save, and discards the saved draft ID.
- Save completions after discard cannot update or recreate the active draft.

Verification: `npm --prefix services/web run typecheck && npm --prefix services/web test` — PASS. 3 test files, 6 tests.
