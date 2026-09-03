export interface GmailAccount {
  readonly connectorId: string
  readonly linkId: string
  readonly name: string
  readonly email: string
}

export interface GmailInventory {
  readonly available: boolean
  readonly server: string | null
  readonly accounts: readonly GmailAccount[]
  readonly tools: {
    readonly search: string | null
    readonly read: string | null
    readonly readThread: string | null
    readonly createDraft: string | null
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export function readGmailInventory(value: unknown): GmailInventory {
  const root = record(value)
  const data = Array.isArray(root?.data) ? root.data : []
  const accounts = new Map<string, GmailAccount>()
  const toolNames = new Set<string>()
  let serverName: string | null = null

  for (const serverValue of data) {
    const server = record(serverValue)
    const tools = record(server?.tools)
    if (!server || !tools) continue
    for (const [wireName, toolValue] of Object.entries(tools)) {
      const tool = record(toolValue)
      const meta = record(tool?._meta)
      if (text(meta?.connector_name) !== 'Gmail') continue
      serverName ??= text(server.name) || null
      toolNames.add(wireName)
      const profile = record(meta?.link_owner_profile)
      const linkId = text(meta?.link_id)
      if (!linkId) continue
      accounts.set(linkId, {
        connectorId: text(meta?.connector_id),
        linkId,
        name: text(profile?.nickname) || text(meta?.link_name) || 'Gmail',
        email: text(profile?.email),
      })
    }
  }

  const find = (suffix: string) => [...toolNames].find((name) => name === `gmail.${suffix}`) ?? null
  return {
    available: accounts.size > 0,
    server: serverName,
    accounts: [...accounts.values()],
    tools: {
      search: find('search_email_ids'),
      read: find('read_email'),
      readThread: find('read_email_thread'),
      createDraft: find('create_draft'),
    },
  }
}

