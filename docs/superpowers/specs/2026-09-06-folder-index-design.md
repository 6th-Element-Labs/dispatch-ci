# Folder index — same folders, no 50-message cliff

Date: 2026-09-06
Status: draft for review
Slice: durable Gmail index coverage for the existing six folders

## Problem

The Inbox queue reads the durable SQLite index. Sent, Drafts, Archive, Spam, and Trash do not.

Those folders call live Gmail search, fetch one page of 50 messages, and cache that page for 60 seconds. Older folder mail never appears. After archive, trash, or spam, mail deletes the indexed row, so the destination folder stays empty until a later live fetch.

The API marks those lists `coverage: recent`. The web chrome shows `Recent Sent` and the same label for the other non-inbox folders.

## Goal

Give the six existing folders the same durable index Inbox already has.

A user who opens Sent, Drafts, Archive, Spam, or Trash sees the folder from the index, not a 50-message live page. Archive, trash, spam, and move-to-inbox update folder flags on the existing row. They do not delete the row and wait for the next sync.

The nav, folder set, All / Unread / Read queue rules, and search operators do not change.

## Non-goals

- New mailbox values, All Mail in the nav, or custom labels
- Unread-count badges or other folder chrome
- New search operators or a body index
- Compose attachments, signatures, undo send, or reader polish
- A second store, a shared mutable store, or a browser-owned index
- Changing Codex App Server or adding a second agent loop

## Architecture

```text
Inbox / Sent / Drafts / Archive / Spam / Trash
        |
        v
dispatch-mail  (only writer of gmail-index.sqlite)
        |
        +-- sync streams: INBOX, UNREAD, SENT, DRAFT, SPAM, TRASH, archive query
        |
        +-- one row per message, boolean folder flags
        |
        v
GET /v1/conversations?mailbox=…  coverage: indexed
```

Rules:

1. `dispatch-mail` remains the only writer of the Gmail index and of folder membership on that index.
2. `dispatch-web` stays presentation-only. It does not grow a second list source. After this slice it stops showing `Recent` for the six folders because mail reports `coverage: indexed`.
3. `dispatch-agent` stays the Gmail connector adapter. This slice does not add agent routes or Codex tools.
4. Each indexed message keeps boolean flags, same pattern as `in_inbox`. Mail does not store label-id sets or a membership table.
5. Folder lists for the six mailboxes read the index. Mail removes the one-page live fetch and the 60-second `#mailboxCache` path for those folders.
6. Fail in the open. A page-token repeat or a stream that exceeds the page cap fails the sync. Mail does not hide a short list as complete.

## Record

Extend `gmail_messages` with five integer 0/1 columns, same `CHECK` style as `in_inbox`:

| Column | Field | True when Gmail labels say |
|---|---|---|
| `in_inbox` | `inInbox` | `INBOX` (already exists) |
| `in_sent` | `inSent` | `SENT` |
| `in_drafts` | `inDrafts` | `DRAFT` |
| `in_spam` | `inSpam` | `SPAM` |
| `in_trash` | `inTrash` | `TRASH` |
| `in_archive` | `inArchive` | none of `INBOX`, `SENT`, `DRAFT`, `SPAM`, `TRASH` |

Existing databases `ALTER TABLE` each new column `INTEGER NOT NULL DEFAULT 0`. After migrate, mail schedules a sync so the new flags are not left at 0.

Primary key stays `(account_id, id)`. One message can have more than one flag true (for example Inbox and Sent). Archive is exclusive of the other five system folders.

`unread` and `has_attachment` stay as they are.

## Sync streams

Keep Inbox and Unread. Add one stream per remaining folder. Do not apply `-in:spam -in:trash` to every stream.

| Stream | Query | Label ids |
|---|---|---|
| Inbox | `-in:spam -in:trash` | `INBOX` |
| Unread | `-in:spam -in:trash` | `UNREAD` |
| Sent | `-in:trash` | `SENT` |
| Drafts | `-in:trash` | `DRAFT` |
| Spam | `in:spam` | `SPAM` |
| Trash | `in:trash` | `TRASH` |
| Archive | `-in:inbox -in:sent -in:drafts -in:spam -in:trash` | none |

Bootstrap and `refreshNow` fetch one page per stream, upsert, and do not delete other rows (`complete: false`).

Background and `syncNow` page each stream with the current 50-message page size and the current 100-page cap per stream. A leftover page token on a required-complete run fails the sync.

One `replaceAccount` snapshot per account per run. A complete run still deletes that account's rows with a different `sync_run_id`. Therefore every stream must run in that same account pass. A complete run that omitted Trash would delete indexed trash.

Disconnected accounts still prune through `pruneAccounts`.

## Flag merge

Project flags from the Gmail `labels` array on each search hit. Do not set flags from stream identity alone. A Sent-stream hit that also has `INBOX` is Inbox and Sent.

When the same message id appears in more than one stream in one run, OR every boolean: `unread`, `inInbox`, `inSent`, `inDrafts`, `inSpam`, `inTrash`, `inArchive`, and `hasAttachment`.

If labels include any of `INBOX`, `SENT`, `DRAFT`, `SPAM`, or `TRASH`, `inArchive` is false even if the archive stream also returned the id.

## Folder lists

`listMailboxConversations` for all six `GmailMailbox` values requires the durable index, same as search.

| Mailbox | Messages that enter grouping |
|---|---|
| `inbox` | Current queue rule, below |
| `sent` | `inSent` |
| `drafts` | `inDrafts` |
| `archive` | `inArchive` |
| `spam` | `inSpam` |
| `trash` | `inTrash` |

Then `groupConversations` applies All / Unread / Read to that set. Unread on a folder means the conversation has an unread member in that folder set. It does not use the Inbox queue rule.

`q=` on a folder uses the existing index search operators, then the folder membership filter, then All / Unread / Read. It does not call live Gmail search.

`GET /v1/conversations` returns `coverage: indexed` for every mailbox in this set.

If the index is missing, mail fails the list the same way search already fails. It does not fall back to a one-page live fetch.

## Inbox queue must not change

Indexing Spam and Trash would leak into All / Unread unless the queue filter changes.

`queueEligible` must exclude `inSpam` and `inTrash`:

- All: `(inInbox || unread) && !inSpam && !inTrash`
- Unread: `unread && !inSpam && !inTrash`
- Read: `inInbox` (still Inbox-scoped; spam and trash are not Inbox)

Do not put Spam or Trash into the default queue. Do not add All Mail semantics.

`listMessages` / `listUnifiedMessages` stay Inbox-only (`inInbox`).

## Mutations

`mutateConversation` updates flags on the existing rows. It does not call `removeMessages` for archive, trash, spam, or inbox.

| Action | Flag write |
|---|---|
| archive | `inInbox = false`. Then `inArchive = !inInbox && !inSent && !inDrafts && !inSpam && !inTrash`. |
| trash | `inTrash = true`, `inInbox = false`, `inArchive = false`. Sent and Drafts stay false for that row in the UI because those folders exclude trash; set `inSent = false` and `inDrafts = false` as well so Sent and Drafts do not keep a trashed row. |
| spam | `inSpam = true`, `inInbox = false`, `inArchive = false`. |
| inbox | `inInbox = true`, `inSpam = false`, `inTrash = false`, `inArchive = false`. |

Keep the connector call first. If the connector fails, do not write flags. After a successful write, schedule the existing short sync. Do not wait for the five-minute cycle for the destination folder to show the row.

`removeMessages` remains for account prune and for a draft-only row that discard removes (see below). It is not the archive/trash path.

## Drafts after send or discard

Drafts is now an index folder. A successful send or discard must not leave that draft visible in Drafts until the next full sync.

After send:

1. If mail knows the draft's Gmail message id or thread id, set `inDrafts = false` on those indexed rows. If the sent message remains, set `inSent = true` on that row.
2. Schedule the same one-page-per-stream `refreshNow` upsert (`complete: false`). Do not add a third sync mode.

After discard:

1. If mail knows the message id or thread id, delete that draft row when it has no remaining `inInbox` / `inSent` / `inSpam` / `inTrash` / `inArchive` flag. Do not keep a discarded draft in All as unread-outside-inbox.
2. Schedule the same one-page-per-stream `refreshNow` upsert (`complete: false`).

If mail cannot identify the indexed row, it still schedules that refresh and does not report send or discard as failed for that reason.

## Errors

| Case | Result |
|---|---|
| No Gmail account | List fails. Visible error. No demo substitute unless `DISPATCH_DEMO_MAIL=1`. |
| Connector timeout or 5xx during sync | Sync state `failed` with the exact error. Lists that already have rows keep those rows and show the failed refresh. |
| Repeated page token | Sync fails. No silent truncate. |
| Stream exceeds 100 pages on `syncNow` | Sync fails. No silent truncate. |
| Folder list with no index | Typed failure, same class as search. No live 50-message fallback. |
| Mutation connector failure | Flags unchanged. Exact error. |

## Product and architecture docs

Update `docs/PRODUCT.md` and `docs/ARCHITECTURE.md` in the same slice:

- Mail paginates Inbox, Unread, Sent, Drafts, Spam, Trash, and the archive query into the same SQLite index.
- The six folder lists are indexed. Do not describe Sent / Drafts / Archive / Spam / Trash as a recent live page.
- All / Unread / Read on the default queue still exclude spam and trash.

Do not claim Gmail coverage beyond what the index streams fetch. Do not claim native acceptance from browser tests.

## Tests

- Unit: `ALTER` on an existing `in_inbox`-only database adds the five columns with default 0.
- Unit: merge ORs `inInbox` and `inSent` when one id appears in both streams.
- Unit: archive-stream hit with no system labels sets `inArchive` only.
- Unit: All / Unread still omit `inSpam` and `inTrash` rows.
- Unit: `listMailboxConversations('sent')` returns indexed Sent beyond 50 when the index holds more than 50 Sent rows. It does not call live search.
- Unit: archive mutation sets `inInbox` false and `inArchive` true and keeps the row. Trash mutation makes Trash list it and Sent / Inbox / All omit it.
- Unit: send or discard clears `inDrafts` on the known row.
- Unit: `coverage` is `indexed` for `mailbox=sent` (and the other five).
- Keep the 100-page cap failure and repeated-token failure tests.

## Out of scope follow-ons

All Mail as a mailbox, custom labels, folder unread counts, Gmail-quality search, keyboard triage, and compose attachments stay on later slices.
