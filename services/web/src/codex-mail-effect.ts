export type CodexMailEffect =
  | { readonly kind: 'draft'; readonly draftId: string; readonly accountId: string }
  | { readonly kind: 'sent'; readonly accountId: string; readonly draftId?: string }

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}
function text(value: unknown): string { return typeof value === 'string' ? value.trim() : '' }
function parseRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'string') return record(value)
  try { return record(JSON.parse(value)) } catch { return undefined }
}

/** Interpret provider-confirmed results, never a tool name or arguments alone. */
export function codexMailEffect(item: unknown): CodexMailEffect | undefined {
  const call = record(item)
  if (!call || call.type !== 'mcpToolCall' || call.status !== 'completed' || call.error) return undefined
  const result = record(call.result)
  if (!result || result.isError === true || result.error) return undefined
  const args = parseRecord(call.arguments)
  const candidates = [record(result.structuredContent), result,
    ...(Array.isArray(result.content) ? result.content.map((part) => {
      const block = record(part)
      return block?.type === 'text' ? parseRecord(block.text) : undefined
    }) : [])].filter((value): value is Record<string, unknown> => Boolean(value))
  if (candidates.some((value) => value.isError === true || value.error)) return undefined
  const content = candidates.find((value) => value.id || value.draft_id || value.draftId || record(value.draft)?.id)
  if (!content) return undefined
  const accountId = text(args?.link_id) || text(args?.linkId) || text(content.link_id) || text(content.linkId)
  if (!accountId) return undefined
  // App Server names may include the MCP namespace; do not match unrelated tools.
  const tool = text(call.tool)
  if (/(?:^|[._])gmail[._](?:create_draft|update_draft)$/.test(tool)) {
    const draftId = text(content.draft_id) || text(content.draftId) || text(record(content.draft)?.id) || text(content.id)
    return draftId ? { kind: 'draft', draftId, accountId } : undefined
  }
  if (/(?:^|[._])gmail[._](?:send_draft|send_email)$/.test(tool)) {
    const draftId = /send_draft$/.test(tool) ? text(args?.draft_id) || text(args?.draftId) : ''
    return { kind: 'sent', accountId, ...draftId ? { draftId } : {} }
  }
  return undefined
}

/** Drops Dispatch-injected mail context from restored user bubbles. */
export function visibleUserPrompt(textValue: string): string {
  return textValue.replace(/\n\nSelected (?:email context supplied by Dispatch UI:|Gmail)[\s\S]*$/, '').trimEnd()
}
