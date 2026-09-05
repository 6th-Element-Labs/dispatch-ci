# Folder Index Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve Inbox, Sent, Drafts, Archive, Spam, and Trash from the durable SQLite index so those folders are not a live 50-message page.

**Architecture:** `dispatch-mail` keeps one row per Gmail message and adds boolean folder flags (`in_sent`, `in_drafts`, `in_archive`, `in_spam`, `in_trash`) beside `in_inbox`. Sync paginates seven streams into one `replaceAccount` snapshot. Folder lists and folder search read the index. Archive, trash, spam, and inbox mutations update flags. They do not delete the row. `dispatch-web` stays presentation-only. `dispatch-agent` does not change.

**Tech Stack:** TypeScript, Node 22+ `node:sqlite`, Vitest, existing mail service on port 8411.

**Spec:** `docs/superpowers/specs/2026-09-06-folder-index-design.md`

## Global Constraints

- `dispatch-mail` is the only writer of `gmail-index.sqlite` and of folder membership on that index.
- Browser stays presentation-only. Do not add nav items, All Mail, unread badges, or a second list source.
- `dispatch-agent` and Codex App Server stay unchanged. Do not add a second model loop.
- All / Unread / Read on the default queue must exclude `inSpam` and `inTrash`.
- Fail in the open: repeated page token or more than 100 pages per stream on `syncNow` fails the sync. Do not hide a short list as complete.
- Folder lists require the durable index. Do not fall back to a one-page live fetch or a 60-second `#mailboxCache`.
- No label-id sets. No membership table. No new `GmailMailbox` values.
- Do not claim Gmail coverage beyond the seven index streams. Do not claim native acceptance from browser tests.
- Verify with `npm --prefix services/mail test`. After the last task run `bash scripts/dispatch_ci.sh`.

## File map

| File | Responsibility |
|---|---|
| Modify `services/mail/src/gmail-index.ts` | Folder-flag columns, migrate, queue filter, folder lists, flag writes |
| Modify `services/mail/tests/gmail-index.test.ts` | Schema, queue, folder list, mutation, draft-row tests |
| Modify `services/mail/src/gmail-provider.ts` | Label flags, merge OR, seven streams, index-backed folder lists, mutation and draft refresh |
| Modify `services/mail/tests/gmail-provider.test.ts` | Stream, list, mutation, send/discard, and legacy-test updates |
| Modify `services/mail/src/server.ts` | `coverage: indexed` for all six mailboxes |
| Modify `services/mail/tests/server.test.ts` | Coverage assertion for `mailbox=sent` |
| Modify `docs/PRODUCT.md` | Indexed folder lists, queue still excludes spam and trash |
| Modify `docs/ARCHITECTURE.md` | Seven sync streams |
| Existing `services/web/src/main.ts` | No code change. `coverage === 'recent'` already drives the `Recent Sent` label and will stop matching. |

Do not create new packages. Do not split `gmail-provider.ts` in this slice.

---

### Task 1: Folder-flag schema and migrate

**Files:**
- Modify: `services/mail/src/gmail-index.ts`
- Test: `services/mail/tests/gmail-index.test.ts`

**Interfaces:**
- Consumes: existing `gmail_messages` table and `IndexedGmailMessage.inInbox`
- Produces: `IndexedGmailMessage` with required `inInbox`, `inSent`, `inDrafts`, `inArchive`, `inSpam`, `inTrash`; `folderFlagsFromLabels(labels: readonly unknown[])`; persist and reload those flags

- [ ] **Step 1: Write the failing tests**

Add this helper at the top of `services/mail/tests/gmail-index.test.ts` (replace the current `message` helper):

```ts
import { DatabaseSync } from 'node:sqlite'
import { GmailIndex, folderFlagsFromLabels, type IndexedGmailMessage } from '../src/gmail-index.js'

function message(
  id: string,
  unread: boolean,
  inInbox: boolean,
  extra: Partial<IndexedGmailMessage> = {},
): IndexedGmailMessage {
  return {
    id, threadId: `thread-${id}`, accountId: 'account-1', accountLabel: 'Work',
    sender: { name: 'Ana', address: 'ana@example.com', initials: 'A' }, subject: `Subject ${id}`,
    receivedAt: `2026-09-04T0${id === 'm1' ? '9' : '8'}:00:00Z`, receivedLabel: 'Sep 4, 9:00 AM',
    receivedFullLabel: 'September 4, 2026 at 9:00 AM', preview: 'Preview', unread, inInbox,
    inSent: false, inDrafts: false, inArchive: false, inSpam: false, inTrash: false,
    ...extra,
  }
}
```

Add these tests to the `GmailIndex` describe:

```ts
  it('derives exclusive archive from Gmail system labels', () => {
    expect(folderFlagsFromLabels(['INBOX', 'UNREAD'])).toEqual({
      inInbox: true, inSent: false, inDrafts: false, inArchive: false, inSpam: false, inTrash: false,
    })
    expect(folderFlagsFromLabels(['SENT'])).toMatchObject({ inSent: true, inArchive: false })
    expect(folderFlagsFromLabels(['UNREAD'])).toEqual({
      inInbox: false, inSent: false, inDrafts: false, inArchive: true, inSpam: false, inTrash: false,
    })
  })

  it('adds folder-flag columns to an existing in_inbox-only database', () => {
    const directory = mkdtempSync(join(tmpdir(), 'dispatch-index-'))
    directories.push(directory)
    const path = join(directory, 'gmail.sqlite')
    const db = new DatabaseSync(path)
    db.exec(`
      CREATE TABLE gmail_messages (
        account_id TEXT NOT NULL,
        id TEXT NOT NULL,
        thread_id TEXT NOT NULL,
        account_label TEXT NOT NULL,
        sender_name TEXT NOT NULL,
        sender_address TEXT NOT NULL,
        sender_initials TEXT NOT NULL,
        subject TEXT NOT NULL,
        received_at TEXT NOT NULL,
        received_label TEXT NOT NULL,
        received_full_label TEXT NOT NULL,
        preview TEXT NOT NULL,
        unread INTEGER NOT NULL,
        in_inbox INTEGER NOT NULL,
        has_attachment INTEGER NOT NULL DEFAULT 0,
        sync_run_id TEXT NOT NULL,
        PRIMARY KEY (account_id, id)
      );
    `)
    db.prepare(`
      INSERT INTO gmail_messages VALUES ('account-1','m1','thread-m1','Work','Ana','ana@example.com','A','Subject m1',
        '2026-09-04T09:00:00Z','Sep 4, 9:00 AM','September 4, 2026 at 9:00 AM','Preview',1,1,0,'run-old')
    `).run()
    db.close()

    const index = new GmailIndex(path)
    expect(index.messages()).toMatchObject([{
      id: 'm1', inInbox: true, inSent: false, inDrafts: false, inArchive: false, inSpam: false, inTrash: false,
    }])
    index.close()
  })
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npm --prefix services/mail test -- tests/gmail-index.test.ts`

Expected: FAIL because `folderFlagsFromLabels` is not exported and `IndexedGmailMessage` has no `inSent`.

- [ ] **Step 3: Implement schema, mapper, and `folderFlagsFromLabels`**

In `services/mail/src/gmail-index.ts`:

1. Extend the type:

```ts
export interface IndexedGmailMessage extends MessageSummary {
  readonly inInbox: boolean
  readonly inSent: boolean
  readonly inDrafts: boolean
  readonly inArchive: boolean
  readonly inSpam: boolean
  readonly inTrash: boolean
}

export function folderFlagsFromLabels(labels: readonly unknown[]): Pick<
  IndexedGmailMessage, 'inInbox' | 'inSent' | 'inDrafts' | 'inArchive' | 'inSpam' | 'inTrash'
> {
  const inInbox = labels.includes('INBOX')
  const inSent = labels.includes('SENT')
  const inDrafts = labels.includes('DRAFT')
  const inSpam = labels.includes('SPAM')
  const inTrash = labels.includes('TRASH')
  return {
    inInbox,
    inSent,
    inDrafts,
    inSpam,
    inTrash,
    inArchive: !inInbox && !inSent && !inDrafts && !inSpam && !inTrash,
  }
}
```

2. Add the five columns to `CREATE TABLE gmail_messages` and to `MessageRow`:

```sql
in_sent INTEGER NOT NULL DEFAULT 0 CHECK (in_sent IN (0, 1)),
in_drafts INTEGER NOT NULL DEFAULT 0 CHECK (in_drafts IN (0, 1)),
in_archive INTEGER NOT NULL DEFAULT 0 CHECK (in_archive IN (0, 1)),
in_spam INTEGER NOT NULL DEFAULT 0 CHECK (in_spam IN (0, 1)),
in_trash INTEGER NOT NULL DEFAULT 0 CHECK (in_trash IN (0, 1)),
```

3. After the existing `has_attachment` ALTER, add:

```ts
for (const name of ['in_sent', 'in_drafts', 'in_archive', 'in_spam', 'in_trash'] as const) {
  if (!columns.some((column) => column.name === name)) {
    this.#db.exec(`ALTER TABLE gmail_messages ADD COLUMN ${name} INTEGER NOT NULL DEFAULT 0`)
  }
}
```

4. Include the five columns in `replaceAccount` INSERT and `ON CONFLICT` UPDATE, writing `Number(message.inSent)` and the same for the other flags.

5. Map them in `messages()`:

```ts
inInbox: row.in_inbox === 1,
inSent: row.in_sent === 1,
inDrafts: row.in_drafts === 1,
inArchive: row.in_archive === 1,
inSpam: row.in_spam === 1,
inTrash: row.in_trash === 1,
```

Do not add a third sync mode for migrate. Production restart already calls `refreshNow` when the index is non-empty.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npm --prefix services/mail test -- tests/gmail-index.test.ts`

Expected: PASS. Existing persist/search tests pass once the helper supplies the new flags.

- [ ] **Step 5: Commit**

```bash
git add services/mail/src/gmail-index.ts services/mail/tests/gmail-index.test.ts
git commit -m "$(cat <<'EOF'
Add folder-flag columns to the Gmail index.

Existing databases get ALTER defaults so Sent and the other folders can be stored on the same message row.
EOF
)"
```

---

### Task 2: Queue excludes spam/trash; folders list from flags

**Files:**
- Modify: `services/mail/src/gmail-index.ts`
- Test: `services/mail/tests/gmail-index.test.ts`

**Interfaces:**
- Consumes: `IndexedGmailMessage` flags from Task 1; `GmailMailbox` and `MailStateFilter` from `services/mail/src/model.ts`
- Produces: `GmailIndex.mailboxConversations(mailbox: GmailMailbox, state: MailStateFilter, accountId?: string): readonly ConversationSummary[]`; `GmailIndex.searchMailboxConversations(mailbox: GmailMailbox, query: string, state: MailStateFilter, accountId?: string): readonly ConversationSummary[]`; `queueEligible` excludes `inSpam` and `inTrash`

- [ ] **Step 1: Write the failing tests**

Add to `services/mail/tests/gmail-index.test.ts`:

```ts
  it('keeps spam and trash out of All and Unread', () => {
    const index = new GmailIndex(':memory:')
    index.replaceAccount('account-1', [
      message('m1', true, true),
      message('m2', true, false, { inSpam: true, inArchive: false }),
      message('m3', true, false, { inTrash: true, inArchive: false }),
      message('m4', true, false, { inArchive: true }),
    ], 'run-1', true)
    expect(index.conversations('all').map((item) => item.latestMessageId).sort()).toEqual(['m1', 'm4'])
    expect(index.conversations('unread').map((item) => item.latestMessageId).sort()).toEqual(['m1', 'm4'])
    expect(index.mailboxConversations('spam', 'all').map((item) => item.latestMessageId)).toEqual(['m2'])
    expect(index.mailboxConversations('trash', 'unread').map((item) => item.latestMessageId)).toEqual(['m3'])
    index.close()
  })

  it('lists and searches Sent from inSent flags beyond a single page of ids', () => {
    const index = new GmailIndex(':memory:')
    const sent = Array.from({ length: 51 }, (_, offset) => message(
      `s${offset}`,
      false,
      false,
      {
        inSent: true,
        subject: offset === 0 ? 'Invoice 51' : `Sent ${offset}`,
        receivedAt: `2026-09-04T10:${String(offset).padStart(2, '0')}:00Z`,
      },
    ))
    index.replaceAccount('account-1', sent, 'run-1', true)
    expect(index.mailboxConversations('sent', 'all')).toHaveLength(51)
    expect(index.searchMailboxConversations('sent', 'subject:Invoice', 'all')).toMatchObject([
      { subject: 'Invoice 51' },
    ])
    index.close()
  })
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npm --prefix services/mail test -- tests/gmail-index.test.ts`

Expected: FAIL because `mailboxConversations` is missing and All still includes unread spam/trash.

- [ ] **Step 3: Implement queue filter and folder queries**

Import `GmailMailbox` from `./model.js`.

Replace `queueEligible`:

```ts
function queueEligible(message: IndexedGmailMessage, state: MailStateFilter): boolean {
  if (message.inSpam || message.inTrash) return false
  if (state === 'unread') return message.unread
  if (state === 'read') return message.inInbox
  return message.inInbox || message.unread
}

function folderMember(message: IndexedGmailMessage, mailbox: Exclude<GmailMailbox, 'inbox'>): boolean {
  if (mailbox === 'sent') return message.inSent
  if (mailbox === 'drafts') return message.inDrafts
  if (mailbox === 'archive') return message.inArchive
  if (mailbox === 'spam') return message.inSpam
  return message.inTrash
}
```

Extract the term loop from `searchConversations` into `filterSearch(messages, query)` that throws the same `Unsupported Gmail search operator` / `Invalid Gmail date search` errors. `searchConversations` becomes `groupConversations(filterSearch(this.messages(accountId), query).filter((message) => queueEligible(message, state)), state)`.

Add:

```ts
  mailboxConversations(mailbox: GmailMailbox, state: MailStateFilter, accountId?: string): readonly ConversationSummary[] {
    if (mailbox === 'inbox') return this.conversations(state, accountId)
    return groupConversations(this.messages(accountId).filter((message) => folderMember(message, mailbox)), state)
  }

  searchMailboxConversations(mailbox: GmailMailbox, query: string, state: MailStateFilter, accountId?: string): readonly ConversationSummary[] {
    if (mailbox === 'inbox') return this.searchConversations(query, state, accountId)
    return groupConversations(
      filterSearch(this.messages(accountId), query).filter((message) => folderMember(message, mailbox)),
      state,
    )
  }
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npm --prefix services/mail test -- tests/gmail-index.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add services/mail/src/gmail-index.ts services/mail/tests/gmail-index.test.ts
git commit -m "$(cat <<'EOF'
Serve existing folders from index flags.

Keep spam and trash out of All and Unread after those messages are stored.
EOF
)"
```

---

### Task 3: Mutation and draft flag writes

**Files:**
- Modify: `services/mail/src/gmail-index.ts`
- Test: `services/mail/tests/gmail-index.test.ts`

**Interfaces:**
- Consumes: folder flags from Task 1; `GmailConversationAction` from `services/mail/src/model.ts`
- Produces: `flagsAfterAction(message, action)`; `GmailIndex.applyConversationAction(accountId: string, messageIds: readonly string[], action: GmailConversationAction): void`; `GmailIndex.markDraftsSent(accountId: string, messageIds: readonly string[]): void`; `GmailIndex.discardDraftMessages(accountId: string, messageIds: readonly string[]): void`

- [ ] **Step 1: Write the failing tests**

Add to `services/mail/tests/gmail-index.test.ts`:

```ts
import { flagsAfterAction } from '../src/gmail-index.js'

  it('updates folder flags for archive, trash, spam, and inbox', () => {
    expect(flagsAfterAction({
      inInbox: true, inSent: false, inDrafts: false, inArchive: false, inSpam: false, inTrash: false,
    }, 'archive')).toEqual({
      inInbox: false, inSent: false, inDrafts: false, inArchive: true, inSpam: false, inTrash: false,
    })
    expect(flagsAfterAction({
      inInbox: true, inSent: true, inDrafts: false, inArchive: false, inSpam: false, inTrash: false,
    }, 'archive')).toMatchObject({ inInbox: false, inSent: true, inArchive: false })
    expect(flagsAfterAction({
      inInbox: true, inSent: true, inDrafts: false, inArchive: false, inSpam: false, inTrash: false,
    }, 'trash')).toMatchObject({ inTrash: true, inInbox: false, inSent: false, inDrafts: false, inArchive: false })

    const index = new GmailIndex(':memory:')
    index.replaceAccount('account-1', [message('m1', true, true)], 'run-1', true)
    index.applyConversationAction('account-1', ['m1'], 'archive')
    expect(index.mailboxConversations('archive', 'all')).toHaveLength(1)
    expect(index.conversations('all')).toHaveLength(0)
    index.applyConversationAction('account-1', ['m1'], 'inbox')
    expect(index.mailboxConversations('inbox', 'all')).toHaveLength(1)
    index.close()
  })

  it('clears drafts on send and deletes an orphan discarded draft', () => {
    const index = new GmailIndex(':memory:')
    index.replaceAccount('account-1', [
      message('draft-1', false, false, { inDrafts: true, subject: 'Draft' }),
      message('draft-2', false, false, { inDrafts: true, subject: 'Drop' }),
    ], 'run-1', true)
    index.markDraftsSent('account-1', ['draft-1'])
    expect(index.mailboxConversations('drafts', 'all')).toHaveLength(1)
    expect(index.mailboxConversations('sent', 'all')).toMatchObject([{ latestMessageId: 'draft-1' }])
    index.discardDraftMessages('account-1', ['draft-2'])
    expect(index.mailboxConversations('drafts', 'all')).toHaveLength(0)
    expect(index.messages().map((item) => item.id)).toEqual(['draft-1'])
    index.close()
  })
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npm --prefix services/mail test -- tests/gmail-index.test.ts`

Expected: FAIL because the new functions are missing.

- [ ] **Step 3: Implement flag writes**

In `services/mail/src/gmail-index.ts` import `GmailConversationAction`. Add:

```ts
export function flagsAfterAction(
  message: Pick<IndexedGmailMessage, 'inInbox' | 'inSent' | 'inDrafts' | 'inArchive' | 'inSpam' | 'inTrash'>,
  action: GmailConversationAction,
): Pick<IndexedGmailMessage, 'inInbox' | 'inSent' | 'inDrafts' | 'inArchive' | 'inSpam' | 'inTrash'> {
  if (action === 'archive') {
    const next = { ...message, inInbox: false }
    return {
      ...next,
      inArchive: !next.inInbox && !next.inSent && !next.inDrafts && !next.inSpam && !next.inTrash,
    }
  }
  if (action === 'trash') {
    return { ...message, inTrash: true, inInbox: false, inArchive: false, inSent: false, inDrafts: false }
  }
  if (action === 'spam') {
    return { ...message, inSpam: true, inInbox: false, inArchive: false }
  }
  return { ...message, inInbox: true, inSpam: false, inTrash: false, inArchive: false }
}
```

Implement the three methods with `BEGIN IMMEDIATE` / `COMMIT` / `ROLLBACK`, same as `setUnread`.

`applyConversationAction`: if `messageIds` is empty, throw `Cannot update folder flags without indexed Gmail message IDs`. Skip ids that are not in the table. For each found row, compute `flagsAfterAction` and `UPDATE` the six flag columns.

`markDraftsSent`: `UPDATE` `in_drafts=0`, `in_sent=1` for each id.

`discardDraftMessages`: set `in_drafts=0`. Then `DELETE` the row when `in_inbox`, `in_sent`, `in_spam`, `in_trash`, and `in_archive` are all 0. Do not keep that row as unread-outside-inbox.

Empty `messageIds` on mark/discard is a no-op (send/discard may not know the row).

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npm --prefix services/mail test -- tests/gmail-index.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add services/mail/src/gmail-index.ts services/mail/tests/gmail-index.test.ts
git commit -m "$(cat <<'EOF'
Write folder flags on move, send, and discard.

Archive and trash keep the row so the destination folder can show it immediately.
EOF
)"
```

---

### Task 4: Seven streams and index-backed folder lists

**Files:**
- Modify: `services/mail/src/gmail-provider.ts`
- Test: `services/mail/tests/gmail-provider.test.ts`

**Interfaces:**
- Consumes: `folderFlagsFromLabels`, `mailboxConversations`, `searchMailboxConversations` from Tasks 1–2
- Produces: exported `INDEX_STREAMS` with seven `{ query, labelIds }` entries; exported `mergeIndexedMessages` that ORs every folder flag and then clears `inArchive` when any system folder is true; `listMailboxConversations` reads the index and throws `Durable Gmail index is required for mailbox lists` when the index is missing

- [ ] **Step 1: Write the failing tests**

Add to `services/mail/tests/gmail-provider.test.ts`:

```ts
import { GmailConnectorProvider, mergeIndexedMessages, INDEX_STREAMS, projectGmailSearchEmail } from '../src/gmail-provider.js'

  it('merges folder flags from multiple streams and treats system labels as not archive', () => {
    const base = {
      id: 'm1', threadId: 't1', accountId: 'one', accountLabel: 'Work',
      sender: { name: 'Ana', address: 'ana@example.com', initials: 'A' },
      subject: 'Hello', receivedAt: '2026-09-06T01:00:00Z', receivedLabel: 'x', receivedFullLabel: 'x',
      preview: '', unread: false, inInbox: false, inSent: false, inDrafts: false,
      inArchive: false, inSpam: false, inTrash: false,
    }
    expect(mergeIndexedMessages([
      { ...base, inInbox: true },
      { ...base, inSent: true, inArchive: true },
    ])).toMatchObject([{ id: 'm1', inInbox: true, inSent: true, inArchive: false }])
  })

  it('lists Sent from the index and does not live-search folders', async () => {
    const searches: Array<{ query?: string; labelIds?: string[] }> = []
    const server = createServer(async (request, response) => {
      response.setHeader('content-type', 'application/json')
      if (request.url === '/v1/connectors/gmail') {
        return response.end(JSON.stringify({ accounts: [{ linkId: 'link-one', connectorId: 'gmail', name: 'Work', email: 'work@example.com' }] }))
      }
      if (request.url === '/v1/connectors/gmail/search-messages') {
        const chunks: Buffer[] = []
        for await (const chunk of request) chunks.push(Buffer.from(chunk))
        const payload = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { query?: string; labelIds?: string[] }
        searches.push(payload)
        const emails = payload.labelIds?.includes('SENT')
          ? Array.from({ length: 51 }, (_, offset) => ({
              id: `sent-${offset}`, thread_id: `thread-sent-${offset}`, from_: 'Ana <ana@example.com>',
              subject: `Sent ${offset}`, snippet: '', labels: ['SENT'],
              email_ts: `2026-09-06T01:${String(offset).padStart(2, '0')}:00Z`,
            }))
          : []
        return response.end(JSON.stringify({ structuredContent: { emails } }))
      }
      response.statusCode = 404
      response.end('{}')
    })
    servers.push(server)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const directory = mkdtempSync(join(tmpdir(), 'dispatch-folder-'))
    directories.push(directory)
    const provider = new GmailConnectorProvider(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, {
      indexPath: join(directory, 'gmail.sqlite'),
    })
    await provider.syncNow()
    const before = searches.length
    const sent = await provider.listMailboxConversations('sent', 'all', 'link-one')
    expect(sent).toHaveLength(51)
    expect(searches.length).toBe(before)
    provider.stopBackgroundSync()
  })

  it('fails folder lists when the durable index is missing', async () => {
    const provider = new GmailConnectorProvider('http://127.0.0.1:9', { indexPath: false })
    await expect(provider.listMailboxConversations('sent', 'all', 'link-one')).rejects.toThrow(
      'Durable Gmail index is required for mailbox lists',
    )
  })
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npm --prefix services/mail test -- tests/gmail-provider.test.ts`

Expected: FAIL (`INDEX_STREAMS` / `mergeIndexedMessages` not exported; Sent still live-searches or cannot hold 51).

- [ ] **Step 3: Implement streams, merge, projection, and index lists**

Replace the current `INDEX_STREAMS` and `mergeIndexedMessages` in `services/mail/src/gmail-provider.ts`:

```ts
import { folderFlagsFromLabels, type IndexedGmailMessage } from './gmail-index.js'

export const INDEX_STREAMS = [
  { query: '-in:spam -in:trash', labelIds: ['INBOX'] },
  { query: '-in:spam -in:trash', labelIds: ['UNREAD'] },
  { query: '-in:trash', labelIds: ['SENT'] },
  { query: '-in:trash', labelIds: ['DRAFT'] },
  { query: 'in:spam', labelIds: ['SPAM'] },
  { query: 'in:trash', labelIds: ['TRASH'] },
  { query: '-in:inbox -in:sent -in:drafts -in:spam -in:trash', labelIds: [] },
] as const

export function mergeIndexedMessages(messages: readonly IndexedGmailMessage[]): IndexedGmailMessage[] {
  const merged = new Map<string, IndexedGmailMessage>()
  for (const message of messages) {
    const existing = merged.get(message.id)
    const next = existing
      ? {
          ...message,
          unread: existing.unread || message.unread,
          inInbox: existing.inInbox || message.inInbox,
          inSent: existing.inSent || message.inSent,
          inDrafts: existing.inDrafts || message.inDrafts,
          inSpam: existing.inSpam || message.inSpam,
          inTrash: existing.inTrash || message.inTrash,
          inArchive: existing.inArchive || message.inArchive,
          hasAttachment: existing.hasAttachment === true || message.hasAttachment === true,
        }
      : message
    merged.set(message.id, {
      ...next,
      inArchive: next.inArchive && !next.inInbox && !next.inSent && !next.inDrafts && !next.inSpam && !next.inTrash,
    })
  }
  return [...merged.values()]
}
```

In `#searchPage`, set flags from labels:

```ts
return { ...projectGmailSearchEmail(email, account), ...folderFlagsFromLabels(labels) }
```

In `#synchronize` and `refreshNow`, iterate `INDEX_STREAMS` and pass `stream.query` plus `stream.labelIds` into `#searchPage`. Do not apply `-in:spam -in:trash` to every stream.

`listMailboxConversations` becomes:

```ts
  async listMailboxConversations(mailbox: GmailMailbox, state: MailStateFilter, accountId?: string, query = ''): Promise<readonly ConversationSummary[]> {
    if (!this.#index) throw new Error('Durable Gmail index is required for mailbox lists')
    await this.#ensureIndex()
    return query
      ? this.#index.searchMailboxConversations(mailbox, query, state, accountId)
      : this.#index.mailboxConversations(mailbox, state, accountId)
  }
```

Delete `#mailboxCache`, every `#mailboxCache.clear()`, and `#searchPages` if nothing else calls it.

- [ ] **Step 4: Update the two existing provider tests that this change breaks**

In `uses the agent service instead of reading connector state directly` (`indexPath: false`):

- Remove `await provider.listMailboxConversations('sent', ...)` and `listMailboxConversations('archive', ...)`.
- Remove the two search expectations for `SENT` and the archive query.

In `paginates Gmail into the durable index and serves the indexed result`:

- For non-INBOX non-UNREAD streams return `{ emails: [] }` so Sent/Drafts/Spam/Trash/Archive do not replay Inbox fixtures.
- Change `refreshNow` `pagesFetched: 2` to `pagesFetched: 7`.
- Keep Inbox two-page pagination and Unread one page. `messageCount` stays 3.

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `npm --prefix services/mail test -- tests/gmail-provider.test.ts`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add services/mail/src/gmail-provider.ts services/mail/tests/gmail-provider.test.ts
git commit -m "$(cat <<'EOF'
Index Sent, Drafts, Archive, Spam, and Trash.

Folder lists read SQLite instead of one live Gmail page.
EOF
)"
```

---

### Task 5: Mutations, send, and discard update the index

**Files:**
- Modify: `services/mail/src/gmail-provider.ts`
- Test: `services/mail/tests/gmail-provider.test.ts`

**Interfaces:**
- Consumes: `applyConversationAction`, `markDraftsSent`, `discardDraftMessages` from Task 3; `refreshNow` from Task 4
- Produces: `mutateConversation` writes flags and does not call `removeMessages` for archive/trash/spam/inbox; `sendGmailDraft` / `discardGmailDraft` update known rows then `#refreshIndexedDrafts()`; create/update also call `#refreshIndexedDrafts()` so Drafts does not wait for the 60-second timer after the cache is gone

- [ ] **Step 1: Write the failing tests**

Replace `clears the mailbox cache after each Gmail draft write` with:

```ts
  it('keeps folder rows when archiving and refreshes the index after draft writes', async () => {
    const searches: Array<{ query?: string; labelIds?: string[] }> = []
    const server = createServer(async (request, response) => {
      response.setHeader('content-type', 'application/json')
      if (request.url === '/v1/connectors/gmail') {
        return response.end(JSON.stringify({ accounts: [{ linkId: 'link-one', connectorId: 'gmail', name: 'Work', email: 'work@example.com' }] }))
      }
      if (request.url === '/v1/connectors/gmail/search-messages') {
        const chunks: Buffer[] = []
        for await (const chunk of request) chunks.push(Buffer.from(chunk))
        searches.push(JSON.parse(Buffer.concat(chunks).toString('utf8')) as { query?: string; labelIds?: string[] })
        return response.end(JSON.stringify({ structuredContent: { emails: [{
          id: 'm1', thread_id: 't1', from_: 'Ana <ana@example.com>', subject: 'Inbox', snippet: '',
          labels: ['INBOX'], email_ts: '2026-09-06T02:00:00Z',
        }] } }))
      }
      if (request.url === '/v1/connectors/gmail/archive') return response.end(JSON.stringify({ ok: true }))
      if (request.url === '/v1/connectors/gmail/drafts/create') {
        return response.end(JSON.stringify({ structuredContent: { draft_id: 'draft-1' } }))
      }
      if (request.url === '/v1/connectors/gmail/drafts/update'
        || request.url === '/v1/connectors/gmail/drafts/discard'
        || request.url === '/v1/connectors/gmail/drafts/send'
        || request.url === '/v1/connectors/gmail/drafts/list') {
        return response.end(JSON.stringify({
          structuredContent: {
            drafts: [{
              draft_id: 'draft-1', message_id: 'm1', thread_id: 't1',
              to: '', cc: '', bcc: '', subject: 'Inbox',
            }],
          },
        }))
      }
      response.statusCode = 404
      response.end('{}')
    })
    servers.push(server)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const directory = mkdtempSync(join(tmpdir(), 'dispatch-mutate-'))
    directories.push(directory)
    const provider = new GmailConnectorProvider(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, {
      indexPath: join(directory, 'gmail.sqlite'),
    })
    await provider.syncNow()
    await provider.mutateConversation('link-one', 't1', ['m1'], 'archive')
    expect(await provider.listMailboxConversations('archive', 'all', 'link-one')).toHaveLength(1)
    expect(await provider.listMailboxConversations('inbox', 'all', 'link-one')).toHaveLength(0)

    const before = searches.length
    await provider.createGmailDraft('link-one', '', 'client@example.com', '', '', 'Subject', 'Body')
    await provider.discardGmailDraft('link-one', 'draft-1')
    await provider.sendGmailDraft('link-one', 'draft-1')
    expect(searches.length).toBeGreaterThan(before)
    provider.stopBackgroundSync()
  })

  it('fails a complete sync when one folder stream exceeds 100 pages', async () => {
    const server = createServer(async (request, response) => {
      response.setHeader('content-type', 'application/json')
      if (request.url === '/v1/connectors/gmail') {
        return response.end(JSON.stringify({ accounts: [{ linkId: 'link-one', connectorId: 'gmail', name: 'Work', email: 'work@example.com' }] }))
      }
      if (request.url === '/v1/connectors/gmail/search-messages') {
        const chunks: Buffer[] = []
        for await (const chunk of request) chunks.push(Buffer.from(chunk))
        const payload = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { labelIds?: string[] }
        const looping = payload.labelIds?.includes('SENT') === true
        return response.end(JSON.stringify({
          structuredContent: {
            emails: looping ? [{
              id: 'sent-1', thread_id: 't-sent', from_: 'Ana <ana@example.com>', subject: 'Sent',
              snippet: '', labels: ['SENT'], email_ts: '2026-09-06T03:00:00Z',
            }] : [],
            next_page_token: looping ? 'more' : '',
          },
        }))
      }
      response.statusCode = 404
      response.end('{}')
    })
    servers.push(server)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const directory = mkdtempSync(join(tmpdir(), 'dispatch-cap-'))
    directories.push(directory)
    const provider = new GmailConnectorProvider(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, {
      indexPath: join(directory, 'gmail.sqlite'),
    })
    await expect(provider.syncNow()).rejects.toThrow('Gmail pagination exceeded 100 pages')
    expect(provider.syncStatus()).toMatchObject({ state: 'failed' })
    provider.stopBackgroundSync()
  })
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npm --prefix services/mail test -- tests/gmail-provider.test.ts`

Expected: FAIL because `mutateConversation` still deletes archived rows.

- [ ] **Step 3: Implement provider writes**

Replace the index write in `mutateConversation`:

```ts
    if (this.#index) this.#index.applyConversationAction(accountId, messageIds, action)
    this.#scheduleSync(1_000)
```

Do not call `removeMessages` for archive, trash, spam, or inbox. If the connector call throws, do not write flags.

Find the draft summary **before** send or discard POST. After a successful send the draft may disappear from `list_drafts`.

```ts
  async #refreshIndexedDrafts(): Promise<void> {
    try {
      await this.refreshNow()
    } catch {
      this.#scheduleSync(5_000)
    }
  }

  async sendGmailDraft(accountId: string, draftId: string): Promise<unknown> {
    const summary = await this.#findGmailDraft(accountId, (draft) => draft.draftId === draftId).catch(() => undefined)
    const result = await this.#post('/v1/connectors/gmail/drafts/send', { linkId: accountId, draftId })
    if (this.#index && summary) this.#index.markDraftsSent(accountId, [summary.messageId])
    await this.#refreshIndexedDrafts()
    return result
  }

  async discardGmailDraft(accountId: string, draftId: string): Promise<void> {
    const summary = await this.#findGmailDraft(accountId, (draft) => draft.draftId === draftId).catch(() => undefined)
    try {
      await this.#post('/v1/connectors/gmail/drafts/discard', { linkId: accountId, draftId })
      this.#drafts.delete(`${accountId}:${draftId}`)
      if (this.#index && summary) this.#index.discardDraftMessages(accountId, [summary.messageId])
      await this.#refreshIndexedDrafts()
    } catch (error) {
      throw draftConnectorError(error)
    }
  }
```

Call `await this.#refreshIndexedDrafts()` after successful `createGmailDraft` and `updateGmailDraft` as well. Those methods used to clear `#mailboxCache`. Without that cache, Drafts stays stale until refresh.

If find fails, still POST and still refresh. Do not fail send or discard because the index row was missing. Pass only the draft `messageId` to `markDraftsSent`. Do not mark every thread member as Sent.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npm --prefix services/mail test -- tests/gmail-provider.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add services/mail/src/gmail-provider.ts services/mail/tests/gmail-provider.test.ts
git commit -m "$(cat <<'EOF'
Update folder flags on move, send, and discard.

Do not delete archived rows, and do not wait for the next full sync to drop a sent draft.
EOF
)"
```

---

### Task 6: Coverage, docs, and full mail suite

**Files:**
- Modify: `services/mail/src/server.ts`
- Test: `services/mail/tests/server.test.ts`
- Modify: `docs/PRODUCT.md`
- Modify: `docs/ARCHITECTURE.md`

**Interfaces:**
- Consumes: `listMailboxConversations` from Task 4
- Produces: `GET /v1/conversations` `coverage: "indexed"` for every `GmailMailbox`; product and architecture text that names the seven streams and says the six folder lists are indexed

- [ ] **Step 1: Write the failing test**

In `services/mail/tests/server.test.ts`, in `routes mailbox reads and accepted Gmail actions through the mail owner`, after the 200 assertion:

```ts
    const sent = await (await fetch(`${base}/v1/conversations?state=all&mailbox=sent&account=one&q=invoice`)).json()
    expect(sent).toMatchObject({ mailbox: 'sent', coverage: 'indexed' })
```

Keep the existing `calls` assertion. The first fetch in that test can stay as the status check, or reuse `sent` and drop the duplicate fetch.

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npm --prefix services/mail test -- tests/server.test.ts`

Expected: FAIL because coverage is still `recent` for `mailbox=sent`.

- [ ] **Step 3: Return indexed coverage and update docs**

In `services/mail/src/server.ts` change the Gmail list payload to:

```ts
coverage: 'indexed',
```

Do not keep `mailbox === 'inbox' ? 'indexed' : 'recent'`.

In `docs/PRODUCT.md` Current foundation, replace the synchronization clause with:

```text
paginated Gmail synchronization of Inbox, Unread, Sent, Drafts, Spam, Trash, and the archive query into a durable SQLite index
```

Add one sentence after the Send sentence:

```text
Inbox, Sent, Drafts, Archive, Spam, and Trash lists read that index. All, Unread, and Read on the default queue still exclude spam and trash.
```

In `docs/ARCHITECTURE.md` Mail paragraph, replace `paginates the Inbox and Unread label streams for every connector account` with:

```text
paginates the Inbox, Unread, Sent, Drafts, Spam, Trash, and archive-query streams for every connector account
```

Add:

```text
The six folder lists are indexed. Mail does not serve Sent, Drafts, Archive, Spam, or Trash from a one-page live fetch.
```

Do not change `services/web/src/main.ts`. It already shows `Recent ${mailbox}` only when `coverage === 'recent'`.

- [ ] **Step 4: Run mail tests, then CI**

Run: `npm --prefix services/mail test`

Expected: PASS

Run: `bash scripts/dispatch_ci.sh`

Expected: PASS. No Playwright test asserts `Recent Sent`. Do not add web tests in this slice.

- [ ] **Step 5: Commit**

```bash
git add services/mail/src/server.ts services/mail/tests/server.test.ts docs/PRODUCT.md docs/ARCHITECTURE.md
git commit -m "$(cat <<'EOF'
Report indexed coverage for every current folder.

Document that mail syncs the seven streams and that the All queue still excludes spam and trash.
EOF
)"
```

---

## Spec coverage

| Spec section | Task |
|---|---|
| Boolean flags + ALTER | 1 |
| Flags from labels; archive exclusive | 1, 4 |
| Seven streams; 1-page bootstrap / refresh; 100-page fail | 4, 5 |
| One `replaceAccount` snapshot per account run | 4 (existing call, all streams in the same loop) |
| Folder lists and folder `q=` from index | 2, 4 |
| No live 50 / no 60s cache | 4 |
| Queue excludes spam/trash | 2 |
| Mutations update flags | 3, 5 |
| Send/discard clear Drafts | 3, 5 |
| Missing index fails | 4 |
| `coverage: indexed` | 6 |
| PRODUCT + ARCHITECTURE | 6 |
| No new nav / All Mail / badges / agent changes | file map (no those files) |
