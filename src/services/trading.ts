/**
 * Temple V2 REST wrappers.
 * Derives API host from NETWORK and calls endpoints matching Temple cURL docs.
 */

export type PlaceLimitParams = {
  symbol: string;
  side: string;
  quantity: number;
  price: number;
  orderType?: string;
  expiresAt?: string;
};

type RequestMethod = 'GET' | 'POST';

function requireEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return v;
}

function normalizeSide(side: string): 'buy' | 'sell' {
  const s = String(side).trim().toLowerCase();
  if (s === 'buy' || s === 'bid') return 'buy';
  if (s === 'sell' || s === 'ask') return 'sell';
  return 'buy';
}

function buildUrl(path: string, query?: Record<string, string>): string {
  const network = requireEnv('NETWORK').toLowerCase();
  let base = '';
  if (network === 'testnet') {
    base = 'https://api-testnet.templedigitalgroup.com';
  } else if (network === 'mainnet') {
    base = 'https://api.templedigitalgroup.com';
  } else {
    throw new Error('NETWORK must be either testnet or mainnet');
  }
  const u = new URL(`${base}${path}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      u.searchParams.set(k, v);
    }
  }
  return u.toString();
}

async function templeRequest(
  method: RequestMethod,
  path: string,
  opts?: { query?: Record<string, string>; body?: unknown }
): Promise<unknown> {
  const apiKey = requireEnv('TEMPLE_API_KEY');
  const url = buildUrl(path, opts?.query);
  const res = await fetch(url, {
    method,
    headers: {
      accept: 'application/json',
      'Content-Type': 'application/json',
      'X-API-Key': apiKey,
    },
    body: method === 'POST' ? JSON.stringify(opts?.body ?? {}) : undefined,
  });

  const text = await res.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { raw: text };
    }
  }

  if (!res.ok) {
    return {
      error: true,
      status: res.status,
      message: `Temple API ${res.status} ${res.statusText}`,
      response: payload,
    };
  }

  return payload;
}

function normalizeActiveOrderRow(row: unknown): Record<string, unknown> | null {
  if (!row || typeof row !== 'object') return null;
  const r = row as Record<string, unknown>;
  return {
    ...r,
    order_id: String(r.order_id ?? r.orderId ?? r.id ?? ''),
    side: String(r.side ?? ''),
    price: String(r.price ?? ''),
    quantity: String(r.quantity ?? r.qty ?? ''),
  };
}

export async function placeLimitOrder(params: PlaceLimitParams): Promise<unknown> {
  return templeRequest('POST', '/api/trading/orders', {
    body: {
      Symbol: params.symbol,
      Side: normalizeSide(params.side),
      Type: params.orderType || 'limit',
      Quantity: params.quantity,
      Price: params.price,
    },
  });
}

export async function listActiveOrders(options?: { symbol?: string; limit?: number }): Promise<unknown> {
  const query: Record<string, string> = {};
  if (options?.symbol) query.symbol = options.symbol;
  if (options?.limit != null) query.limit = String(options.limit);

  const raw = await templeRequest('GET', '/api/trading/orders/active', { query });
  if (!raw || typeof raw !== 'object' || (raw as { error?: boolean }).error) {
    return raw;
  }

  if (Array.isArray(raw)) {
    return raw.map(normalizeActiveOrderRow).filter(Boolean);
  }

  const o = raw as Record<string, unknown>;
  if (Array.isArray(o.orders)) {
    return {
      ...o,
      orders: o.orders.map(normalizeActiveOrderRow).filter(Boolean),
    };
  }
  if (Array.isArray(o.data)) {
    return {
      ...o,
      data: o.data.map(normalizeActiveOrderRow).filter(Boolean),
    };
  }
  return raw;
}

export async function cancelOrderById(orderId: string): Promise<unknown> {
  return templeRequest('POST', `/api/trading/orders/${encodeURIComponent(orderId)}/cancel`);
}

export async function cancelAllOrders(symbol?: string): Promise<unknown> {
  return templeRequest('POST', '/api/trading/orders/cancel-all', {
    body: symbol ? { Symbol: symbol } : {},
  });
}

export async function listPastOrders(options?: {
  symbol?: string;
  limit?: number;
  status?: string;
}): Promise<unknown> {
  const query: Record<string, string> = {};
  if (options?.symbol) query.symbol = options.symbol;
  if (options?.limit != null) query.limit = String(options.limit);
  if (options?.status) query.status = options.status;
  return templeRequest('GET', '/api/trading/orders/past', { query });
}

export async function getOrderBookSnapshot(symbol: string, levels = 10): Promise<unknown> {
  return templeRequest('GET', '/api/v1/market/orderbook', {
    query: { symbol, levels: String(levels) },
  });
}

export async function getTickerSnapshot(symbol: string): Promise<unknown> {
  const raw = await templeRequest('GET', '/api/v1/market/tickers');
  if (!Array.isArray(raw)) return raw;
  const wanted = symbol.trim().toUpperCase();
  return raw.find((x) => {
    if (!x || typeof x !== 'object') return false;
    const r = x as Record<string, unknown>;
    return String(r.symbol ?? r.ticker_id ?? '').toUpperCase() === wanted;
  }) ?? null;
}

export async function getBalancesForParty(_partyId: string): Promise<unknown> {
  return templeRequest('GET', '/api/v1/account/balances');
}
