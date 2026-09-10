import { expect, it } from 'vitest'
import { DraftRecovery } from './draft-recovery.js'

it('clears only the revision that Gmail confirmed, even after leaving the editor', () => {
  const data = new Map<string, string>()
  const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value) } } as Storage
  const recovery = new DraftRecovery(storage)
  const record = { key: 'copy', updatedAt: '2026-09-11', revision: 1, accountId: 'account', gmailDraftId: '', inReplyToMessageId: '', to: '', cc: '', bcc: '', subject: 'Draft', bodyMarkdown: 'First text' }
  recovery.save(record, [])
  recovery.save({ ...record, revision: 2, bodyMarkdown: 'Newer text' }, [])
  recovery.bindGmailIdentity('copy', 'account', 'gmail-id')
  recovery.removeSavedRevision('copy', 1)
  expect(recovery.list()[0]).toMatchObject({ gmailDraftId: 'gmail-id', bodyMarkdown: 'Newer text' })
  recovery.removeSavedRevision('copy', 2)
  expect(recovery.list()).toEqual([])
})
