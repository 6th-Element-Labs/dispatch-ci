type ObjectValue = Record<string, unknown>
const object = (value: unknown): ObjectValue => value && typeof value === 'object' && !Array.isArray(value) ? value as ObjectValue : {}
export interface GmailToolContract { schema: ObjectValue; fileParams: readonly string[] }
export class GmailContractError extends Error { readonly code = 'gmail_invalid_arguments' }

/** Keep executable schema constraints, never account descriptions or examples. */
export function toolContract(tool: ObjectValue): GmailToolContract | undefined {
  if (!tool.inputSchema || !object(tool.inputSchema).properties) return undefined
  const clean = (value: unknown): unknown => Array.isArray(value) ? value.map(clean)
    : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).filter(([key]) => !['description', 'title', 'examples', 'default'].includes(key)).map(([key, item]) => [key, clean(item)])) : value
  const files = object(tool._meta)['openai/fileParams']
  return { schema: object(clean(tool.inputSchema)), fileParams: Array.isArray(files) ? files.filter((item): item is string => typeof item === 'string') : [] }
}

function matches(value: unknown, raw: unknown, root: ObjectValue): boolean {
  const schema = object(raw)
  if (typeof schema.$ref === 'string') {
    if (!schema.$ref.startsWith('#/')) return false
    let ref: unknown = root
    for (const key of schema.$ref.slice(2).split('/')) ref = object(ref)[key.replaceAll('~1', '/').replaceAll('~0', '~')]
    return ref !== undefined && matches(value, ref, root)
  }
  for (const [key, every] of [['anyOf', false], ['oneOf', false], ['allOf', true]] as const) {
    if (Array.isArray(schema[key])) {
      const checks = (schema[key] as unknown[]).map(option => matches(value, option, root))
      if (every ? !checks.every(Boolean) : key === 'oneOf' ? checks.filter(Boolean).length !== 1 : !checks.some(Boolean)) return false
    }
  }
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) return false
  if (schema.const !== undefined && schema.const !== value) return false
  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : []
  if (types.length && !types.some(type => type === 'null' ? value === null : type === 'array' ? Array.isArray(value) : type === 'object' ? value !== null && typeof value === 'object' && !Array.isArray(value) : type === 'integer' ? Number.isInteger(value) : typeof value === type)) return false
  if (Array.isArray(value)) return !schema.items || value.every(item => matches(item, schema.items, root))
  if (value && typeof value === 'object') {
    const item = object(value), properties = object(schema.properties)
    if (Array.isArray(schema.required) && schema.required.some(key => typeof key !== 'string' || item[key] === undefined)) return false
    return Object.entries(item).every(([key, child]) => key in properties ? matches(child, properties[key], root) : schema.additionalProperties !== false)
  }
  return true
}

/** Direct MCP receives uploaded objects, while inventory exposes model-facing paths. */
export function assertToolArguments(tool: string, args: ObjectValue, contract?: GmailToolContract): void {
  if (!contract) throw new GmailContractError(`Gmail connector changed: ${tool} has no input schema. Your draft is kept; nothing was sent.`)
  const properties = object(contract.schema.properties)
  const unknown = Object.keys(args).find(key => !(key in properties))
  if (unknown) throw new GmailContractError(`Gmail connector changed: ${tool} no longer accepts ${unknown}. Your draft is kept; nothing was sent.`)
  const projected = { ...args }
  for (const field of contract.fileParams) {
    const file = (value: unknown): boolean => typeof object(value).file_id === 'string' && typeof object(value).download_url === 'string' && typeof object(value).file_name === 'string'
    if (!(field in projected)) continue
    if (Array.isArray(projected[field]) && (projected[field] as unknown[]).every(file)) projected[field] = (projected[field] as unknown[]).map(() => '/uploaded/file')
    else if (file(projected[field])) projected[field] = '/uploaded/file'
    else throw new GmailContractError(`Gmail attachment upload is incomplete for ${field}. Nothing was sent.`)
  }
  if (!matches(projected, contract.schema, contract.schema)) throw new GmailContractError(`Gmail connector changed: ${tool} has incompatible required fields or types. Your draft is kept; nothing was sent.`)
}

export function assertGmailCompatibility(contracts: Readonly<Record<string, GmailToolContract>>, tools: { createDraft: string | null; updateDraft: string | null; sendDraft: string | null }): void {
  for (const kind of ['createDraft', 'updateDraft', 'sendDraft'] as const) {
    const name = tools[kind]
    if (!name) throw new GmailContractError(`Gmail connector changed: ${kind} is unavailable.`)
    const contract = contracts[name]
    const properties = object(contract?.schema.properties)
    const args: ObjectValue = { link_id: 'account' }
    if (kind !== 'createDraft') args.draft_id = 'draft'
    if (kind !== 'sendDraft') {
      args.to = 'recipient@example.com'; args.subject = 'Contract check'
      if (properties.html_body && properties.body) {
        args.body = 'Body'; args.html_body = '<p>Body</p>'; args.cc = ''; args.bcc = ''
        if (kind === 'createDraft') {
          if (!properties.attachment_files || !contract?.fileParams.includes('attachment_files')) throw new GmailContractError('Gmail connector changed: attachment upload metadata is unavailable.')
          args.attachment_files = [{ file_id: 'file_contract', download_url: 'https://example.invalid/file', file_name: 'contract.txt' }]
        }
      }
      else if (properties.payload && properties.response_fields) { args.payload = { mime_type: 'text/plain', body: { content: 'Body' } }; args.response_fields = ['id', 'message'] }
      else throw new GmailContractError(`Gmail connector changed: ${name} has an unsupported body format.`)
    }
    assertToolArguments(name, args, contract)
  }
}
