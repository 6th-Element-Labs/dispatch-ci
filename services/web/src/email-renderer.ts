import DOMPurify from 'dompurify'

const quoteSelector = [
  'blockquote',
  '.gmail_quote',
  '[id*="divRplyFwdMsg"]',
  '[class*="divRplyFwdMsg"]',
].join(',')

export function renderEmailContent(kind: 'sanitized-html' | 'plain-text', value: string): HTMLElement {
  const root = document.createElement('div')
  root.className = 'dispatch-thread-body'
  if (kind === 'plain-text') {
    const paragraph = document.createElement('p')
    paragraph.textContent = value
    root.append(paragraph)
    return root
  }

  root.innerHTML = DOMPurify.sanitize(value, { USE_PROFILES: { html: true } })
  const quote = root.querySelector<HTMLElement>(quoteSelector)
  if (!quote) return root

  let boundary: HTMLElement = quote
  while (boundary.parentElement && boundary.parentElement !== root) boundary = boundary.parentElement
  const details = document.createElement('details')
  details.className = 'dispatch-quoted-history'
  const summary = document.createElement('summary')
  summary.textContent = 'Quoted history'
  details.append(summary)
  let node: ChildNode | null = boundary
  while (node) {
    const next: ChildNode | null = node.nextSibling
    details.append(node)
    node = next
  }
  root.append(details)
  return root
}

