import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { groupConversations } from './conversation.js'
import type { ConversationSummary, MailStateFilter, MessageSummary } from './model.js'

export interface IndexedGmailMessage extends MessageSummary {
  readonly inInbox: boolean
}

export interface IndexedGmailAccount {
  readonly id: string
  readonly connectorId: string
  readonly name: string
  readonly email: string
}

export interface GmailSyncStatus {
  readonly state: 'idle' | 'syncing' | 'partial' | 'ready' | 'failed'
  readonly startedAt: string | null
  readonly completedAt: string | null
  readonly error: string | null
  readonly messageCount: number
}

type MessageRow = {
  id: string
  thread_id: string
  account_id: string
  account_label: string
  sender_name: string
  sender_address: string
  sender_initials: string
  subject: string
  received_at: string
  received_label: string
  received_full_label: string
  preview: string
  unread: number
  in_inbox: number
}

export class GmailIndex {
  readonly #db: DatabaseSync

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
    this.#db = new DatabaseSync(path)
    this.#db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS gmail_messages (
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
        unread INTEGER NOT NULL CHECK (unread IN (0, 1)),
        in_inbox INTEGER NOT NULL CHECK (in_inbox IN (0, 1)),
        sync_run_id TEXT NOT NULL,
        PRIMARY KEY (account_id, id)
      );
      CREATE INDEX IF NOT EXISTS gmail_messages_received ON gmail_messages(received_at DESC);
      CREATE INDEX IF NOT EXISTS gmail_messages_thread ON gmail_messages(account_id, thread_id);
      CREATE TABLE IF NOT EXISTS gmail_accounts (
        account_id TEXT PRIMARY KEY,
        connector_id TEXT NOT NULL,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        last_seen_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS gmail_sync_state (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        state TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT,
        error TEXT
      );
      INSERT OR IGNORE INTO gmail_sync_state(singleton, state) VALUES (1, 'idle');
    `)
  }

  replaceAccount(accountId: string, messages: readonly IndexedGmailMessage[], runId: string, complete: boolean): void {
    this.#db.exec('BEGIN IMMEDIATE')
    try {
      const upsert = this.#db.prepare(`
        INSERT INTO gmail_messages (
          account_id, id, thread_id, account_label, sender_name, sender_address, sender_initials,
          subject, received_at, received_label, received_full_label, preview, unread, in_inbox, sync_run_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(account_id, id) DO UPDATE SET
          thread_id=excluded.thread_id, account_label=excluded.account_label,
          sender_name=excluded.sender_name, sender_address=excluded.sender_address,
          sender_initials=excluded.sender_initials, subject=excluded.subject,
          received_at=excluded.received_at, received_label=excluded.received_label,
          received_full_label=excluded.received_full_label, preview=excluded.preview,
          unread=excluded.unread, in_inbox=excluded.in_inbox, sync_run_id=excluded.sync_run_id
      `)
      for (const message of messages) {
        upsert.run(
          accountId, message.id, message.threadId, message.accountLabel ?? '',
          message.sender.name, message.sender.address, message.sender.initials,
          message.subject, message.receivedAt, message.receivedLabel, message.receivedFullLabel,
          message.preview, Number(message.unread), Number(message.inInbox), runId,
        )
      }
      if (complete) this.#db.prepare('DELETE FROM gmail_messages WHERE account_id = ? AND sync_run_id <> ?').run(accountId, runId)
      this.#db.exec('COMMIT')
    } catch (error) {
      this.#db.exec('ROLLBACK')
      throw error
    }
  }

  pruneAccounts(accountIds: readonly string[]): void {
    if (accountIds.length === 0) throw new Error('Cannot prune Gmail index without an authoritative account list')
    const placeholders = accountIds.map(() => '?').join(', ')
    this.#db.prepare(`DELETE FROM gmail_messages WHERE account_id NOT IN (${placeholders})`).run(...accountIds)
  }

  replaceAccounts(accounts: readonly IndexedGmailAccount[], seenAt: string): void {
    if (accounts.length === 0) throw new Error('Cannot replace Gmail accounts with an empty connector result')
    this.#db.exec('BEGIN IMMEDIATE')
    try {
      const upsert = this.#db.prepare(`
        INSERT INTO gmail_accounts(account_id, connector_id, name, email, last_seen_at) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(account_id) DO UPDATE SET connector_id=excluded.connector_id, name=excluded.name,
          email=excluded.email, last_seen_at=excluded.last_seen_at
      `)
      for (const account of accounts) upsert.run(account.id, account.connectorId, account.name, account.email, seenAt)
      const placeholders = accounts.map(() => '?').join(', ')
      this.#db.prepare(`DELETE FROM gmail_accounts WHERE account_id NOT IN (${placeholders})`).run(...accounts.map((account) => account.id))
      this.#db.exec('COMMIT')
    } catch (error) {
      this.#db.exec('ROLLBACK')
      throw error
    }
  }

  accounts(): readonly IndexedGmailAccount[] {
    const rows = this.#db.prepare('SELECT account_id, connector_id, name, email FROM gmail_accounts ORDER BY name, email').all() as unknown as Array<{
      account_id: string; connector_id: string; name: string; email: string
    }>
    return rows.map((row) => ({ id: row.account_id, connectorId: row.connector_id, name: row.name, email: row.email }))
  }

  messages(accountId?: string): readonly IndexedGmailMessage[] {
    const rows = (accountId
      ? this.#db.prepare('SELECT * FROM gmail_messages WHERE account_id = ? ORDER BY received_at DESC').all(accountId)
      : this.#db.prepare('SELECT * FROM gmail_messages ORDER BY received_at DESC').all()) as unknown as MessageRow[]
    return rows.map((row) => ({
      id: row.id,
      threadId: row.thread_id,
      accountId: row.account_id,
      accountLabel: row.account_label,
      sender: { name: row.sender_name, address: row.sender_address, initials: row.sender_initials },
      subject: row.subject,
      receivedAt: row.received_at,
      receivedLabel: row.received_label,
      receivedFullLabel: row.received_full_label,
      preview: row.preview,
      unread: row.unread === 1,
      inInbox: row.in_inbox === 1,
    }))
  }

  conversations(state: MailStateFilter, accountId?: string): readonly ConversationSummary[] {
    const eligible = this.messages(accountId).filter((message) => {
      if (state === 'unread') return message.unread
      if (state === 'read') return message.inInbox && !message.unread
      return message.inInbox || message.unread
    })
    return groupConversations(eligible, state)
  }

  count(): number {
    return Number((this.#db.prepare('SELECT COUNT(*) AS count FROM gmail_messages').get() as { count: number | bigint }).count)
  }

  beginSync(startedAt: string): void {
    this.#db.prepare("UPDATE gmail_sync_state SET state='syncing', started_at=?, error=NULL WHERE singleton=1").run(startedAt)
  }

  completeSync(completedAt: string, complete = true): void {
    this.#db.prepare("UPDATE gmail_sync_state SET state=?, completed_at=?, error=NULL WHERE singleton=1").run(complete ? 'ready' : 'partial', completedAt)
  }

  failSync(error: string): void {
    this.#db.prepare("UPDATE gmail_sync_state SET state='failed', error=? WHERE singleton=1").run(error)
  }

  status(): GmailSyncStatus {
    const row = this.#db.prepare('SELECT state, started_at, completed_at, error FROM gmail_sync_state WHERE singleton=1').get() as {
      state: GmailSyncStatus['state']; started_at: string | null; completed_at: string | null; error: string | null
    }
    return { state: row.state, startedAt: row.started_at, completedAt: row.completed_at, error: row.error, messageCount: this.count() }
  }

  close(): void {
    this.#db.close()
  }
}
