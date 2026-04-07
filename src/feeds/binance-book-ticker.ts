/**
 * Outbound Binance WebSocket: btcusdt@bookTicker — price truth for fair value (see docs/STRATEGY.md).
 */
import WebSocket from 'ws';

export type BinanceBookTickerSnapshot = {
  bestBid: string;
  bestAsk: string;
  mid: number;
  receivedAt: number;
};

const STALE_MS = 5000;
const RECONNECT_MS = 3000;

let ws: WebSocket | null = null;
let streamUrl = '';
let latest: BinanceBookTickerSnapshot | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<(snap: BinanceBookTickerSnapshot) => void>();

function clearReconnect(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function scheduleReconnect(): void {
  clearReconnect();
  if (!streamUrl) return;
  reconnectTimer = setTimeout(() => connect(), RECONNECT_MS);
}

function connect(): void {
  if (!streamUrl) return;
  if (ws) {
    try {
      ws.close();
    } catch {
      /* ignore */
    }
    ws = null;
  }

  const socket = new WebSocket(streamUrl);
  ws = socket;

  socket.on('message', (raw: WebSocket.RawData) => {
    try {
      const msg = JSON.parse(String(raw)) as {
        b?: string;
        a?: string;
      };
      const bid = msg.b;
      const ask = msg.a;
      if (bid == null || ask == null) return;
      const bn = Number(bid);
      const an = Number(ask);
      if (!Number.isFinite(bn) || !Number.isFinite(an)) return;
      latest = {
        bestBid: bid,
        bestAsk: ask,
        mid: (bn + an) / 2,
        receivedAt: Date.now(),
      };
      for (const cb of listeners) cb(latest);
    } catch {
      /* ignore bad frames */
    }
  });

  socket.on('close', () => {
    ws = null;
    scheduleReconnect();
  });

  socket.on('error', () => {
    socket.close();
  });
}

/**
 * Start (or restart) the Binance bookTicker client. Required for HTTP ticker and MM fair price.
 */
export function startBinanceBookTicker(wsUrl: string): void {
  const u = wsUrl.trim();
  if (!u) {
    throw new Error('BINANCE_WS_URL is required');
  }
  streamUrl = u;
  clearReconnect();
  connect();
}

export function stopBinanceBookTicker(): void {
  clearReconnect();
  streamUrl = '';
  latest = null;
  if (ws) {
    try {
      ws.close();
    } catch {
      /* ignore */
    }
    ws = null;
  }
}

export function getBinanceBookTickerSnapshot(): BinanceBookTickerSnapshot | null {
  if (!latest) return null;
  if (Date.now() - latest.receivedAt > STALE_MS) return null;
  return latest;
}

export function onBinanceBookTicker(cb: (snap: BinanceBookTickerSnapshot) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
