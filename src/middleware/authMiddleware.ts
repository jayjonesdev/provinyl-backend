import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';

// Placeholder — full JWT validation implemented in Phase 2
export const requireAuth = (
  _req: AuthRequest,
  res: Response,
  _next: NextFunction,
): void => {
  res.status(501).json({ error: 'Auth not yet implemented' });
};
