import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import {
  assertInsideRoot,
  exportPublicTree,
  pathFindings,
  secretFindings,
  verifyPublicTreeInCopy,
  versionsFromTree,
} from './public-export-lib.mjs'

const root = resolve(import.meta.dirname, '..')

describe('private tree hygiene', () => {
  it('does not track or require node_modules links', () => {
    const tracked = execFileSync('git', ['ls-files', '-s'], { cwd: root, encoding: 'utf8' })
    assert.doesNotMatch(
      tracked,
      /^120000 .*\s(?:apps\/desktop|services\/(?:web|mail|agent))\/node_modules$/m,
    )
  })
})

describe('public policy sources', () => {
  it('contains the approved license and issue policy', async () => {
    const license = await readFile(resolve(root, 'LICENSE'), 'utf8')
    const notice = await readFile(resolve(root, 'NOTICE'), 'utf8')
    const readme = await readFile(resolve(root, 'deploy/public/README.md'), 'utf8')
    const contributing = await readFile(resolve(root, 'deploy/public/CONTRIBUTING.md'), 'utf8')
    const security = await readFile(resolve(root, 'deploy/public/SECURITY.md'), 'utf8')
    assert.match(license, /Apache License\s+Version 2\.0/)
    assert.match(notice, /Copyright 2026 Steven Ridder/)
    assert.match(readme, /Quick start/)
    assert.match(readme, /macOS 14/)
    assert.match(readme, /Dispatch has no telemetry/)
    assert.match(readme, /require explicit\s+approval/)
    assert.match(readme, /Email content is untrusted/)
    assert.match(contributing, /Pull requests are not accepted/)
    assert.match(contributing, /Do not include private email/)
    assert.match(security, /private vulnerability reporting/)
  })

  it('contains a real synthetic-data screenshot', async () => {
    const screenshot = await readFile(resolve(root, 'docs/assets/dispatch-screenshot.png'))
    assert.deepEqual([...screenshot.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10])
    assert.equal(screenshot.readUInt32BE(16), 1440)
    assert.equal(screenshot.readUInt32BE(20), 900)
    assert.ok(screenshot.length > 50_000)
  })
})

describe('public export', () => {
  it('rejects exact parent and nested parent path escapes', () => {
    assert.throws(() => assertInsideRoot('/tmp/export/source', '/tmp/export', 'source'), /escapes/)
    assert.throws(() => assertInsideRoot('/tmp/export/source', '/tmp/other/file', 'source'), /escapes/)
    assert.doesNotThrow(() => assertInsideRoot('/tmp/export/source', '/tmp/export/source/apps', 'source'))
  })

  it('rejects a relative destination before checking the worktree', () => {
    const result = spawnSync(process.execPath, [
      'scripts/export-public-release.mjs',
      '--destination',
      '.',
      '--version',
      '0.1.4',
    ], { cwd: root, encoding: 'utf8' })
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /absolute path/)
  })

  it('never mutates an existing Git checkout', async () => {
    const temporary = await mkdtemp(resolve(tmpdir(), 'dispatch-export-checkout-'))
    const destination = resolve(temporary, 'public')
    try {
      await mkdir(destination)
      execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: destination })
      await writeFile(resolve(destination, 'keep.txt'), 'keep\n')
      execFileSync('git', ['add', 'keep.txt'], { cwd: destination })
      execFileSync('git', [
        '-c', 'user.name=Dispatch Test',
        '-c', 'user.email=dispatch@example.com',
        'commit', '-q', '-m', 'keep',
      ], { cwd: destination })
      await assert.rejects(
        exportPublicTree({ root, ref: 'HEAD', destination, version: '0.1.4' }),
        /existing Git checkout/,
      )
      assert.equal(await readFile(resolve(destination, 'keep.txt'), 'utf8'), 'keep\n')
    } finally {
      await rm(temporary, { recursive: true, force: true })
    }
  })

  it('copies only manifest paths and overlays public-root files', async () => {
    const temporary = await mkdtemp(resolve(tmpdir(), 'dispatch-export-test-'))
    const destination = resolve(temporary, 'public')
    try {
      await exportPublicTree({ root, ref: 'HEAD', destination, version: '0.1.4' })
      assert.equal(
        await readFile(resolve(destination, 'README.md'), 'utf8'),
        await readFile(resolve(root, 'deploy/public/README.md'), 'utf8'),
      )
      await assert.rejects(lstat(resolve(destination, 'AGENTS.md')), { code: 'ENOENT' })
      await assert.rejects(lstat(resolve(destination, 'docs/superpowers')), { code: 'ENOENT' })
      await assert.rejects(lstat(resolve(destination, 'scripts/ci-sandbox.sh')), { code: 'ENOENT' })
    } finally {
      await rm(temporary, { recursive: true, force: true })
    }
  })

  it('runs verification on a disposable copy of the public tree', async () => {
    const temporary = await mkdtemp(resolve(tmpdir(), 'dispatch-export-verifier-'))
    const staged = resolve(temporary, 'staged')
    try {
      await mkdir(staged)
      await writeFile(resolve(staged, 'README.md'), 'clean source\n')
      await verifyPublicTreeInCopy(staged, async directory => {
        await mkdir(resolve(directory, 'node_modules'))
        await writeFile(resolve(directory, 'node_modules', 'generated'), 'test output\n')
      })
      assert.equal(await readFile(resolve(staged, 'README.md'), 'utf8'), 'clean source\n')
      await assert.rejects(lstat(resolve(staged, 'node_modules')), { code: 'ENOENT' })
    } finally {
      await rm(temporary, { recursive: true, force: true })
    }
  })

  it('detects private paths and credential shapes', () => {
    assert.deepEqual(secretFindings('/Users/steveridder/private', 'x.md'), ['machine path'])
    assert.deepEqual(
      secretFindings('ghp_abcdefghijklmnopqrstuvwxyz123456', 'x.md'),
      ['GitHub token'],
    )
    assert.deepEqual(secretFindings('sk-proj-abcdefghijklmnopqrstuvwxyz123456', 'x.md'), ['OpenAI token'])
    assert.deepEqual(secretFindings('xoxb-1234567890-abcdefghijklmnopqrstuvwxyz', 'x.md'), ['Slack token'])
  })

  it('rejects generated, credential, database, and log paths', () => {
    assert.deepEqual(pathFindings('services/web/node_modules/pkg/index.js'), ['dependency directory'])
    assert.deepEqual(pathFindings('apps/desktop/src-tauri/target/release/app'), ['generated directory'])
    assert.deepEqual(pathFindings('secrets/AuthKey.p8'), ['credential file'])
    assert.deepEqual(pathFindings('secrets/DeveloperID.p12'), ['credential file'])
    assert.deepEqual(pathFindings('secrets/signing.cer'), ['credential file'])
    assert.deepEqual(pathFindings('secrets/signing.crt'), ['credential file'])
    assert.deepEqual(pathFindings('secrets/signing.pfx'), ['credential file'])
    assert.deepEqual(pathFindings('.npmrc'), ['credential file'])
    assert.deepEqual(pathFindings('config/service-account.json'), ['credential file'])
    assert.deepEqual(pathFindings('config/application_default_credentials.json'), ['credential file'])
    assert.deepEqual(pathFindings('data/mail.sqlite'), ['database file'])
    assert.deepEqual(pathFindings('logs/dispatch.log'), ['log file'])
    assert.deepEqual(pathFindings('.env.production'), ['environment file'])
  })

  it('finds one release version across the product', async () => {
    const versions = await versionsFromTree(root)
    assert.deepEqual([...new Set(versions.map(item => item.version))], ['0.1.4'])
    assert.equal(versions.length, 6)
  })
})

describe('public CI source', () => {
  it('runs the direct public gate without private CI references', async () => {
    const workflow = await readFile(resolve(root, 'deploy/public/.github/workflows/verify.yml'), 'utf8')
    const native = await readFile(resolve(root, 'deploy/public/.github/workflows/native.yml'), 'utf8')
    const gate = await readFile(resolve(root, 'scripts/public_ci.sh'), 'utf8')
    assert.match(workflow, /push:\s*\n\s*branches:\s*\[main\]/)
    assert.match(workflow, /workflow_dispatch:/)
    assert.match(workflow, /permissions:\s*\n\s*contents: read/)
    assert.match(workflow, /name: public-ci\/full-suite/)
    assert.match(workflow, /bash scripts\/public_ci\.sh/)
    assert.match(gate, /check-dependency-licenses\.mjs --check THIRD_PARTY_NOTICES\.md/)
    assert.match(gate, /bash scripts\/dispatch_ci\.sh/)
    assert.match(native, /push:\s*\n\s*branches:\s*\[main\]/)
    assert.match(native, /name: public-ci\/macos-shell/)
    assert.match(native, /name: public-ci\/macos-intel/)
    assert.match(native, /npm --prefix apps\/desktop run fetch-node/)
    assert.match(native, /npm --prefix apps\/desktop run test:native/)
    assert.match(native, /npm --prefix apps\/desktop run smoke/)
    assert.doesNotMatch(`${workflow}\n${native}\n${gate}`, /dispatch-ci|ci-sandbox|dispatch-private/)
  })
})
