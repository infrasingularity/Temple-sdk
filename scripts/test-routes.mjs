#!/usr/bin/env node
/**
 * Test trading-server routes. Loads .env, initializes SDK, starts app on random port, hits each route.
 * Run: node scripts/test-routes.mjs   (from trading-server/)
 */
import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
config({ path: resolve(root, '.env'), override: true });

const API_KEY = process.env.SERVER_API_KEY;
if (!API_KEY) {
  console.error('Missing SERVER_API_KEY in .env');
  process.exit(1);
}

const BINANCE_WS = process.env.BINANCE_WS_URL?.trim();
if (!BINANCE_WS) {
  console.error('Missing BINANCE_WS_URL in .env (required for /market/ticker tests)');
  process.exit(1);
}

const authHeader = { Authorization: `Bearer ${API_KEY}` };

async function request(method, path, body) {
  const url = `${base}${path}`;
  const opt = { method, headers: { ...authHeader, 'Content-Type': 'application/json' } };
  if (body && (method === 'POST' || method === 'PUT')) opt.body = JSON.stringify(body);
  const res = await fetch(url, opt);
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: res.status, data };
}

let base;

function extractOrderId(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const direct = payload.order_id || payload.orderId || payload.id;
  if (typeof direct === 'string' && direct) return direct;

  const result = payload.result;
  if (result && typeof result === 'object') {
    const rid = result.order_id || result.orderId || result.id;
    if (typeof rid === 'string' && rid) return rid;
  }
  return null;
}

async function main() {
  console.log('\n=== Testing trading-server routes ===\n');

  const { ensureInitialized } = await import('../dist/init.js');
  const { app } = await import('../dist/index.js');
  const { startBinanceBookTicker, stopBinanceBookTicker } = await import(
    '../dist/feeds/binance-book-ticker.js'
  );

  await ensureInitialized();
  startBinanceBookTicker(BINANCE_WS);
  await new Promise((r) => setTimeout(r, 800));

  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.on('listening', r));
  const port = server.address().port;
  base = `http://127.0.0.1:${port}`;

  const tests = [
    { name: 'GET /health (no auth)', method: 'GET', path: '/health', auth: false },
    { name: 'GET /health with auth', method: 'GET', path: '/health', auth: true },
    { name: 'GET /holdings', method: 'GET', path: '/holdings' },
    { name: 'GET /orders', method: 'GET', path: '/orders' },
    { name: 'GET /instruments', method: 'GET', path: '/instruments' },
    { name: 'GET /market/ticker', method: 'GET', path: '/market/ticker' },
    { name: 'GET /market/orderbook', method: 'GET', path: '/market/orderbook?levels=5' },
    { name: 'POST /orders (validation)', method: 'POST', path: '/orders', body: { symbol: 'CC/USDCx', side: 'Buy', quantity: '1', pricePerUnit: '0.01' } },
  ];

  for (const t of tests) {
    const url = `${base}${t.path}`;
    const opt = { method: t.method, headers: t.auth === false ? {} : { ...authHeader, 'Content-Type': 'application/json' } };
    if (t.body) opt.body = JSON.stringify(t.body);
    const res = await fetch(url, opt);
    const text = await res.text();
    let data;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    const ok = res.status >= 200 && res.status < 400;
    const summary = data?.error ? (data.message || data.error) : (data?.success ? 'OK' : res.status);
    console.log(ok ? `  ✓ ${t.name}` : `  ✗ ${t.name}`);
    console.log(`    ${res.status} ${typeof summary === 'string' ? summary : JSON.stringify(summary).slice(0, 80)}`);
  }

  console.log('\n  Optional: DELETE newly-created order');
  const createRes = await request('POST', '/orders', {
    symbol: 'CC/USDCx',
    side: 'Buy',
    quantity: '1',
    pricePerUnit: '0.01',
  });
  const createdOrderId = extractOrderId(createRes.data);
  if (!createdOrderId) {
    console.log('  ✗ DELETE /orders/:id (created)');
    console.log(`    create response had no order id (status ${createRes.status})`);
  } else {
    const delRes = await request('DELETE', `/orders/${encodeURIComponent(createdOrderId)}`);
    const delSummary = delRes.data?.error
      ? (delRes.data.message || delRes.data.error)
      : (delRes.data?.success ? 'OK' : delRes.status);
    const delOk = delRes.status >= 200 && delRes.status < 400;
    console.log(delOk ? '  ✓ DELETE /orders/:id (created)' : '  ✗ DELETE /orders/:id (created)');
    console.log(`    ${delRes.status} ${typeof delSummary === 'string' ? delSummary : JSON.stringify(delSummary).slice(0, 80)}`);
  }

  console.log('\n  Optional: POST /holdings/merge (can fail if nothing to merge)');
  const mergeRes = await fetch(`${base}/holdings/merge`, { method: 'POST', headers: authHeader });
  const mergeText = await mergeRes.text();
  let mergeData;
  try {
    mergeData = mergeText ? JSON.parse(mergeText) : null;
  } catch {
    mergeData = mergeText;
  }
  const mergeOk = mergeRes.status >= 200 && mergeRes.status < 400;
  console.log(mergeOk ? `  ✓ POST /holdings/merge` : `  ✗ POST /holdings/merge`);
  console.log(`    ${mergeRes.status} ${mergeData?.message || mergeData?.error || (mergeData?.success ? 'OK' : '')}\n`);

  server.close();
  stopBinanceBookTicker();
  console.log('Done.\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
