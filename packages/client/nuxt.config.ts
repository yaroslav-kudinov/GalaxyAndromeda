const useHmrTunnel = process.env.NUXT_HMR_TUNNEL === '1'

export default defineNuxtConfig({
  ssr: false,
  devtools: { enabled: true },
  modules: ['@pinia/nuxt'],
  app: {
    head: {
      link: [
        { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
        { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: 'anonymous' },
        {
          rel: 'stylesheet',
          href: 'https://fonts.googleapis.com/css2?family=Orbitron:wght@600;700;800&display=swap',
        },
      ],
    },
  },
  devServer: {
    host: '0.0.0.0',
    port: 3000,
  },
  vite: {
    server: {
      allowedHosts: ['.ru.tuna.am'],
      // Для tuna (*.ru.tuna.am) используйте NUXT_HMR_TUNNEL=1.
      // Без него Vite использует ws://localhost:3000.
      ...(useHmrTunnel
        ? {
            hmr: {
              protocol: 'wss',
              clientPort: 443,
            },
          }
        : {
            // Локальная разработка не должна наследовать HTTPS страницы
            // или пытаться подключаться к стандартному wss-порту 443.
            hmr: {
              protocol: 'ws',
              host: 'localhost',
              port: 3000,
              clientPort: 3000,
            },
          }),
      proxy: {
        '/api': {
          target: 'http://127.0.0.1:3001',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, ''),
        },
      },
    },
  },
})
