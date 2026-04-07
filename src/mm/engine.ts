/**
 * One MM tick: fair price → desired quotes → reconcile with active orders.
 */
import {
  placeLimitOrder,
  listActiveOrders,
  cancelOrderById,
  cancelAllOrders,
} from '../services/trading.js';
import { getTempleWsBookMid } from '../feeds/temple-ws.js';
import { getFairMid } from './referencePrice.js';
import { getInventoryRatio } from './inventory.js';
import { computeDesiredOrders, type DesiredOrder } from './strategy.js';
import { evaluateBasis } from './safety.js';
import type { MmConfig } from './config.js';

type ActiveRow = {
  order_id?: string;
  symbol?: string;
  side?: string;
  price?: string;
  quantity?: string;
};

function normalizeActiveList(raw: unknown): ActiveRow[] {
  if (raw && typeof raw === 'object' && 'error' in raw && (raw as { error?: boolean }).error) {
    return [];
  }
  if (Array.isArray(raw)) return raw as ActiveRow[];
  if (raw && typeof raw === 'object') {
    const o = raw as Record<string, unknown>;
    if (Array.isArray(o.orders)) return o.orders as ActiveRow[];
    if (Array.isArray(o.data)) return o.data as ActiveRow[];
  }
  return [];
}

function normSide(s: string | undefined): 'Buy' | 'Sell' | null {
  if (!s) return null;
  const u = s.toLowerCase();
  if (u === 'buy' || u === 'bid') return 'Buy';
  if (u === 'sell' || u === 'ask') return 'Sell';
  return null;
}

function pricesMatch(a: number, b: number, mid: number, matchBps: number): boolean {
  const tol = (matchBps / 10000) * Math.max(mid, 1e-12);
  return Math.abs(a - b) <= tol;
}

function desiredKey(d: DesiredOrder): string {
  return `${d.side}:${d.price}:${d.level}`;
}

export type TickResult = {
  mid: number;
  source: string;
  invRatio: number;
  desired: DesiredOrder[];
  canceled: string[];
  placed: number;
  dryRun: boolean;
  error?: string;
  /** Absolute basis in bps when Temple book + Binance both valid */
  basisBps?: number | null;
  safetyState?: string;
  spreadScale?: number;
};

export async function runOneMmTick(partyId: string, cfg: MmConfig): Promise<TickResult> {
  const fair = await getFairMid(cfg.symbol, cfg.orderBookLevels);
  if (fair.mid === null) {
    return {
      mid: 0,
      source: '',
      invRatio: 0,
      desired: [],
      canceled: [],
      placed: 0,
      dryRun: cfg.dryRun,
      error: fair.error,
    };
  }
  const mid = fair.mid;

  const templeSnap = getTempleWsBookMid();
  const templeMid = templeSnap?.mid ?? null;
  const basis = evaluateBasis(mid, templeMid, cfg);

  if (basis.state === 'halt') {
    if (!cfg.dryRun && cfg.basisHaltCancelAll) {
      const cr = await cancelAllOrders(cfg.symbol);
      if (cr && typeof cr === 'object' && 'error' in cr && (cr as { error?: boolean }).error) {
        console.error('[mm] cancel-all on basis halt failed', cr);
      }
    }
    return {
      mid,
      source: fair.source,
      invRatio: 0,
      desired: [],
      canceled: [],
      placed: 0,
      dryRun: cfg.dryRun,
      error: basis.message,
      basisBps: basis.basisBps,
      safetyState: basis.state,
    };
  }

  const spreadScale = basis.spreadScale;
  const quoteCfg: MmConfig = {
    ...cfg,
    halfSpreadBps: cfg.halfSpreadBps * spreadScale,
  };

  const invRatio = await getInventoryRatio(partyId, cfg);
  const desired = computeDesiredOrders(mid, invRatio, quoteCfg);

  const activeRaw = await listActiveOrders({ symbol: cfg.symbol, limit: cfg.activeOrderLimit });
  const active = normalizeActiveList(activeRaw);

  const canceled: string[] = [];

  for (const row of active) {
    const oid = row.order_id;
    if (!oid) continue;

    const side = normSide(row.side);
    const price = Number(row.price);
    if (side == null || !Number.isFinite(price)) continue;

    let keep = false;
    for (const d of desired) {
      if (d.side === side && pricesMatch(d.price, price, mid, cfg.priceMatchBps)) {
        keep = true;
        break;
      }
    }
    if (keep) continue;

    if (cfg.dryRun) {
      canceled.push(`dry-run:${oid}`);
      continue;
    }
    const cr = await cancelOrderById(oid);
    if (cr && typeof cr === 'object' && 'error' in cr && (cr as { error?: boolean }).error) {
      console.error('[mm] cancel failed', oid, cr);
    } else {
      canceled.push(oid);
    }
  }

  const refreshedRaw = cfg.dryRun ? activeRaw : await listActiveOrders({ symbol: cfg.symbol, limit: cfg.activeOrderLimit });
  const refreshed = cfg.dryRun ? active : normalizeActiveList(refreshedRaw);

  let placed = 0;
  for (const d of desired) {
    let has = false;
    for (const row of refreshed) {
      const side = normSide(row.side);
      const price = Number(row.price);
      if (side !== d.side || !Number.isFinite(price)) continue;
      if (pricesMatch(d.price, price, mid, cfg.priceMatchBps)) {
        has = true;
        break;
      }
    }
    if (has) continue;

    if (cfg.dryRun) {
      placed += 1;
      continue;
    }
    const result = await placeLimitOrder({
      symbol: cfg.symbol,
      side: d.side,
      quantity: d.quantity,
      price: d.price,
      orderType: 'limit',
    });
    if (result && typeof result === 'object' && 'error' in result && (result as { error?: boolean }).error) {
      console.error('[mm] place failed', desiredKey(d), result);
    } else {
      placed += 1;
    }
  }

  return {
    mid,
    source: fair.source,
    invRatio,
    desired,
    canceled,
    placed,
    dryRun: cfg.dryRun,
    basisBps: basis.basisBps,
    safetyState: basis.state,
    spreadScale,
  };
}
