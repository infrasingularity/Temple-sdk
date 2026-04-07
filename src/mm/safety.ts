/**
 * Basis / venue sanity vs Binance anchor (docs/TEMPLE_MM_ARCHITECTURE.md §9).
 */
import type { MmConfig } from './config.js';

export type BasisEvaluation = {
  basisBps: number | null;
  state: 'ok' | 'widen' | 'halt' | 'skip';
  /** Multiplier applied to halfSpreadBps (1 = unchanged) */
  spreadScale: number;
  message?: string;
};

/**
 * Compare Temple venue mid to Binance fair mid.
 * - skip: no Temple book yet — do not widen/halt on basis.
 * - ok: within warn band.
 * - widen: between warn and halt — scale spreads up linearly.
 * - halt: at or above halt band.
 */
export function evaluateBasis(
  binanceMid: number,
  templeMid: number | null,
  cfg: MmConfig
): BasisEvaluation {
  if (!Number.isFinite(binanceMid) || binanceMid <= 0) {
    return { basisBps: null, state: 'skip', spreadScale: 1, message: 'invalid binance mid' };
  }
  if (templeMid == null || !Number.isFinite(templeMid) || templeMid <= 0) {
    return { basisBps: null, state: 'skip', spreadScale: 1 };
  }

  const basisBps = (Math.abs(templeMid - binanceMid) / binanceMid) * 10000;

  if (basisBps >= cfg.basisHaltBps) {
    return {
      basisBps,
      state: 'halt',
      spreadScale: 1,
      message: `basis halt: ${basisBps.toFixed(1)} bps (>= ${cfg.basisHaltBps})`,
    };
  }

  if (basisBps <= cfg.basisWarnBps) {
    return { basisBps, state: 'ok', spreadScale: 1 };
  }

  const span = Math.max(1e-9, cfg.basisHaltBps - cfg.basisWarnBps);
  const t = (basisBps - cfg.basisWarnBps) / span;
  const spreadScale = 1 + t * (cfg.basisWidenMaxScale - 1);

  return {
    basisBps,
    state: 'widen',
    spreadScale,
    message: `basis widen: ${basisBps.toFixed(1)} bps, spreadScale=${spreadScale.toFixed(2)}`,
  };
}
