#!/usr/bin/env node
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execute = promisify(execFile)
const root = resolve(import.meta.dirname, '..')

export const REQUIRED_RELEASE_SECRETS = [
  'APPLE_CERTIFICATE',
  'APPLE_CERTIFICATE_PASSWORD',
  'APPLE_SIGNING_IDENTITY',
  'APPLE_API_ISSUER',
  'APPLE_API_KEY',
  'APPLE_API_KEY_P8',
  'APPLE_TEAM_ID',
  'TAURI_SIGNING_PRIVATE_KEY',
  'TAURI_SIGNING_PRIVATE_KEY_PASSWORD',
]

export function localReadiness({ status, versions, exportOk, updaterConfigured }) {
  const errors = []
  if (String(status ?? '').trim()) errors.push('working tree is dirty')
  if (versions !== '0.1.6') errors.push(`version is not 0.1.6 (${versions})`)
  if (!exportOk) errors.push('public export failed')
  if (!updaterConfigured) errors.push('updater public key is missing')
  return { ok: errors.length === 0, errors }
}

export function githubReadiness({
  privateRepo,
  publicRepo,
  tagExists,
  secrets,
}) {
  const errors = []
  if (privateRepo !== '6th-Element-Labs/dispatch') {
    errors.push('private dispatch repo is missing')
  }
  if (publicRepo !== '6th-Element-Labs/dispatch-public') {
    errors.push('public dispatch-public repo is missing')
  }
  if (tagExists) errors.push('public v0.1.6 already exists')
  for (const name of REQUIRED_RELEASE_SECRETS) {
    if (!secrets?.includes(name)) errors.push(`missing secret ${name}`)
  }
  return { ok: errors.length === 0, errors }
}

export function updaterConfiguredFromConfig(config) {
  const key = config?.plugins?.updater?.pubkey
  return typeof key === 'string' && key.startsWith('dW50cnVzdGVk') && !key.includes('sample')
}

function option(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : null
}

async function repoName(name) {
  try {
    const { stdout } = await execute('gh', ['repo', 'view', name, '--json', 'nameWithOwner', '--jq', '.nameWithOwner'])
    return stdout.trim() || null
  } catch {
    return null
  }
}

async function secretNames(repo) {
  try {
    const { stdout } = await execute('gh', ['secret', 'list', '--env', 'release', '--repo', repo])
    return stdout
      .split('\n')
      .map(line => line.split('\t')[0])
      .filter(Boolean)
  } catch {
    return []
  }
}

async function tagExists(repo, tag) {
  try {
    const { stdout } = await execute('git', ['ls-remote', '--tags', `https://github.com/${repo}.git`, `refs/tags/${tag}`])
    return stdout.includes(`refs/tags/${tag}`)
  } catch {
    return false
  }
}

async function main() {
  const version = option('--version') ?? '0.1.6'
  const publicRepo = option('--public-repo') ?? '6th-Element-Labs/dispatch-public'
  const { stdout: status } = await execute('git', ['-C', root, 'status', '--porcelain'])
  let versions = version
  try {
    await execute('node', [resolve(root, 'scripts/version-contract.mjs'), '--expect', version], { cwd: root })
  } catch {
    versions = 'mismatch'
  }
  let exportOk = true
  try {
    await execute('bash', [resolve(root, 'scripts/verify-public-export.sh')], { cwd: root })
  } catch {
    exportOk = false
  }
  const config = JSON.parse(await readFile(resolve(root, 'apps/desktop/src-tauri/tauri.conf.json'), 'utf8'))
  const local = localReadiness({
    status,
    versions,
    exportOk,
    updaterConfigured: updaterConfiguredFromConfig(config),
  })
  const github = githubReadiness({
    privateRepo: await repoName('6th-Element-Labs/dispatch'),
    publicRepo: await repoName(publicRepo),
    tagExists: await tagExists(publicRepo, `v${version}`),
    secrets: await secretNames(publicRepo),
  })
  process.stdout.write(`${JSON.stringify({ local, github }, null, 2)}\n`)
  if (!local.ok) process.exitCode = 1
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    process.stderr.write(`check-release-readiness: ${error.message}\n`)
    process.exitCode = 1
  })
}
