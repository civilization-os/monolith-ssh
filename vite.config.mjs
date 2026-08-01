import { defineConfig } from 'vite';

export default defineConfig({
  // Electron loads the production bundle over file://, so assets must stay
  // relative to dist/index.html instead of resolving from a filesystem root.
  base: './'
});
