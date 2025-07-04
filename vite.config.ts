import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    lib: {
      entry: 'index.ts',
      name: 'TaskPoolCoordinator',
      formats: ['es', 'cjs'],
      fileName: (format) => `index.${format === 'es' ? 'mjs' : 'cjs'}`,
    },
    outDir: 'dist',
    rollupOptions: {
      external: [],
    },
    emptyOutDir: true,
    sourcemap: true,
    minify: false,
  },
}) 