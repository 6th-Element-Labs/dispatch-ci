# Gmail attachment compatibility

Dispatch uses the installed Codex App Server for Gmail tool calls. Direct MCP
calls do not run the file preprocessing used by a Codex model turn. Passing an
absolute file path to that route does not upload a file.

The agent service uploads bytes with native, in-memory Codex authorization using
the allocate, blob PUT, and finalize protocol in Codex 0.166.0:
- https://github.com/openai/codex/blob/rust-v0.166.0/codex-rs/codex-api/src/files.rs
- https://github.com/openai/codex/blob/rust-v0.166.0/codex-rs/core/src/mcp_openai_file.rs
- https://github.com/openai/codex/blob/rust-v0.166.0/codex-rs/codex-mcp/src/codex_apps/file_params.rs

Only the official ChatGPT backend receives native credentials. Blob transfers
receive no bearer token. Signed file URLs and tokens must not enter logs or
fixtures. This is an internal upstream protocol and requires compatibility
checks when Codex changes.

The November 4 connector accepts attachment files on create, but its documented
update action cannot edit a draft that already contains attachments. Mail owns
a durable replacement journal. It creates the full new snapshot, verifies
recipients, subject, body, file names/types/hashes and reply thread, then moves
only the old draft to Trash. An uncertain create is recovered by its exact
marker; it is never blindly repeated. The original remains if verification
fails. Replacing a new compose draft can change its Gmail thread identity; old
draft IDs continue resolving to the confirmed replacement. Replies retain the
received message anchor. Gmail-added history is recorded separately from the
authored editor body and is checked on subsequent reads.

Inline MIME Content-ID changes are not supported by the modern connector.
Dispatch retains the original and reports that limitation before a write.

## Automated checks

- Captured, account-free native create/update/send input schemas.
- Strict argument checks against fresh inventory before every draft write/send.
- Attachment metadata, required-field and field-type drift rejection.
- Candidate Codex runtime rollback when its Gmail contract is incompatible.
- Upload authorization, exact byte transport, finalization, bounded retries,
  failure redaction and invalid/oversized input checks.
- Attachment replacement, add/remove, newer typing, restart, lost create and
  cleanup responses, wrong file bytes, and discard during replacement.

`GET /v1/connectors/gmail/compatibility` refreshes inventory and checks the native
write and upload-authorization contracts. It does not send mail or prove a live
upload. Public CI uses synthetic data only. Run `bash scripts/dispatch_ci.sh`
and use `scripts/ci-sandbox.sh` for the exact commit in public dispatch-ci.
Never run private CI.

## Required native acceptance after connector changes

In the installed app, compose to an authorized test address, attach a PDF and a
text file (including a Unicode file name), edit the draft after attaching, and
click Send. Repeat with a reply. Read the actual Gmail Sent copy, check its
recipients and body, download each attachment and compare SHA-256 hashes, check
reply thread identity, and confirm no duplicate unsent copy remains. Move only
those test messages to Trash. A successful HTTP response or fixture test is not
native acceptance. Do not resend an ambiguous customer message as a test.
