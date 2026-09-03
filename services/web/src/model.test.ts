import { describe, expect, it } from 'vitest'
import { contextLabel, gmailAppId } from './model.js'

describe('web presentation model', () => {
  it('finds Gmail without inventing another connector', () => {
    expect(gmailAppId([{ id: 'google_drive', name: 'Drive' }, { id: 'gmail', name: 'Gmail' }])).toBe('gmail')
  })

  it('makes selected mail context explicit', () => {
    expect(contextLabel({
      id: 'm1', threadId: 't1', sender: { name: 'Ana', address: 'ana@example.com', initials: 'A' },
      subject: 'Berth', receivedAt: 'now', receivedLabel: 'Now', preview: 'Preview', unread: true,
    })).toBe('Berth · Ana')
  })
})

