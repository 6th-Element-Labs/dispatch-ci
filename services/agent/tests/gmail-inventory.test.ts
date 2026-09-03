import { describe, expect, it } from 'vitest'
import { readGmailInventory } from '../src/gmail-inventory.js'

describe('Gmail inventory', () => {
  it('extracts account and tool boundaries without retaining the full tool schema', () => {
    const metadata = {
      connector_name: 'Gmail', connector_id: 'connector-gmail', link_id: 'link-one',
      link_owner_profile: { nickname: 'Work', email: 'work@example.com' },
    }
    const inventory = readGmailInventory({ data: [{ name: 'codex_apps', tools: {
      'gmail.search_email_ids': { _meta: metadata },
      'gmail.read_email': { _meta: metadata },
      'github.search': { _meta: { connector_name: 'GitHub' } },
    } }] })
    expect(inventory).toEqual({
      available: true,
      server: 'codex_apps',
      accounts: [{ connectorId: 'connector-gmail', linkId: 'link-one', name: 'Work', email: 'work@example.com' }],
      tools: { search: 'gmail.search_email_ids', read: 'gmail.read_email', readThread: null, createDraft: null },
    })
  })
})

