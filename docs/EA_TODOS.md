# EA and work across threads

Dispatch keeps work attached to people and topics rather than to one email subject.
The EA page and To-dos page are projections of the same local records. Every inferred
item has an exact quote and a link to its email or completed Codex discussion.

## Ownership

`services/work` is an independent localhost service on port 8413. It alone writes
`~/Library/Application Support/Dispatch/work.sqlite`. SQLite transactions store
tasks, decisions, source evidence, user overrides, scan settings and content
fingerprints. No service reads another service's database or private session files.
Mail owns message projection and excludes draft, trash and spam sources. Agent
owns access to Codex histories and calls the existing Codex App Server for structured
extraction. Web renders the work service's ordering and filters.

A contact identity is a normalized email address within a connected account.
Aliases are not merged by name. Topics have stable account-scoped IDs. Contact and
topic Codex chats have separate durable bindings, alongside existing email bindings.

## Extraction and continuity

The user starts review with Find open work or Find to-dos in this thread. A mailbox
review initially covers up to 30 recent indexed conversations per account, across
Inbox, Sent and Archive. Include older threads expands this window by 30. Once
started, review runs every five minutes while the background service runs. Its
progress, failures and window are visible; it does not claim full-mailbox coverage.

The mail service reuses complete downloaded conversations when the indexed message
IDs are all present. The work service hashes the supplied email and completed chat
sources. Unchanged evidence does not trigger another model call. Changed evidence
is sent with relevant existing records through a dedicated ephemeral App Server
thread and `turn/start.outputSchema`. This is one inference request through the
actual Codex harness, not an alternative agent loop. Apps, shell, web and configured
MCP servers are disabled for extraction. The user's interactive chats retain their
normal permission settings.

The model proposes records and existing-item links. The work service rejects
unknown accounts, identities, owners, invalid dates and quotes absent from the
supplied source. Validation precedes one transaction; a failed extraction never
advances the fingerprint. Explicit commitments and suggestions remain distinct.
Dates and owners can be unknown. Older evidence cannot roll back newer completion.

User edits, Done, Dismiss and Snooze take precedence over all future extraction.
Each edited field is protected separately: renaming a task still allows later
evidence to mark it complete. Undo restores the earlier values and override state.
Version checks prevent stale browser or Codex commands from overwriting a newer
edit. A new weekly email is reconciled with existing work for its participants.
Completed contact/topic chats are included on the next review of related mail.
New email chats receive saved work for the sender, including completed work and
decisions. A work-service outage leaves normal email chat usable and explicitly
marks that earlier context unavailable. Email, Contact and Topic controls select
separate chats; source-history links are read-only until a scope is selected.

## API contract

All endpoints use JSON, localhost only and bounded requests. Errors carry `error`
and `detail`. Service dependency errors leave persisted work available.

- Mail `GET /v1/work/candidates?limit=30`: recent indexed conversation summaries.
- Mail `GET /v1/work/sources?account=…&thread=…`: source IDs, account, addresses,
  timestamps and canonical message text. Incomplete or oversized sources fail
  explicitly rather than being silently marked reviewed.
- Agent `GET /v1/work/sources?account=…&thread=…&contacts=…&topics=…`: completed
  human/assistant messages from durable bindings, with chat/turn/item provenance.
- Agent `POST /v1/work/extract`: `{sources, existing}` → `{items}` with strict
  structured output; interrupted/failed turns are failures.
- Work `GET /v1/work`: items, decisions, people, topics, review status. Optional
  account/contact/topic/thread/filter parameters; ranking belongs to this service.
- Work `GET /v1/work/context`: bounded contact/topic context, including closed work
  and decisions, with explicit total/returned/limited coverage.
- Work `POST /v1/work/scan`: start/refresh review, or `{more:true}` for older mail.
- Work `POST /v1/work/pause`: pause automatic review and cancel pending extraction.
- Work `POST /v1/work/analyze`: review one exact account/thread.
- Work `POST /v1/work/items/:id`: expected revision plus user changes.
- Work `POST /v1/work/items/:id/undo`: restore the previous user action at its exact revision.
- Agent's Dispatch MCP exposes `list_work` and `update_todo` over those same APIs.

## UI and acceptance

EA and To-dos sit above mail in the compact/expanded rail and folder menu. To-dos
provide All, Mine, Waiting, Done and Snoozed. A detail shows owner, due date, topic,
contacts, exact evidence and source navigation. Done, Snooze, Dismiss and Undo use
local durable writes. Edit details changes title, owner and due date. Draft follow-up
opens the real unsent editor and asks Codex to fill it; it never sends automatically.
Mail's destructive keyboard shortcuts are disabled while work is visible.

Acceptance tests must cover two weekly threads from the same person, old Codex
context, one continuing task after restart, preserved user actions, invalid evidence
rollback, failed model responses, account isolation, and mail/work navigation.
Real Gmail/Codex and native checks are reported separately from fixture-based tests.
