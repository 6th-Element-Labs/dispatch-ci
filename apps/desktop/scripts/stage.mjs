// Builds the Dispatch services and copies their compiled output into the Tauri
// resources directory. Fails loudly if any build or expected file is missing.
import { copyFileSync, cpSync, existsSync, readFileSync, rmSync } from 'node:fs'
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
  installRuntimeDependencies(service, destination)
}
if (!servicesOnly && !existsSync(join(repo, 'services', 'web', 'dist', 'index.html'))) {
  console.error('stage: services/web/dist/index.html is missing after the web build')
  process.exit(1)
}
console.log(`stage: services staged under ${resources}`)

// A service's runtime npm dependencies must travel with its compiled code.
// The lockfile is copied so the bundle installs exactly what CI tested.
function installRuntimeDependencies(service, destination) {
  const serviceRoot = join(repo, 'services', service)
  const manifest = JSON.parse(readFileSync(join(serviceRoot, 'package.json'), 'utf8'))
  const dependencies = Object.keys(manifest.dependencies ?? {})
  if (dependencies.length === 0) return
  for (const file of ['package.json', 'package-lock.json']) {
    const source = join(serviceRoot, file)
    if (!existsSync(source)) {
      console.error(`stage: services/${service} has runtime dependencies but no ${file}`)
      process.exit(1)
    }
    copyFileSync(source, join(destination, file))
  }
  console.log(`stage: installing ${dependencies.length} runtime dependencies for services/${service}`)
  execSync(`npm --prefix "${destination}" ci --omit=dev --ignore-scripts --no-audit --no-fund`, { stdio: 'inherit' })
  for (const dependency of dependencies) {
    if (!existsSync(join(destination, 'node_modules', dependency))) {
      console.error(`stage: ${dependency} is missing from ${destination}/node_modules after install`)
      process.exit(1)
    }
  }
}
