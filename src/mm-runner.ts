/**
 * Entry: Loop + Temple init, then in-process market-maker loop (no HTTP to self).
 */
import { config as loadDotenv } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { ensureInitialized } from './init.js';
import { startBinanceBookTicker, stopBinanceBookTicker } from './feeds/binance-book-ticker.js';
import { startTempleWs, stopTempleWs } from './feeds/temple-ws.js';
import { loadMmConfig } from './mm/config.js';
import { startMarketMaker } from './mm/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
loadDotenv({ path: resolve(__dirname, '..', '.env'), override: true, quiet: true });

function requireEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return v;
}

async function main() {
  await ensureInitialized();
  startBinanceBookTicker(requireEnv('BINANCE_WS_URL'));
  const mmCfg = loadMmConfig();
  startTempleWs(requireEnv('TEMPLE_WS_URL'), requireEnv('TEMPLE_API_KEY'), mmCfg.symbol);
  const stop = () => {
    stopTempleWs();
    stopBinanceBookTicker();
    process.exit(0);
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  console.log('[mm-runner] initialized, starting MM loop');
  await startMarketMaker();
}

main().catch((e) => {
  console.error('[mm-runner] fatal', e);
  process.exit(1);
});
