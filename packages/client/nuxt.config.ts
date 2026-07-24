export default defineNuxtConfig({
  ssr: false,
  devtools: { enabled: true },
  modules: ['@pinia/nuxt'],
  vite: {
    server: {
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
