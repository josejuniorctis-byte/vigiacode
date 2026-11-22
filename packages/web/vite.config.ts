import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// O build vai embutido no pacote npm da CLI e é servido pelo Fastify em :4317.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: '../cli/dist/web',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:4317',
    },
  },
});
