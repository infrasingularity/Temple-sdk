import { Request, Response } from 'express';
import {
  getSupportedTradingPairs,
  getInstrumentCatalog,
} from '@temple-digital-group/temple-canton-js';

/**
 * GET /instruments
 * Returns supported trading pairs and instrument catalog (no auth to validator).
 */
export async function getInstruments(_req: Request, res: Response): Promise<void> {
  try {
    const pairs = getSupportedTradingPairs();
    const catalog = getInstrumentCatalog();
    res.json({
      success: true,
      supportedTradingPairs: pairs ?? [],
      instrumentCatalog: catalog ?? {},
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: true, message });
  }
}
