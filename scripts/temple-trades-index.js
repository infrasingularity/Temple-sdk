#!/usr/bin/env node
/**
 * Standalone: GET /api/v1/market/trades using TEMPLE_ACCESS_TOKEN (+ optional TEMPLE_REFRESH_TOKEN).
 * No npm packages — Node 18+ (global fetch).
 *
 * Env:
 *   TEMPLE_ACCESS_TOKEN   (required to start)
 *   TEMPLE_REFRESH_TOKEN (optional; on 401, POST /auth/refresh then retry once)
 *   NETWORK               mainnet | testnet (default testnet)
 *   TRADE_SYMBOL          default CC/USDCx
 *   TRADE_LIMIT           default 200, max 500
 *
 * Loads ../.env if present (does not override existing process.env).
 *
 * Run: node scripts/temple-trades-index.js
 */
import { readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return;
  const text = readFileSync(filePath, 'utf8');
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i === -1) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (process.env[k] === undefined || process.env[k] === '') {
      process.env[k] = v;
    }
  }
}

loadEnvFile(join(__dirname, '..', '.env'));

const network = (process.env.NETWORK || 'testnet').trim();
const base =
  network === 'testnet'
    ? 'https://api-testnet.templedigitalgroup.com'
    : 'https://api.templedigitalgroup.com';

let accessToken = (process.env.TEMPLE_ACCESS_TOKEN || '').trim();
const refreshToken = (process.env.TEMPLE_REFRESH_TOKEN || '').trim();
const symbol = (process.env.TRADE_SYMBOL || 'CC/USDCx')
  .trim()
  .replace(/\bCC\b/g, 'Amulet');
const limit = Math.min(
  500,
  Math.max(1, Number(process.env.TRADE_LIMIT || '200'))
);

function tradesUrl() {
  const u = new URL(`${base}/api/v1/market/trades`);
  u.searchParams.set('symbol', symbol);
  u.searchParams.set('limit', String(limit));
  return u.toString();
}

async function getTrades(bearer) {
  const res = await fetch(tradesUrl(), {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${bearer}`,
    },
  });
  const text = await res.text();
  return { res, text };
}

async function refreshAccess() {
  const res = await fetch(`${base}/auth/refresh`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Refresh: non-JSON HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  if (!res.ok || !data.access_token) {
    throw new Error(`Refresh failed HTTP ${res.status}: ${JSON.stringify(data)}`);
  }
  return data.access_token;
}

async function main() {
  if (!accessToken) {
    console.error('Missing TEMPLE_ACCESS_TOKEN');
    process.exit(1);
  }

  console.error(`GET ${tradesUrl()}`);
  console.error(`NETWORK=${network} (Bearer ***${accessToken.slice(-8)})\n`);

  let { res, text } = await getTrades(accessToken);

  if (res.status === 401 && refreshToken) {
    console.error('401 — refreshing access_token via TEMPLE_REFRESH_TOKEN …');
    accessToken = await refreshAccess();
    console.error(`New access_token (last 8): ***${accessToken.slice(-8)}\n`);
    ({ res, text } = await getTrades(accessToken));
  }

  if (!res.ok) {
    if (text.trim().startsWith('<!')) {
      console.error(
        'HTTP',
        res.status,
        '— HTML (often mainnet geo "Access Restricted"). Try NETWORK=testnet or VPN/allowed region.'
      );
    }
    console.error(text.slice(0, 1500));
    process.exit(1);
  }

  let json;
  try {
    json = JSON.parse(text);
  } catch {
    console.error('Invalid JSON:', text.slice(0, 500));
    process.exit(1);
  }

  console.log(JSON.stringify(json, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
