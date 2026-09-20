import { execFile } from 'node:child_process'
import {
  access,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { promisify } from 'node:util'

const execute = promisify(execFile)
const VERSION_PATHS = [
  ['apps/desktop/package.json', 'json'],
  ['apps/desktop/src-tauri/tauri.conf.json', 'json'],
  ['apps/desktop/src-tauri/Cargo.toml', 'cargo'],
  ['services/web/package.json', 'json'],
  ['services/mail/package.json', 'json'],
  ['services/agent/package.json', 'json'],
]

export async function loadManifest(root) {
  const path = resolve(root, 'deploy/public-export-manifest.json')
  const manifest = JSON.parse(await readFile(path, 'utf8'))
  if (manifest.schema !== 'dispatch.public_export.v1') {
    throw new Error(`Unsupported public export manifest: ${manifest.schema ?? 'missing schema'}`)
  }
  if (!Array.isArray(manifest.copies) || !Array.isArray(manifest.required) || !Array.isArray(manifest.forbiddenPrefixes)) {
    throw new Error('Public export manifest is missing copies, required, or forbiddenPrefixes')
  }
  return manifest
}

export async function versionsFromTree(directory) {
  const records = []
  for (const [path, kind] of VERSION_PATHS) {
    const value = await readFile(resolve(directory, path), 'utf8')
    if (kind === 'json') {
      const version = JSON.parse(value).version
      if (typeof version !== 'string' || !version) throw new Error(`${path} has no version`)
      records.push({ path, version })
      continue
    }
    const match = value.match(/\[package\][\s\S]*?^version\s*=\s*"([^"]+)"/m)
    if (!match) throw new Error(`${path} has no package version`)
    records.push({ path, version: match[1] })
  }
  return records
}

export function secretFindings(text) {
  const findings = []
  const checks = [
    ['machine path', /\/Users\/steveridder|CloudStorage\/|\/Dropbox\/Git/],
    ['GitHub token', /\b(?:ghp_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/],
    ['OpenAI token', /\bsk-(?:proj|live|test|ant)-[A-Za-z0-9_-]{20,}\b/],
    ['Slack token', /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/],
    ['Google API key', /\bAIza[0-9A-Za-z_-]{30,}\b/],
    ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
    ['private key', /BEGIN (?:RSA |OPENSSH |EC |DSA )?PRIVATE KEY|BEGIN CERTIFICATE/],
    ['private CI reference', /\bdispatch-ci\b|scripts\/ci-sandbox|docs\/CI-SANDBOX/],
    ['private agent reference', /\bAGENTS\.md\b|docs\/superpowers|\.superpowers/],
    ['private repository reference', /6th-Element-Labs\/dispatch-private/],
  ]
  for (const [label, pattern] of checks) {
    if (pattern.test(text)) findings.push(label)
  }
  return findings
}

export function pathFindings(name) {
  const findings = []
  const segments = name.split('/')
  const basename = segments.at(-1)?.toLowerCase() ?? ''
  if (segments.includes('node_modules')) findings.push('dependency directory')
  if (segments.some(segment => [
    'dist',
    'server-dist',
    'target',
    'test-results',
    'playwright-report',
    '.artifacts',
    '.dispatch-data',
  ].includes(segment))) findings.push('generated directory')
  if (
    basename === 'auth.json'
    || basename === 'credentials.json'
    || basename === '.npmrc'
    || basename === 'service-account.json'
    || basename === 'application_default_credentials.json'
    || /(?:service[-_]account|credentials).*\.json$/i.test(basename)
    || /\.(?:cer|crt|pem|p12|p8|pfx|key|keychain-db)$/i.test(basename)
  ) findings.push('credential file')
  if (/\.(?:sqlite|sqlite3|db)$/i.test(basename)) findings.push('database file')
  if (/\.log$/i.test(basename)) findings.push('log file')
  if (basename === '.env' || basename.startsWith('.env.')) findings.push('environment file')
  return findings
}

async function walk(directory, prefix = '') {
  const records = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name)
    const name = prefix ? `${prefix}/${entry.name}` : entry.name
    const stats = await lstat(path)
    if (stats.isSymbolicLink()) records.push({ type: 'symlink', path, name })
    else if (stats.isDirectory()) records.push(...await walk(path, name))
    else records.push({ type: 'file', path, name })
  }
  return records
}

export function assertInsideRoot(root, target, label) {
  const path = relative(root, target)
  if (path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path)) {
    throw new Error(`Export ${label} path escapes its root: ${target}`)
  }
}

async function copyEntry(sourceRoot, destinationRoot, entry) {
  const source = resolve(sourceRoot, entry.source)
  const destination = resolve(destinationRoot, entry.destination)
  assertInsideRoot(sourceRoot, source, 'source')
  assertInsideRoot(destinationRoot, destination, 'destination')
  await access(source)
  const records = (await lstat(source)).isDirectory()
    ? await walk(source, entry.source)
    : [{ type: (await lstat(source)).isSymbolicLink() ? 'symlink' : 'file', name: entry.source }]
  const link = records.find(record => record.type === 'symlink')
  if (link) throw new Error(`Public export refuses symlink: ${link.name}`)
  if (entry.destination === '.') {
    await mkdir(destinationRoot, { recursive: true })
    for (const child of await readdir(source)) {
      await cp(resolve(source, child), resolve(destinationRoot, child), { recursive: true, force: true })
    }
  } else {
    await mkdir(dirname(destination), { recursive: true })
    await cp(source, destination, { recursive: true, force: true })
  }
}

async function assertDestinationVacant(destination) {
  let destinationEntries = []
  try {
    destinationEntries = await readdir(destination)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  if (destinationEntries.includes('.git')) {
    throw new Error(`Public export refuses an existing Git checkout: ${destination}`)
  }
  if (destinationEntries.length) {
    throw new Error(`Public export destination is not empty: ${destination}`)
  }
}

async function replaceDestination(destination, staged) {
  await assertDestinationVacant(destination)
  await rm(destination, { recursive: true, force: true })
  await rename(staged, destination)
}

export async function validatePublicTree(directory, manifest, version) {
  const records = await walk(directory)
  const names = new Set(records.map(record => record.name))
  for (const required of manifest.required) {
    if (!names.has(required)) throw new Error(`Public export is missing required path: ${required}`)
  }
  for (const record of records) {
    if (record.type === 'symlink') throw new Error(`Public export contains symlink: ${record.name}`)
    if (manifest.forbiddenPrefixes.some(prefix => record.name === prefix || record.name.startsWith(prefix))) {
      throw new Error(`Public export contains forbidden path: ${record.name}`)
    }
    const invalidPaths = pathFindings(record.name)
    if (invalidPaths.length) throw new Error(invalidPaths.map(label => `${label} in ${record.name}`).join('\n'))
    const bytes = await readFile(record.path)
    const findings = secretFindings(bytes.toString('utf8'))
    if (findings.length) throw new Error(findings.map(label => `${label} in ${record.name}`).join('\n'))
  }
  const versions = await versionsFromTree(directory)
  const mismatches = versions.filter(record => record.version !== version)
  if (mismatches.length) {
    throw new Error(`Public export version mismatch: ${mismatches.map(item => `${item.path}=${item.version}`).join(', ')}`)
  }
}

export async function exportPublicTree({ root, ref = 'HEAD', destination, version, verify = false }) {
  if (!destination || !version) throw new Error('destination and version are required')
  await assertDestinationVacant(destination)
  const manifest = await loadManifest(root)
  const work = await mkdtemp(resolve(tmpdir(), 'dispatch-public-export-'))
  const archive = resolve(work, 'source.tar')
  const source = resolve(work, 'source')
  await mkdir(dirname(destination), { recursive: true })
  const staged = await mkdtemp(resolve(dirname(destination), '.dispatch-public-stage-'))
  let moved = false
  try {
    await mkdir(source)
    await execute('git', ['-C', root, 'archive', '--format=tar', '--output', archive, ref])
    await execute('tar', ['-xf', archive, '-C', source])
    for (const entry of manifest.copies) await copyEntry(source, staged, entry)
    await validatePublicTree(staged, manifest, version)
    if (verify) await execute('bash', ['scripts/public_ci.sh'], { cwd: staged, maxBuffer: 16 * 1024 * 1024 })
    await replaceDestination(destination, staged)
    moved = true
  } finally {
    if (!moved) await rm(staged, { recursive: true, force: true })
    await rm(work, { recursive: true, force: true })
  }
}
