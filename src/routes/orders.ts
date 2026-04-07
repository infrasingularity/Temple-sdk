import { Request, Response } from 'express';
import { getPartyId } from '../init.js';
import {
  placeLimitOrder,
  listActiveOrders,
  listPastOrders,
  cancelOrderById,
  cancelAllOrders,
} from '../services/trading.js';

/**
 * POST /orders
 * Body: { symbol, side, quantity, pricePerUnit, expiration?, orderType? }
 * Temple V2: creates REST limit order via /v1/orders/create.
 */
export async function postOrder(req: Request, res: Response): Promise<void> {
  try {
    getPartyId();
    const { symbol, side, quantity, pricePerUnit, expiration, orderType } = req.body ?? {};
    if (!symbol || !side || quantity == null || pricePerUnit == null) {
      res.status(400).json({
        error: true,
        message: 'Missing required fields: symbol, side, quantity, pricePerUnit',
      });
      return;
    }
    const result = await placeLimitOrder({
      symbol: symbol as string,
      side: side as string,
      quantity: Number(quantity),
      price: Number(pricePerUnit),
      orderType: (orderType as string) || 'limit',
      expiresAt: expiration as string | undefined,
    });
    if (result && (result as any).error) {
      res.status(400).json(result);
      return;
    }
    res.json({ success: true, result });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: true, message });
  }
}

/**
 * GET /orders?symbol=Amulet/USDCx&limit=50
 * Active orders from Temple V2 REST (/v1/orders/active).
 */
export async function getOrders(req: Request, res: Response): Promise<void> {
  try {
    const partyId = getPartyId();
    const symbol = typeof req.query.symbol === 'string' ? req.query.symbol : undefined;
    const limit = req.query.limit != null ? Number(req.query.limit) : undefined;
    const orders = await listActiveOrders({
      ...(symbol ? { symbol } : {}),
      ...(limit != null && !Number.isNaN(limit) ? { limit } : {}),
    });
    if (orders && (orders as any).error) {
      res.status(400).json(orders);
      return;
    }
    res.json({ success: true, partyId, orders: orders ?? [] });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: true, message });
  }
}

/**
 * GET /orders/past?symbol=CBTC/USDCx&limit=50&status=filled
 * Past orders from Temple V2 REST (/api/trading/orders/past).
 */
export async function getPastOrders(req: Request, res: Response): Promise<void> {
  try {
    getPartyId();
    const symbol = typeof req.query.symbol === 'string' ? req.query.symbol : undefined;
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const limit = req.query.limit != null ? Number(req.query.limit) : undefined;
    const orders = await listPastOrders({
      ...(symbol ? { symbol } : {}),
      ...(status ? { status } : {}),
      ...(limit != null && !Number.isNaN(limit) ? { limit } : {}),
    });
    if (orders && (orders as any).error) {
      res.status(400).json(orders);
      return;
    }
    res.json({ success: true, orders: orders ?? [] });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: true, message });
  }
}

/**
 * DELETE /orders/:orderId
 * Cancels an order via Temple REST API.
 */
export async function deleteOrder(req: Request, res: Response): Promise<void> {
  try {
    const orderId = req.params.orderId;
    if (!orderId) {
      res.status(400).json({ error: true, message: 'Missing orderId' });
      return;
    }
    const result = await cancelOrderById(orderId);
    if (result && (result as any).error) {
      res.status(400).json(result);
      return;
    }
    res.json({ success: true, result });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: true, message });
  }
}

/**
 * POST /orders/cancel-all
 * Body: { symbol? }
 */
export async function postCancelAllOrders(req: Request, res: Response): Promise<void> {
  try {
    getPartyId();
    const symbol = typeof req.body?.symbol === 'string' ? req.body.symbol : undefined;
    const result = await cancelAllOrders(symbol);
    if (result && (result as any).error) {
      res.status(400).json(result);
      return;
    }
    res.json({ success: true, result });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: true, message });
  }
}
