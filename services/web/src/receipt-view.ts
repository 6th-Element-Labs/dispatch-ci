import type { SendReceipt } from './contracts.js'
const labels: Record<SendReceipt['status'], string> = { preparing: 'Preparing send', sending: 'Sending — awaiting Gmail', accepted: 'Gmail accepted — details pending', verified: 'Sent — details verified', failed: 'Not sent', unknown: 'Send outcome unknown — check Sent' }
export function receiptView(receipt: SendReceipt, verify: () => void): HTMLElement {
  const root = document.createElement('article')
  root.className = 'dispatch-receipt'
  root.dataset.receiptId = receipt.id
  const title = document.createElement('h3'); title.textContent = labels[receipt.status]
  const account = document.createElement('p'); account.textContent = `${receipt.accountLabel} · ${new Date(receipt.sentAt ?? receipt.acceptedAt ?? receipt.requestedAt).toLocaleString()}`
  root.append(title, account)
  const details = document.createElement('dl')
  const add = (label: string, value: string) => { const term = document.createElement('dt'); term.textContent = label; const description = document.createElement('dd'); description.textContent = value; details.append(term, description) }
  add('Source', receipt.detailsSource === 'sent-message' ? 'Verified from Gmail Sent' : receipt.detailsSource === 'draft' ? 'Saved draft snapshot; sent details not yet verified' : 'Recipient and file details not yet verified')
  if (receipt.details) {
    add('To', receipt.details.to.join(', ') || 'None'); add('Cc', receipt.details.cc.join(', ') || 'None'); add('Bcc', receipt.details.bcc.join(', ') || 'None'); add('Subject', receipt.details.subject)
    add('Attachments', receipt.details.attachments.map(file => `${file.name}${file.sizeLabel ? ` (${file.sizeLabel})` : ''}`).join('\n') || 'None')
  }
  if (receipt.messageId) add('Gmail message ID', receipt.messageId)
  if (receipt.error) add('Status detail', receipt.error)
  if (receipt.warnings?.length) add('Differences', receipt.warnings.join('\n'))
  root.append(details)
  if (receipt.messageId && receipt.status !== 'verified') { const button = document.createElement('button'); button.className = 'btn btn-sm'; button.textContent = 'Verify sent details'; button.addEventListener('click', verify); root.append(button) }
  return root
}
