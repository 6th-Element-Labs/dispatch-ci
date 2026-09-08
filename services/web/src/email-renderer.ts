import DOMPurify from 'dompurify'

const quoteSelector = [
  'blockquote',
  '.gmail_quote',
  '[id*="divRplyFwdMsg"]',
  '[class*="divRplyFwdMsg"]',
].join(',')

const allowedImageSrc = /^(?:https:|cid:|http:\/\/127\.0\.0\.1:8411\/)/i

function sanitizeEmailNode(node: Element): void {
  if (node.tagName !== 'IMG') return
  const src = node.getAttribute('src') ?? ''
  if (!allowedImageSrc.test(src)) node.removeAttribute('src')
}

export function renderEmailContent(kind: 'sanitized-html' | 'plain-text', value: string, downloaded = false): HTMLElement {
  const root = document.createElement('div')
  root.className = 'dispatch-thread-body'
  if (kind === 'plain-text') {
    const paragraph = document.createElement('p')
    paragraph.textContent = value
    root.append(paragraph)
    return root
  }

  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    sanitizeEmailNode(node)
    if (downloaded && /url\s*\(|@import/i.test(node.getAttribute('style') ?? '')) node.removeAttribute('style')
    if (downloaded && node.tagName === 'IMG') {
      const src = node.getAttribute('src') ?? ''
      if (src.startsWith('http://127.0.0.1:8411/')) { const url = new URL(src); url.searchParams.set('offline', 'true'); node.setAttribute('src', url.toString()) }
      else { node.removeAttribute('src'); node.setAttribute('alt', node.getAttribute('alt') || 'Image not downloaded') }
    }
  })
  try {
    root.innerHTML = DOMPurify.sanitize(value, { USE_PROFILES: { html: true }, ...(downloaded ? { FORBID_TAGS: ['style', 'link'], FORBID_ATTR: ['srcset', 'background'] } : {}) })
  } finally {
    DOMPurify.removeHook('afterSanitizeAttributes')
  }
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
