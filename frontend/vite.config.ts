import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

// Vite config — https://vitejs.dev/config/
//
// Исходный конфиг Figma Make (с плагинами figmaSiteConfiguration / figmaErrorOverlayReplay /
// figmaMakeKitPlugin) сохранён в docs/ внутри оригинального zip-архива. Здесь оставлена
// чистая конфигурация, не зависящая от рантайма Figma Make.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // ASCII-выход: кириллица и эмодзи экранируются в \uXXXX. Нужно для инлайн-сборки,
  // которая встраивается в чужую страницу и не может рассчитывать на свой <meta charset>.
  esbuild: { charset: 'ascii' },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    host: '0.0.0.0',
    port: parseInt(process.env.PORT || '5173'),
  },
  preview: {
    host: '0.0.0.0',
    port: parseInt(process.env.PORT || '5173'),
  },
})
