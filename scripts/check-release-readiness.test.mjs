import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')

describe('private CI topology', () => {
  it('resolves the canonical repo from origin instead of a hard-coded name', async () => {
    const script = await readFile(resolve(root, 'scripts/ci-sandbox.sh'), 'utf8')
    const ciDocs = await readFile(resolve(root, 'docs/CI-SANDBOX.md'), 'utf8')
    const readme = await readFile(resolve(root, 'README.md'), 'utf8')
    assert.match(script, /canonical_repo\(\)/)
    assert.doesNotMatch(script, /CANONICAL_REPO="\$\{CANONICAL_REPO:-6th-Element-Labs\/dispatch\}"/)
    assert.match(ciDocs, /6th-Element-Labs\/dispatch-public/)
    assert.match(readme, /public release mirror/)
  })
})

describe('release readiness', async () => {
  const { localReadiness, githubReadiness } = await import('./check-release-readiness.mjs')

  it('fails a dirty tree, wrong version, failed export, or missing updater key', () => {
    assert.equal(localReadiness({
      status: ' M apps/desktop/src-tauri/tauri.conf.json',
      versions: '0.1.2',
      exportOk: true,
      updaterConfigured: true,
    }).ok, false)
    assert.equal(localReadiness({
      status: '',
      versions: '0.2.0',
      exportOk: true,
      updaterConfigured: true,
    }).ok, false)
    assert.equal(localReadiness({
      status: '',
      versions: '0.1.2',
      exportOk: false,
      updaterConfigured: true,
    }).ok, false)
    assert.equal(localReadiness({
      status: '',
      versions: '0.1.2',
      exportOk: true,
      updaterConfigured: false,
    }).ok, false)
    assert.equal(localReadiness({
      status: '',
      versions: '0.1.2',
      exportOk: true,
      updaterConfigured: true,
    }).ok, true)
  })

  it('fails an existing public tag, missing secrets, or the wrong public repo', () => {
    const secrets = [
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
    assert.equal(githubReadiness({
      privateRepo: '6th-Element-Labs/dispatch',
      publicRepo: '6th-Element-Labs/dispatch-public',
      tagExists: true,
      secrets,
    }).ok, false)
    assert.equal(githubReadiness({
      privateRepo: '6th-Element-Labs/dispatch',
      publicRepo: '6th-Element-Labs/dispatch-public',
      tagExists: false,
      secrets: secrets.filter(name => name !== 'APPLE_TEAM_ID'),
    }).ok, false)
    assert.equal(githubReadiness({
      privateRepo: null,
      publicRepo: null,
      tagExists: false,
      secrets: [],
    }).ok, false)
    assert.equal(githubReadiness({
      privateRepo: '6th-Element-Labs/dispatch',
      publicRepo: '6th-Element-Labs/dispatch',
      tagExists: false,
      secrets,
    }).ok, false)
    assert.equal(githubReadiness({
      privateRepo: '6th-Element-Labs/dispatch',
      publicRepo: '6th-Element-Labs/dispatch-public',
      tagExists: false,
      secrets,
    }).ok, true)
  })
})
