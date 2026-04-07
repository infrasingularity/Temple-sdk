#!/usr/bin/env node
/**
 * GET /api/exchange/historical_trades (Temple docs: Exchange historical trades)
 * https://apidocs.templedigitalgroup.com/reference/getexchangehistoricaltrades
 *
 * Query params:
 *   ticker_id   (required) e.g. CC_USDCx, CBTC_USDCx
 *   type        optional: buy | sell
 *   limit       ≤ 500, default 200 (this script defaults to 500)
 *   start_time  RFC3339
 *   end_time    RFC3339
 *
 * Env:
 *   NETWORK=testnet|mainnet
 *   EXCHANGE_TICKER_ID=CC_USDCx
 *   EXCHANGE_TRADE_TYPE=buy|sell   (optional)
 *   EXCHANGE_HISTORICAL_LIMIT=500
 *   EXCHANGE_START_TIME / EXCHANGE_END_TIME  (RFC3339; optional)
 *   If both times omitted: last EXCHANGE_LOOKBACK_DAYS (default 30) days
 *   EXCHANGE_CHUNK_DAYS=7   optional — split [start,end] into chunks (each request limit 500)
 *   TEMPLE_ACCESS_TOKEN     optional Bearer (docs say testnet may be open; mainnet may differ)
 *
 * Run: npm run fetch:exchange-history
 */
import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '..', '.env') });

const network = (process.env.NETWORK || 'testnet').trim();
const base =
  network === 'testnet'
    ? 'https://api-testnet.templedigitalgroup.com'
    : 'https://api.templedigitalgroup.com';

const tickerId = (process.env.EXCHANGE_TICKER_ID || 'CC_USDCx').trim();
const tradeType = process.env.EXCHANGE_TRADE_TYPE?.trim(); // buy | sell
const limit = Math.min(
  500,
  Math.max(1, Number(process.env.EXCHANGE_HISTORICAL_LIMIT || '500'))
);
const lookbackDays = Math.max(1, Number(process.env.EXCHANGE_LOOKBACK_DAYS || '30'));
const chunkDays = Math.max(0, Number(process.env.EXCHANGE_CHUNK_DAYS || '0'));

const accessToken = process.env.TEMPLE_ACCESS_TOKEN?.trim();

function rfc3339(d) {
  return d.toISOString();
}

function parseTime(s) {
  const t = Date.parse(s);
  if (!Number.isFinite(t)) return null;
  return new Date(t);
}

function defaultRange() {
  const end = new Date();
  const start = new Date(end.getTime() - lookbackDays * 24 * 60 * 60 * 1000);
  return { start, end };
}

async function fetchChunk(start, end) {
  const u = new URL(`${base}/api/exchange/historical_trades`);
  u.searchParams.set('ticker_id', tickerId);
  u.searchParams.set('limit', String(limit));
  u.searchParams.set('start_time', rfc3339(start));
  u.searchParams.set('end_time', rfc3339(end));
  if (tradeType === 'buy' || tradeType === 'sell') {
    u.searchParams.set('type', tradeType);
  }

  const headers = { Accept: 'application/json' };
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  const res = await fetch(u, { headers });
  const text = await res.text();

  if (!res.ok) {
    if (text.trim().startsWith('<!')) {
      throw new Error(
        `HTTP ${res.status} HTML (geo block on mainnet?). Try NETWORK=testnet. URL: ${u.pathname}`
      );
    }
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 800)}`);
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Invalid JSON: ${text.slice(0, 400)}`);
  }
  return data;
}

function mergeChunk(accum, chunk) {
  if (chunk == null) return accum;
  if (Array.isArray(chunk)) {
    accum.push(...chunk);
    return accum;
  }
  if (typeof chunk === 'object') {
    for (const v of Object.values(chunk)) {
      if (Array.isArray(v)) accum.push(...v);
    }
  }
  return accum;
}

async function main() {
  if (!tickerId) {
    console.error('Set EXCHANGE_TICKER_ID (e.g. CC_USDCx)');
    process.exit(1);
  }

  let start;
  let end;
  if (process.env.EXCHANGE_START_TIME?.trim() && process.env.EXCHANGE_END_TIME?.trim()) {
    start = parseTime(process.env.EXCHANGE_START_TIME.trim());
    end = parseTime(process.env.EXCHANGE_END_TIME.trim());
    if (!start || !end) {
      console.error('EXCHANGE_START_TIME / EXCHANGE_END_TIME must be valid RFC3339');
      process.exit(1);
    }
    if (start >= end) {
      console.error('start_time must be before end_time');
      process.exit(1);
    }
  } else {
    ({ start, end } = defaultRange());
  }

  console.error(`Base: ${base}`);
  console.error(`ticker_id=${tickerId} limit=${limit}${tradeType ? ` type=${tradeType}` : ''}`);
  console.error(`window: ${rfc3339(start)} → ${rfc3339(end)} (${lookbackDays}d default if times omitted)\n`);

  let merged = [];

  if (chunkDays > 0) {
    const chunkMs = chunkDays * 24 * 60 * 60 * 1000;
    let cursor = new Date(start);
    let n = 0;
    while (cursor < end) {
      const chunkEnd = new Date(Math.min(cursor.getTime() + chunkMs, end.getTime()));
      console.error(`Chunk ${++n}: ${rfc3339(cursor)} → ${rfc3339(chunkEnd)}`);
      const data = await fetchChunk(cursor, chunkEnd);
      merged = mergeChunk(merged, data);
      cursor = chunkEnd;
    }
    console.error(`\nMerged ~${merged.length} row(s) from arrays in response(s).`);
    console.log(JSON.stringify({ ticker_id: tickerId, count: merged.length, trades: merged }, null, 2));
  } else {
    const data = await fetchChunk(start, end);
    console.log(JSON.stringify(data, null, 2));
    const arrLen = Array.isArray(data)
      ? data.length
      : typeof data === 'object' && data !== null
        ? Object.values(data)
            .filter(Array.isArray)
            .reduce((s, a) => s + a.length, 0)
        : 0;
    if (arrLen >= limit) {
      console.error(
        `\nNote: response may be capped at limit=${limit}. For more trades over the same period, set EXCHANGE_CHUNK_DAYS=7 (or smaller) to page in time.`
      );
    }
  }
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
