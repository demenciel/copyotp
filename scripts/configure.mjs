import { loadConfig, saveConfig } from './config.mjs';

const args = process.argv.slice(2);
const web = args[0] === '--brave';
const clientId = args[web ? 1 : 0]?.trim();
if (args.length !== (web ? 2 : 1) || !clientId || !/^\d+-[a-z0-9]+\.apps\.googleusercontent\.com$/.test(clientId)) {
  console.error('Usage: npm run configure -- [--brave] YOUR_CLIENT_ID.apps.googleusercontent.com');
  process.exit(1);
}
const config = await loadConfig();
await saveConfig({ ...config, [web ? 'webClientId' : 'clientId']: clientId });
await import('./build.mjs');
