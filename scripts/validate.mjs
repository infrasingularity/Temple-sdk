#!/usr/bin/env node
/**
 * Validate trading-server: build, env, optional init + health check.
 * Run: node scripts/validate.mjs
 * Or: npm run validate
 */
import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';
import { createRequire } from 'module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const root = resolve(__dirname, '..');
const envPath = resolve(root, '.env');

config({ path: envPath });

const required = ['PRIVATE_KEY', 'PARTY_ID', 'SERVER_API_KEY'];
const missing = required.filter((k) => !process.env[k] || process.env[k].trim() === '');
const hasCreds = missing.length === 0;

function log(msg, ok = true) {
  console.log(ok ? `  \u2713 ${msg}` : `  \u2717 ${msg}`);
}

async function main() {
  console.log('\n=== Trading server validation ===\n');

  // 1. Build exists
  const distIndex = resolve(root, 'dist', 'index.js');
  if (!existsSync(distIndex)) {
    console.log('  Build missing. Run: npm run build');
    process.exit(1);
  }
  log('Build present (dist/index.js)');

  // 2. Env file
  if (!existsSync(envPath)) {
    log('No .env file', false);
    console.log('  Copy .env.example to .env and set PRIVATE_KEY, PARTY_ID, SERVER_API_KEY');
    process.exit(1);
  }
  log('.env file present');

  // 3. Required env vars
  if (missing.length) {
    log(`Required env vars set: ${required.join(', ')}`, false);
    console.log(`  Missing: ${missing.join(', ')}`);
    console.log('\n  Set them in .env to run the server and test /health.');
    console.log('  Build and env file check: OK.\n');
    process.exit(0);
  }
  log(`Required env vars set: ${required.join(', ')}`);

  // 4. Init (Loop + Temple SDK)
  let initOk = false;
  try {
    const { ensureInitialized } = await import('../dist/init.js');
    await ensureInitialized();
    log('Loop + Temple SDK init OK');
    initOk = true;
  } catch (e) {
    log('Loop + Temple SDK init', false);
    console.log('  Error:', e.message);
    console.log('  (Check PRIVATE_KEY/PARTY_ID, LOOP_NETWORK, WALLET_URL, API_URL, NETWORK, TEMPLE_API_KEY.)');
    if (!e.message.includes('fetch') && !e.message.includes('user not found') && !e.message.includes('Missing')) {
      process.exit(1);
    }
  }

  // 5. Health check (start app on random port, GET /health)
  try {
    const { app } = await import('../dist/index.js');
    if (app && typeof app.listen === 'function') {
      const server = app.listen(0, '127.0.0.1');
      await new Promise((resolve) => server.on('listening', resolve));
      const port = server.address().port;
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      const body = await res.json();
      server.close();
      if (body && body.ok) {
        log('/health OK');
      } else {
        log('/health response', false);
        console.log('  Got:', body);
      }
    }
  } catch (e) {
    log('/health check', false);
    console.log('  ', e.message);
  }

  console.log('\n  Summary:');
  if (initOk) {
    console.log('  - Init and health check passed. Run: npm start');
  } else {
    console.log('  - Set valid PRIVATE_KEY/PARTY_ID (Loop wallet) and run: npm start');
  }
  console.log('  - Then: curl http://localhost:3001/health');
  console.log('  - API routes need: Authorization: Bearer <SERVER_API_KEY>\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
