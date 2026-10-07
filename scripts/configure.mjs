import { loadConfig, saveConfig } from './config.mjs';

const clientId = process.argv[2]?.trim();
if (!clientId || !/^\d+-[a-z0-9]+\.apps\.googleusercontent\.com$/.test(clientId)) {
  console.error('Usage: npm run configure -- YOUR_CHROME_EXTENSION_CLIENT_ID.apps.googleusercontent.com');
  process.exit(1);
}
const config = await loadConfig();
await saveConfig({ ...config, clientId });
await import('./build.mjs');
