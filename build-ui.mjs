import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, 'dist');
fs.mkdirSync(outDir, { recursive: true });

const jsResult = await esbuild.build({
  entryPoints: [path.join(__dirname, 'src', 'app.js')],
  bundle: true,
  minify: true,
  format: 'iife',
  write: false,
  target: ['es2022'],
  loader: {
    '.css': 'text',
  },
});

const bundledJs = jsResult.outputFiles[0].text;
const template = fs.readFileSync(path.join(__dirname, 'src', 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, 'src', 'styles.css'), 'utf8');

// Inject CSS and bundled JS into single self-contained HTML (use replacer functions so '$' in minified JS is not interpreted)
const html = template
  .replace('<!-- INLINE_CSS -->', () => `<style>\n${css}\n</style>`)
  .replace('<!-- INLINE_JS -->', () => `<script>\n${bundledJs}\n</script>`);

fs.writeFileSync(path.join(outDir, 'app.html'), html, 'utf8');
const sizeKb = (Buffer.byteLength(html, 'utf8') / 1024).toFixed(1);
console.log(`Built dist/app.html (${sizeKb} KB)`);
