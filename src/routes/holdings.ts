import { Request, Response } from 'express';
import { getPartyId } from '../init.js';
import { getBalancesForParty } from '../services/trading.js';

/**
 * GET /holdings
 * Returns CC + USDCx balances (available, locked, total) for the Loop wallet party.
 */
export async function getHoldings(_req: Request, res: Response): Promise<void> {
  try {
    const partyId = getPartyId();
    const balances = await getBalancesForParty(partyId);
    res.json({ success: true, partyId, balances: balances ?? [] });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: true, message });
  }
}
