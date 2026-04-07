/**
 * Map wallet balances to inventory skew [-1, 1] for strategy.ts.
 */
import { getBalancesForParty } from '../services/trading.js';
import type { MmConfig } from './config.js';
import { clamp } from './strategy.js';

type BalanceRow = { asset?: string; available_balance?: string | number; total_balance?: string | number };

function balanceForAsset(rows: unknown, asset: string): number {
  if (!Array.isArray(rows)) return 0;
  const a = asset.toUpperCase();
  for (const r of rows as BalanceRow[]) {
    const id = String(r.asset ?? '').toUpperCase();
    if (id === a || (a === 'CC' && id === 'AMULET')) {
      const v = r.available_balance ?? r.total_balance ?? 0;
      return typeof v === 'number' ? v : Number(v) || 0;
    }
  }
  return 0;
}

/**
 * Rough inventory ratio: net base position vs cap. Spot MM is usually long-only; skew still widens/tightens quotes.
 */
export async function getInventoryRatio(partyId: string, cfg: MmConfig): Promise<number> {
  const raw = await getBalancesForParty(partyId);
  if (!Array.isArray(raw)) return 0;
  const base = balanceForAsset(raw, cfg.baseAsset);
  const max = cfg.maxPositionBase;
  if (max <= 0) return 0;
  return clamp(base / max, -1, 1);
}
