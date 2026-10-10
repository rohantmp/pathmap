import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

const emptyModule = fileURLToPath(new URL('./shims/empty-module.js', import.meta.url));

export default defineConfig({
  // GitHub repository name; the dual deploy builds v2 with PATHMAP_BASE=/pathmap/v2/
  base: process.env.PATHMAP_BASE || '/pathmap/',
  plugins: [viteSingleFile()],
  resolve: {
    alias: {
      // jsPDF optional deps used only by jsPDF.html()/SVG APIs — not needed here
      html2canvas: emptyModule,
      canvg: emptyModule,
      dompurify: emptyModule,
    },
  },
  build: {
    target: 'esnext',
    assetsInlineLimit: 100000000,
    chunkSizeWarningLimit: 100000000,
    cssCodeSplit: false,
    reportCompressedSize: false,
  }
});
