import { Request, Response, NextFunction } from 'express';

/**
 * Require Authorization: Bearer <SERVER_API_KEY>.
 * Rejects with 401 if missing or wrong.
 */
export function requireApiKey(req: Request, res: Response, next: NextFunction): void {
  const key = process.env.SERVER_API_KEY;
  if (!key) {
    res.status(500).json({ error: true, message: 'Server not configured with SERVER_API_KEY' });
    return;
  }

  const auth = req.headers.authorization;
  const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
  if (token !== key) {
    res.status(401).json({ error: true, message: 'Unauthorized: invalid or missing API key' });
    return;
  }
  next();
}
