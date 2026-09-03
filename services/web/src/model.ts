import type { MessageSummary } from './contracts.js'

export function gmailAppId(apps: readonly { readonly id: string; readonly name: string }[]): string | undefined {
  return apps.find((app) => /gmail/i.test(`${app.id} ${app.name}`))?.id
}

export function contextLabel(message: MessageSummary): string {
  return `${message.subject} · ${message.sender.name}`
}

