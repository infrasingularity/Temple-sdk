import { Request, Response } from 'express';
import {
  mergeAmuletHoldingsForParty,
  mergeUtilityHoldingsForParty,
} from '@temple-digital-group/temple-canton-js';
import { loop } from '@fivenorth/loop-sdk/server';
import { getPartyId } from '../init.js';

/**
 * POST /holdings/merge
 * Merges Amulet (CC) and USDCx holdings for the Loop wallet party.
 * Uses WALLET_ADAPTER to submit merge commands.
 */
export async function mergeHoldings(_req: Request, res: Response): Promise<void> {
  try {
    const partyId = getPartyId();
    const maxUtxos = 5;

    // Merge utility (USDCx) — return command and submit via loop
    const utilityCmd = await mergeUtilityHoldingsForParty(
      partyId,
      'USDCx',
      true,
      undefined as any,
      maxUtxos
    );
    const results: { amulet?: unknown; utility?: unknown } = {};

    if (utilityCmd && !(utilityCmd as any).error) {
      const utilityResult = await loop.executeTransaction(utilityCmd as any);
      results.utility = utilityResult;
    }

    // Merge Amulet (CC) — may require disclosures; try with empty array first
    const amuletCmd = await mergeAmuletHoldingsForParty(
      partyId,
      true,
      undefined as any,
      maxUtxos,
      []
    );
    if (amuletCmd && !(amuletCmd as any).error) {
      const amuletResult = await loop.executeTransaction(amuletCmd as any);
      results.amulet = amuletResult;
    }

    res.json({ success: true, partyId, results });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: true, message });
  }
}
