# Task 5 Report: Mail draft API

## Status

Implemented the mail-owned draft preview, open, read, discard, and HTML save flow on `compose-drafts`.

## Changes

- Added `POST /v1/drafts/preview` before the parameterized draft route.
- Added `POST /v1/drafts/open` for Gmail messages.
- Added `GET /v1/drafts/:id?account=`.
- Added `POST /v1/drafts/:id?action=discard&account=`.
- Added demo draft read and discard operations.
- Changed Gmail draft create and update calls to send `bodyMarkdown`, rendered `bodyHtml`, `bodyText`, and attachments.
- Added a process-local Gmail draft projection map keyed by `accountId:draftId`.
- Added Gmail open logic that uses the source message text and copies attachment identity.
- Added connector error mapping for:
  - `gmail_html_unsupported`
  - `gmail_attachment_unsupported`
  - `gmail_draft_discard_unavailable`
- Kept all product changes in `services/mail`.

## TDD evidence

### RED: server routes

Command:

```text
npm --prefix services/mail test -- tests/server.test.ts
```

First result:

```text
Test Files  1 failed (1)
Tests       2 failed | 11 passed (13)
```

The preview and demo discard tests both received `404` instead of `200`.

After adding the complete route coverage, the second RED run showed:

```text
Test Files  1 failed (1)
Tests       5 failed | 11 passed (16)
```

The missing preview, demo read/discard, Gmail open/read/discard, and typed connector error behavior caused the expected failures.

### RED: Gmail provider

Command:

```text
npm --prefix services/mail test -- tests/gmail-provider.test.ts
```

Result:

```text
Test Files  1 failed (1)
Tests       3 failed | 5 passed (8)
```

The tests failed because `readGmailDraft`, `openGmailDraft`, and `discardGmailDraft` did not exist.

### GREEN: focused tests

Commands:

```text
npm --prefix services/mail test -- tests/gmail-provider.test.ts
npm --prefix services/mail test -- tests/server.test.ts
```

Results:

```text
gmail-provider.test.ts: 8 passed
server.test.ts: 16 passed
```

## Final verification

Required mail checks:

```text
npm --prefix services/mail test
Test Files  6 passed (6)
Tests       36 passed (36)

npm --prefix services/mail run typecheck
Exit code: 0
```

Repository check:

```text
bash scripts/dispatch_ci.sh
Exit code: 0
```

The repository check verified service boundaries, mail tests and typecheck, agent tests and typecheck, web tests and typecheck, the web build, and 23 browser tests.

## Files changed

- `services/mail/src/demo-provider.ts`
- `services/mail/src/gmail-provider.ts`
- `services/mail/src/server.ts`
- `services/mail/tests/gmail-provider.test.ts`
- `services/mail/tests/server.test.ts`

## Concerns

- Gmail draft reads use the required process-local map. A mail service restart clears this map.
- The full repository check printed existing dependency deprecation warnings during package installation. It completed successfully.

## Commit

`392bc67 feat(mail): preview, open, discard, and HTML draft save`

## Task 5 review fixes

- Rejected non-empty draft attachment arrays on Gmail create, update, and open routes with `502 gmail_attachment_unsupported`.
- Returned `400 invalid_json` when the create, preview, or open route receives JSON that is not a non-null object.
- Added server regression coverage for attachment rejection and invalid JSON.

## Verification

```text
npm --prefix services/mail test
Test Files  6 passed (6)
Tests       38 passed (38)

npm --prefix services/mail run typecheck
Exit code 0
```

## Task 5 remaining findings

- Gmail draft create and update now reject non-empty compose attachments before the agent request with `gmail_attachment_unsupported`.
- Gmail draft create and update agent JSON no longer includes `attachments`.
- Opening a Gmail message creates a draft with empty attachments and does not claim source attachments.
- Updated provider tests cover rejection, request omission, and empty open attachments.

## Final verification

```text
npm --prefix services/mail test
Test Files 6 passed (6)
Tests 38 passed (38)

npm --prefix services/mail run typecheck
Exit code 0
```
