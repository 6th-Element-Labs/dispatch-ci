import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [{
    name: 'dispatch-service-probes',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (request.url !== '/health' && request.url !== '/ready') return next()
        response.setHeader('content-type', 'application/json; charset=utf-8')
        response.end(JSON.stringify({ service: 'dispatch-web', status: request.url === '/health' ? 'healthy' : 'ready' }))
      })
    },
  }],
  server: { host: '127.0.0.1', port: 8410, strictPort: true },
  preview: { host: '127.0.0.1', port: 8410, strictPort: true },
})
