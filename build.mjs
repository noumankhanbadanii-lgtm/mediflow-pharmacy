import { build } from 'esbuild';
import { mkdir, readFile, writeFile, cp, rm } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = dirname(fileURLToPath(import.meta.url));
const dist = join(root, 'dist');
const androidOnly = process.argv.includes('--android');
const manifest = androidOnly ? null : JSON.parse(await readFile(join(root, '.openai/hosting.json'), 'utf8'));
if (!androidOnly) assert.ok(manifest.project_id, 'A Site project ID is required.');
await rm(dist, { recursive: true, force: true });
await mkdir(join(dist, 'server'), { recursive: true });
await mkdir(join(dist, '.openai'), { recursive: true });

const entry = `import React from 'react'; import { createRoot } from 'react-dom/client'; import App from './src/App.jsx'; import './src/styles.css'; createRoot(document.getElementById('root')).render(React.createElement(App));`;
const frontend = await build({
  stdin: { contents: entry, resolveDir: root, sourcefile: 'entry.jsx', loader: 'jsx' },
  bundle: true, write: false, outdir: 'bundle', format: 'esm', target: ['es2022'], minify: true,
  jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' },
});
const js = frontend.outputFiles.find((file) => file.path.endsWith('.js'))?.text || '';
const css = frontend.outputFiles.find((file) => file.path.endsWith('.css'))?.text || '';
assert.ok(js, 'Frontend bundle was empty.');
const template = await readFile(join(root, 'index.html'), 'utf8');
const shell = template.replace('/*__APP_CSS__*/', () => css.replace(/<\/style/gi, '<\\/style')).replace('/*__APP_JS__*/', () => js.replace(/<\/script/gi, '<\\/script'));

await mkdir(join(root,'android/app/src/main/assets'),{recursive:true});
await writeFile(join(root,'android/app/src/main/assets/index.html'),shell);
if (androidOnly) { console.log('Bundled offline Android interface.'); process.exit(0); }

await build({
  entryPoints: [join(root, 'worker.mjs')], outfile: join(dist, 'server/index.js'), bundle: true,
  format: 'esm', platform: 'browser', target: ['es2022'], minify: false,
  plugins: [{ name: 'embedded-app-shell', setup(builder) {
    builder.onResolve({ filter: /^virtual:app-shell$/ }, () => ({ path: 'app-shell', namespace: 'embedded' }));
    builder.onLoad({ filter: /.*/, namespace: 'embedded' }, () => ({ contents: `export default ${JSON.stringify(shell)};`, loader: 'js' }));
  } }],
});
await writeFile(join(dist, '.openai/hosting.json'), JSON.stringify(manifest, null, 2) + '\n');
// Keep schema migrations beside the deployable artifact for Sites to apply.
try { await cp(join(root, 'drizzle'), join(dist, 'drizzle'), { recursive: true }); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const workerSource = await readFile(join(dist, 'server/index.js'), 'utf8');
const worker = await import(`data:text/javascript;base64,${Buffer.from(workerSource).toString('base64')}`);
assert.equal(typeof worker.default?.fetch, 'function');
const response = await worker.default.fetch(new Request('https://mediflow.test/'), {});
assert.equal(response.status, 200);
assert.match(await response.text(), /MediFlow/);
console.log(`Built and validated single Worker artifact (${Math.round(Buffer.byteLength(workerSource) / 1024)} KB).`);
