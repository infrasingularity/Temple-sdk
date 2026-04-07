#!/usr/bin/env node
/**
 * Fetch recent trades, aggregate into 1m OHLC (UTC).
 *
 * Auth (first match wins):
 *   0) TEMPLE_ACCESS_TOKEN → Authorization: Bearer (from /auth/login). Optional TEMPLE_REFRESH_TOKEN:
 *      on 401, POST /auth/refresh once then retry. expires_in is usually 1800s (30 min).
 *   A) TEMPLE_API_EMAIL + TEMPLE_API_PASSWORD → SDK /auth/login → Bearer.
 *   B) TEMPLE_API_KEY → GET with X-API-Key (testnet curl style).
 *   TEMPLE_FETCH_PREFER_X_API_KEY=1 → use (B) even if email/password are set (skipped if access token set).
 *   TEMPLE_FETCH_NETWORK=testnet → override host for this script only.
 *
 * If login returns 403/401 but TEMPLE_API_KEY is set, script falls back to X-API-Key on **testnet**
 * (v2 sandbox keys usually work there; mainnet login/geo often blocks).
 *
 * Env: NETWORK or TEMPLE_FETCH_NETWORK, TRADE_SYMBOL, TRADE_LIMIT
 */
import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';
import { initialize, getRecentTrades } from '@temple-digital-group/temple-canton-js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const envPath = resolve(root, '.env');
config({ path: envPath });

/** Host for market fetch only; does not change trading-server NETWORK. */
const network = (process.env.TEMPLE_FETCH_NETWORK || process.env.NETWORK || 'testnet').trim();
const symbol = (process.env.TRADE_SYMBOL || 'CC/USDCx').trim();
const limit = Math.min(500, Math.max(1, Number(process.env.TRADE_LIMIT || '200')));

const email = process.env.TEMPLE_API_EMAIL?.trim();
const password = process.env.TEMPLE_API_PASSWORD?.trim();
const apiKey = process.env.TEMPLE_API_KEY?.trim();
const accessToken = process.env.TEMPLE_ACCESS_TOKEN?.trim();
const refreshToken = process.env.TEMPLE_REFRESH_TOKEN?.trim();
const preferXApiKey = /^1|true|yes$/i.test(String(process.env.TEMPLE_FETCH_PREFER_X_API_KEY || '').trim());

function apiBaseUrl(net) {
  return net === 'testnet' ? 'https://api-testnet.templedigitalgroup.com' : 'https://api.templedigitalgroup.com';
}

function normalizeSymbolForQuery(sym) {
  return sym.replace(/\bCC\b/g, 'Amulet');
}

/** Cloudflare/geo often returns HTML "Access Restricted" instead of JSON. */
function handleTradesHttpResponse(res, text) {
  const t = text ?? '';
  if (t.trim().startsWith('<!') || /Access Restricted/i.test(t)) {
    return {
      error: true,
      status: res.status,
      code: 'GEO_OR_HTML',
      message:
        'HTML response (e.g. "Access Restricted"): mainnet api.templedigitalgroup.com is often blocked by region/IP before your Bearer token is applied. ' +
        'Fix: TEMPLE_FETCH_NETWORK=testnet npm run fetch:trades — and use tokens from testnet POST …/auth/login (same host as the API you call).',
    };
  }
  if (!res.ok) {
    try {
      const j = JSON.parse(t);
      return { error: true, status: res.status, message: j?.error ?? j };
    } catch {
      return { error: true, status: res.status, message: t.slice(0, 500) };
    }
  }
  try {
    return JSON.parse(t);
  } catch {
    return { error: true, status: res.status, message: 'Invalid JSON body', raw: t.slice(0, 300) };
  }
}

/**
 * Testnet-style market auth (same as working curl).
 */
async function fetchRecentTradesXApiKey(net, sym, lim, key) {
  const base = apiBaseUrl(net);
  const u = new URL(`${base}/api/v1/market/trades`);
  u.searchParams.set('symbol', normalizeSymbolForQuery(sym));
  u.searchParams.set('limit', String(lim));
  const res = await fetch(u, {
    headers: { accept: 'application/json', 'X-API-Key': key },
  });
  const text = await res.text();
  return handleTradesHttpResponse(res, text);
}

/**
 * Market GET with Bearer access_token (same as SDK after login).
 */
async function fetchRecentTradesBearer(net, sym, lim, bearer) {
  const base = apiBaseUrl(net);
  const u = new URL(`${base}/api/v1/market/trades`);
  u.searchParams.set('symbol', normalizeSymbolForQuery(sym));
  u.searchParams.set('limit', String(lim));
  const res = await fetch(u, {
    headers: {
      accept: 'application/json',
      Authorization: `Bearer ${bearer}`,
    },
  });
  const text = await res.text();
  return handleTradesHttpResponse(res, text);
}

/** POST /auth/refresh — returns new body or { error: true } */
async function templeRefreshAccessToken(net, refresh) {
  const base = apiBaseUrl(net);
  const res = await fetch(`${base}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ refresh_token: refresh }),
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    return { error: true, status: res.status, message: text?.slice(0, 400) };
  }
  if (!res.ok || !data?.access_token) {
    return { error: true, status: res.status, message: data?.error ?? data };
  }
  return data;
}

async function fetchRecentTradesBearerWithOptionalRefresh(net, sym, lim, token, refresh) {
  let raw = await fetchRecentTradesBearer(net, sym, lim, token);
  if (
    raw &&
    typeof raw === 'object' &&
    raw.error &&
    raw.status === 401 &&
    refresh
  ) {
    console.error('[fetch-trades] access token rejected (401); trying /auth/refresh ...');
    const ref = await templeRefreshAccessToken(net, refresh);
    if (ref && ref.error) {
      return ref;
    }
    const newTok = ref.access_token;
    console.log('[fetch-trades] refresh OK; retrying trades GET\n');
    raw = await fetchRecentTradesBearer(net, sym, lim, newTok);
  }
  return raw;
}

function isTransientLoginFailure(msg) {
  const s = String(msg || '');
  return (
    s.includes('ECONNRESET') ||
    s.includes('ETIMEDOUT') ||
    s.includes('ECONNREFUSED') ||
    s.includes('ENOTFOUND') ||
    s.includes('socket hang up')
  );
}

async function initializeLoginWithRetry(net, em, pw, attempts = 4) {
  let lastRes;
  for (let i = 0; i < attempts; i++) {
    if (i > 0) {
      const delay = 1000 * i;
      console.log(`[fetch-trades] login retry ${i + 1}/${attempts} in ${delay}ms (network error)...`);
      await new Promise((r) => setTimeout(r, delay));
    }
    lastRes = await initialize({
      NETWORK: net,
      API_EMAIL: em,
      API_PASSWORD: pw,
    });
    if (!lastRes || typeof lastRes !== 'object' || !lastRes.error) {
      return lastRes;
    }
    const transient = lastRes.status == null && isTransientLoginFailure(lastRes.message);
    if (!transient || i === attempts - 1) {
      return lastRes;
    }
  }
  return lastRes;
}

function printLogin403Hints() {
  console.error(`
Mainnet /auth/login often returns 403 (unsupported region HTML, or account not allowed on production API).
For sandbox trade data + v2 API keys, use testnet for this script only:

  TEMPLE_FETCH_NETWORK=testnet npm run fetch:trades

Or add to .env:
  TEMPLE_FETCH_NETWORK=testnet

Skip login and use the same curl-style key as ticker:
  TEMPLE_FETCH_PREFER_X_API_KEY=1
  (and NETWORK or TEMPLE_FETCH_NETWORK=testnet)
`);
}

async function main() {
  console.log(`[fetch-trades] .env: ${envPath} (exists: ${existsSync(envPath)})`);
  if (process.env.NETWORK) {
    console.log(`[fetch-trades] Using TEMPLE_FETCH_NETWORK=${network} (overrides NETWORK for this script)`);
  } else {
    console.log(`[fetch-trades] NETWORK=${network} (set TEMPLE_FETCH_NETWORK=testnet to force testnet)`);
  }
  console.log(`[fetch-trades] symbol=${symbol} limit=${limit}`);

  let raw;

  if (accessToken) {
    const tokTail = accessToken.length > 8 ? accessToken.slice(-8) : '***';
    console.log(
      `[fetch-trades] Auth: Bearer access token ***${tokTail}` +
        (refreshToken ? ' + refresh if 401' : '') +
        '\n'
    );
    console.log(
      `[fetch-trades] GET ${apiBaseUrl(network)}/api/v1/market/trades (typical expiry: expires_in=1800 → 30 min)\n`
    );
    raw = await fetchRecentTradesBearerWithOptionalRefresh(
      network,
      symbol,
      limit,
      accessToken,
      refreshToken
    );
  } else if (apiKey && preferXApiKey) {
    console.log('[fetch-trades] Auth: X-API-Key (TEMPLE_FETCH_PREFER_X_API_KEY=1)');
    console.log(
      `[fetch-trades] GET ${apiBaseUrl(network)}/api/v1/market/trades?... X-API-Key=***${apiKey.slice(-4)}\n`
    );
    raw = await fetchRecentTradesXApiKey(network, symbol, limit, apiKey);
  } else if (email && password) {
    console.log('[fetch-trades] Auth: email/password → Bearer');
    const loginRes = await initializeLoginWithRetry(network, email, password);
    if (loginRes && typeof loginRes === 'object' && loginRes.error) {
      console.error('Login failed:', JSON.stringify(loginRes, null, 2));
      const st = loginRes.status;
      if (st === 403 || st === 401) {
        printLogin403Hints();
      }
      const tryKeyFallback =
        apiKey && (st === 403 || st === 401 || st === null);
      if (tryKeyFallback) {
        console.error(
          '[fetch-trades] Retrying with X-API-Key on **testnet** (sandbox tape; not mainnet).\n'
        );
        raw = await fetchRecentTradesXApiKey('testnet', symbol, limit, apiKey);
        if (raw && typeof raw === 'object' && raw.error) {
          console.error('Fallback also failed:', JSON.stringify(raw, null, 2));
          process.exit(1);
        }
      } else {
        if (apiKey) {
          console.error(
            '\nHint: TEMPLE_FETCH_PREFER_X_API_KEY=1 or TEMPLE_FETCH_NETWORK=testnet, or fix login credentials.\n'
          );
        }
        process.exit(1);
      }
    } else {
      console.log('[fetch-trades] Login OK\n');
      console.log(`[fetch-trades] SDK getRecentTrades(${symbol}, { limit: ${limit} })\n`);
      raw = await getRecentTrades(symbol, { limit });
    }
  } else if (apiKey) {
    console.log('[fetch-trades] Auth: X-API-Key (market GET, curl-compatible)');
    console.log(
      `[fetch-trades] GET ${apiBaseUrl(network)}/api/v1/market/trades?... X-API-Key=***${apiKey.slice(-4)}\n`
    );
    raw = await fetchRecentTradesXApiKey(network, symbol, limit, apiKey);
  } else {
    console.error(
      'Set one of:\n' +
        '  TEMPLE_ACCESS_TOKEN (+ optional TEMPLE_REFRESH_TOKEN)\n' +
        '  TEMPLE_API_EMAIL + TEMPLE_API_PASSWORD\n' +
        '  TEMPLE_API_KEY (X-API-Key)\n'
    );
    process.exit(1);
  }

  if (raw === undefined) {
    console.error('[fetch-trades] internal error: no response body');
    process.exit(1);
  }

  if (raw && typeof raw === 'object' && raw.error) {
    console.error('API error:', JSON.stringify(raw, null, 2));
    process.exit(1);
  }

  const rows = normalizeTrades(raw);
  console.log(`Trades returned: ${rows.length}\n`);

  if (rows.length === 0) {
    console.log('No trades to aggregate.');
    process.exit(0);
  }

  console.log('Sample (newest first, up to 5):');
  for (const t of rows.slice(0, 5)) {
    console.log(
      `  ${t.iso}  price=${t.price}  qty=${t.qty}  side=${t.side ?? '?'}`
    );
  }
  console.log('');

  const bars = tradesTo1mOhlcUtc(rows);
  console.log(`1m OHLC bars (UTC, minutes with ≥1 trade): ${bars.length}`);
  console.log('Last 8 bars (oldest → newest in each line):');
  const tail = bars.slice(-8);
  for (const b of tail) {
    console.log(
      JSON.stringify({
        minute: b.minuteKey,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
        volume: b.volume,
        trades: b.tradeCount,
      })
    );
  }
}

/**
 * @param {unknown} raw
 * @returns {{ ts: number, iso: string, price: number, qty: number, side?: string }[]}
 */
function normalizeTrades(raw) {
  let list = [];
  if (Array.isArray(raw)) list = raw;
  else if (raw && typeof raw === 'object' && Array.isArray(raw.trades)) list = raw.trades;
  else if (raw && typeof raw === 'object' && Array.isArray(raw.data)) list = raw.data;

  const out = [];
  for (const row of list) {
    const price = Number(row.price ?? row.price_per_unit);
    const qty = Math.abs(Number(row.quantity ?? row.qty ?? row.size ?? 0));
    const tsStr = row.created_at ?? row.timestamp ?? row.time;
    if (!tsStr || !Number.isFinite(price)) continue;
    const ts = Date.parse(tsStr);
    if (!Number.isFinite(ts)) continue;
    out.push({
      ts,
      iso: new Date(ts).toISOString(),
      price,
      qty: Number.isFinite(qty) ? qty : 0,
      side: row.side,
    });
  }
  out.sort((a, b) => a.ts - b.ts);
  return out;
}

function tradesTo1mOhlcUtc(sortedTrades) {
  /** @type {Map<number, { open: number, high: number, low: number, close: number, volume: number, tradeCount: number }>} */
  const map = new Map();

  for (const t of sortedTrades) {
    const minuteStart = Math.floor(t.ts / 60000) * 60000;
    let bar = map.get(minuteStart);
    if (!bar) {
      bar = {
        open: t.price,
        high: t.price,
        low: t.price,
        close: t.price,
        volume: 0,
        tradeCount: 0,
      };
      map.set(minuteStart, bar);
    }
    bar.high = Math.max(bar.high, t.price);
    bar.low = Math.min(bar.low, t.price);
    bar.close = t.price;
    bar.volume += t.qty;
    bar.tradeCount += 1;
  }

  const keys = [...map.keys()].sort((a, b) => a - b);
  return keys.map((minuteKey) => {
    const b = map.get(minuteKey);
    return {
      minuteKey: new Date(minuteKey).toISOString(),
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
      volume: b.volume,
      tradeCount: b.tradeCount,
    };
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
