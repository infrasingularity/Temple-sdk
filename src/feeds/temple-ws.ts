/**
 * Outbound Temple WebSocket: orderbook + trades (docs/TEMPLE_MM_ARCHITECTURE.md §4, §7).
 * Used for venue mid / basis vs Binance — not fair-value truth.
 */
import WebSocket from 'ws';

const PING_MS = 30_000;
const RECONNECT_MS = 3000;
const BOOK_STALE_MS = 10_000;

type BookState = {
  mid: number;
  receivedAt: number;
};

let ws: WebSocket | null = null;
let pingInterval: ReturnType<typeof setInterval> | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let streamUrl = '';
let apiKey = '';
let symbol = '';
let latestBook: BookState | null = null;
const orderbookListeners = new Set<(mid: number) => void>();
const tradeListeners = new Set<() => void>();

function clearReconnect(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function scheduleReconnect(): void {
  clearReconnect();
  if (!streamUrl || !apiKey || !symbol) return;
  reconnectTimer = setTimeout(() => connect(), RECONNECT_MS);
}

function stopPing(): void {
  if (pingInterval) {
    clearInterval(pingInterval);
    pingInterval = null;
  }
}

function startPing(): void {
  stopPing();
  pingInterval = setInterval(() => {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'ping' }));
    }
  }, PING_MS);
}

function bestFromLevel(level: unknown): number | null {
  if (level == null) return null;
  if (Array.isArray(level) && level.length > 0) {
    const n = Number(level[0]);
    return Number.isFinite(n) ? n : null;
  }
  if (typeof level === 'object' && level !== null && 'price' in level) {
    const n = Number((level as { price?: string }).price);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function midFromBookData(data: { bids?: unknown[]; asks?: unknown[] }): number | null {
  const bid = data.bids?.length ? bestFromLevel(data.bids[0]) : null;
  const ask = data.asks?.length ? bestFromLevel(data.asks[0]) : null;
  if (bid != null && ask != null && bid > 0 && ask > 0) {
    return (bid + ask) / 2;
  }
  return null;
}

function handleMessage(raw: WebSocket.RawData): void {
  try {
    const msg = JSON.parse(String(raw)) as Record<string, unknown>;
    const type = msg.type;

    if (type === 'data' && msg.channel === `orderbook:${symbol}` && msg.data && typeof msg.data === 'object') {
      const mid = midFromBookData(msg.data as { bids?: unknown[]; asks?: unknown[] });
      if (mid != null) {
        latestBook = { mid, receivedAt: Date.now() };
        for (const cb of orderbookListeners) cb(mid);
      }
      return;
    }

    if (type === 'data' && msg.channel === `trades:${symbol}`) {
      for (const cb of tradeListeners) cb();
      return;
    }

    if (type === 'auth_expired') {
      console.warn('[TempleWS] auth expired');
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'auth', api_key: apiKey }));
        ws.send(
          JSON.stringify({
            type: 'subscribe',
            channels: [`orderbook:${symbol}`, `trades:${symbol}`],
          })
        );
      }
      return;
    }

    if (type === 'error') {
      console.error('[TempleWS]', msg.code, msg.message);
    }
  } catch {
    /* ignore */
  }
}

function subscribe(): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(
    JSON.stringify({
      type: 'subscribe',
      channels: [`orderbook:${symbol}`, `trades:${symbol}`],
    })
  );
}

function connect(): void {
  if (!streamUrl || !apiKey || !symbol) return;

  if (ws) {
    try {
      ws.close();
    } catch {
      /* ignore */
    }
    ws = null;
  }

  const socket = new WebSocket(streamUrl, {
    headers: { 'X-API-Key': apiKey },
  });
  ws = socket;

  socket.on('open', () => {
    console.log('[TempleWS] connected');
    subscribe();
    startPing();
  });

  socket.on('message', handleMessage);

  socket.on('close', () => {
    stopPing();
    ws = null;
    scheduleReconnect();
  });

  socket.on('error', (err) => {
    console.error('[TempleWS] error:', err.message);
    socket.close();
  });
}

/**
 * Start Temple stream for `symbol` (e.g. CBTC/USDCx).
 */
export function startTempleWs(wsUrl: string, key: string, tradingSymbol: string): void {
  const u = wsUrl.trim();
  const k = key.trim();
  const s = tradingSymbol.trim();
  if (!u) throw new Error('TEMPLE_WS_URL is required');
  if (!k) throw new Error('TEMPLE_API_KEY is required');
  if (!s) throw new Error('symbol is required for Temple WS');

  streamUrl = u;
  apiKey = k;
  symbol = s;
  latestBook = null;
  clearReconnect();
  connect();
}

export function stopTempleWs(): void {
  clearReconnect();
  stopPing();
  streamUrl = '';
  apiKey = '';
  symbol = '';
  latestBook = null;
  if (ws) {
    try {
      ws.close();
    } catch {
      /* ignore */
    }
    ws = null;
  }
}

/** Latest Temple mid from WS orderbook, or null if disconnected/stale/no book yet. */
export function getTempleWsBookMid(): BookState | null {
  if (!latestBook) return null;
  if (Date.now() - latestBook.receivedAt > BOOK_STALE_MS) return null;
  return latestBook;
}

export function onTempleOrderbook(cb: (mid: number) => void): () => void {
  orderbookListeners.add(cb);
  return () => orderbookListeners.delete(cb);
}

export function onTempleTrade(cb: () => void): () => void {
  tradeListeners.add(cb);
  return () => tradeListeners.delete(cb);
}
