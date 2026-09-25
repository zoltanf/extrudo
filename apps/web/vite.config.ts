import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset URLs so the same build loads from file:// inside Electron.
  base: './',
  plugins: [react()],
});
