#!/usr/bin/env node
import { execFile } from 'node:child_process'
import { isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { exportPublicTree } from './public-export-lib.mjs'

const execute = promisify(execFile)
const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const argumentsList = process.argv.slice(2)

function option(name, fallback) {
  const index = argumentsList.indexOf(name)
  if (index < 0) return fallback
  const value = argumentsList[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`)
  return value
}

const destination = option('--destination')
const ref = option('--ref', 'HEAD')
const version = option('--version')
const verify = argumentsList.includes('--verify')

if (!destination || !isAbsolute(destination)) {
  throw new Error('--destination requires an absolute path')
}
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  throw new Error('--version requires a stable semantic version such as 0.1.0')
}

const { stdout: status } = await execute('git', [
  '-C',
  root,
  'status',
  '--porcelain',
  '--untracked-files=all',
])
if (status.trim()) throw new Error('Private worktree must be clean before public export')

await exportPublicTree({
  root,
  ref,
  destination: resolve(destination),
  version,
  verify,
})

process.stdout.write(`Exported Dispatch ${version} from ${ref} to ${resolve(destination)}\n`)
