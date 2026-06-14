import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: '/driving-visualizer/',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  build: {
    chunkSizeWarningLimit: 750,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: (id) => {
                if (id.includes('/node_modules/three/')) return 'vendor-three';
              },
              minShareCount: 0,
              minSize: 0,
            },
            {
              name: (id) => {
                if (
                  id.includes('@react-three/') ||
                  id.includes('/three-stdlib/')
                )
                  return 'vendor-r3f';
              },
              minShareCount: 0,
              minSize: 0,
            },
            {
              name: (id) => {
                if (
                  id.includes('/react/') ||
                  id.includes('/react-dom/') ||
                  id.includes('/scheduler/')
                )
                  return 'vendor-react';
              },
              minShareCount: 0,
              minSize: 0,
            },
          ],
        },
      },
    },
  },
});
