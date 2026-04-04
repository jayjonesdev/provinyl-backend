import { Response, NextFunction } from 'express';
import jwtService from '../auth/jwtService';
import { User } from '../models/User';
import { AuthRequest } from '../types';

export async function requireAuth(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      res.status(401).json({ error: 'Authorization header required' });
      return;
    }

    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
      res.status(401).json({ error: 'Invalid authorization header format' });
      return;
    }

    const token = parts[1]!;
    const claims = jwtService.validateToken(token);

    if (claims.token_type !== 'access') {
      res.status(401).json({ error: 'Invalid token type' });
      return;
    }

    const user = await User.findById(claims.user_id);
    if (!user || !user.isActive) {
      res.status(401).json({ error: 'User not found' });
      return;
    }

    req.userId = claims.user_id;
    req.user = user;

    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}
