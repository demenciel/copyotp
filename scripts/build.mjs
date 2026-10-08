import { build } from 'esbuild';
import sharp from 'sharp';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { loadConfig, extensionId, scope } from './config.mjs';

const root = new URL('../', import.meta.url);
const output = new URL('../dist/', import.meta.url);
const config = await loadConfig();
await mkdir(new URL('icons/', output), { recursive: true });
const manifest = JSON.parse(await readFile(new URL('manifest.json', root), 'utf8'));
const pkg = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
if (manifest.version !== pkg.version) throw new Error('package.json and manifest.json versions must match.');
manifest.key = config.publicKey;
if (config.clientId) manifest.oauth2 = { client_id: config.clientId, scopes: [scope] };
await writeFile(new URL('manifest.json', output), JSON.stringify(manifest, null, 2) + '\n');
await writeFile(new URL('oauth-config.js', output), `export const webClientId = ${JSON.stringify(config.webClientId || '')};\n`);
await build({
  entryPoints: ['src/background.ts', 'src/popup.ts'],
  absWorkingDir: root.pathname,
  outdir: output.pathname,
  bundle: true,
  minify: true,
  format: 'esm',
  target: 'chrome116',
  external: ['./oauth-config.js'],
  legalComments: 'eof'
});
for (const name of ['popup.html', 'popup.css']) {
  await copyFile(new URL(`src/${name}`, root), new URL(name, output));
}
// Raster toolbar assets; the mark uses Lucide's Copy icon geometry.
const mark = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><rect width="128" height="128" rx="16" fill="#101010"/><g transform="translate(24 24) scale(3.333)" fill="none" stroke="#f4f4f5" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></g></svg>');
for (const size of [16, 32, 48, 128]) {
  const icon = size === 128
    ? sharp(mark).resize(96, 96).extend({ top: 16, bottom: 16, left: 16, right: 16, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    : sharp(mark).resize(size, size);
  await icon.png().toFile(new URL(`icons/${size}.png`, output).pathname);
}
console.log(`Built dist/ | Extension ID: ${extensionId(config.publicKey)}`);
await copyFile(new URL('THIRD_PARTY_NOTICES.txt', root), new URL('THIRD_PARTY_NOTICES.txt', output));
console.log(config.clientId ? 'OAuth configured.' : 'OAuth client ID needed. See README.md to connect Gmail.');
console.log(config.webClientId ? 'Brave OAuth configured.' : 'Brave OAuth client ID needed. See README.md.');
console.log(`Brave OAuth redirect: https://${extensionId(config.publicKey)}.chromiumapp.org/`);
