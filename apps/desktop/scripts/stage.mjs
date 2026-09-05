// Builds the Dispatch services and copies their compiled output into the Tauri
// resources directory. Fails loudly if any build or expected file is missing.
import { cpSync, existsSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repo = resolve(desktop, '..', '..')
const servicesOnly = process.argv.includes('--services-only')
const resources = join(desktop, 'src-tauri', 'resources', 'services')

const builds = servicesOnly ? ['mail', 'agent'] : ['web', 'mail', 'agent']
for (const service of builds) {
  console.log(`stage: building services/${service}`)
  execSync(`npm --prefix "${join(repo, 'services', service)}" run build`, { stdio: 'inherit' })
}

rmSync(resources, { recursive: true, force: true })
for (const service of ['mail', 'agent']) {
  const source = join(repo, 'services', service, 'dist', 'src')
  const destination = join(resources, service)
  cpSync(source, destination, { recursive: true })
  const entry = join(destination, 'server.js')
  if (!existsSync(entry)) {
    console.error(`stage: ${entry} is missing after building services/${service}`)
    process.exit(1)
  }
}
if (!servicesOnly && !existsSync(join(repo, 'services', 'web', 'dist', 'index.html'))) {
  console.error('stage: services/web/dist/index.html is missing after the web build')
  process.exit(1)
}
console.log(`stage: services staged under ${resources}`)
