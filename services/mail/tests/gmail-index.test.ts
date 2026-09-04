import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { GmailIndex, type IndexedGmailMessage } from '../src/gmail-index.js'

const directories: string[] = []
afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })))

function message(id: string, unread: boolean, inInbox: boolean): IndexedGmailMessage {
  return {
    id, threadId: `thread-${id}`, accountId: 'account-1', accountLabel: 'Work',
    sender: { name: 'Ana', address: 'ana@example.com', initials: 'A' }, subject: `Subject ${id}`,
    receivedAt: `2026-09-04T0${id === 'm1' ? '9' : '8'}:00:00Z`, receivedLabel: 'Sep 4, 9:00 AM',
    receivedFullLabel: 'September 4, 2026 at 9:00 AM', preview: 'Preview', unread, inInbox,
  }
}

describe('GmailIndex', () => {
  it('persists Gmail state and preserves All, Unread, and Read semantics', () => {
    const directory = mkdtempSync(join(tmpdir(), 'dispatch-index-'))
    directories.push(directory)
    const path = join(directory, 'gmail.sqlite')
    const index = new GmailIndex(path)
    index.beginSync('2026-09-04T09:00:00Z')
    index.replaceAccount('account-1', [message('m1', true, false), message('m2', false, true)], 'run-1', true)
    index.completeSync('2026-09-04T09:01:00Z')
    expect(index.conversations('all')).toHaveLength(2)
    expect(index.conversations('unread')).toMatchObject([{ latestMessageId: 'm1', unread: true }])
    expect(index.conversations('read')).toMatchObject([{ latestMessageId: 'm2', unread: false }])
    index.close()

    const reopened = new GmailIndex(path)
    expect(reopened.status()).toMatchObject({ state: 'ready', messageCount: 2, completedAt: '2026-09-04T09:01:00Z' })
    expect(reopened.messages()).toHaveLength(2)
    reopened.close()
  })

  it('prunes records absent from a completed account refresh', () => {
    const index = new GmailIndex(':memory:')
    index.replaceAccount('account-1', [message('m1', true, false), message('m2', false, true)], 'run-1', true)
    index.replaceAccount('account-1', [message('m2', true, true)], 'run-2', true)
    expect(index.messages()).toMatchObject([{ id: 'm2', unread: true }])
    index.close()
  })

  it('removes records for disconnected Gmail accounts', () => {
    const index = new GmailIndex(':memory:')
    index.replaceAccount('account-1', [message('m1', true, false)], 'run-1', true)
    index.replaceAccount('account-2', [{ ...message('m2', false, true), accountId: 'account-2' }], 'run-1', true)
    index.pruneAccounts(['account-1'])
    expect(index.messages()).toMatchObject([{ accountId: 'account-1' }])
    index.close()
  })
})
