import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { query } from '../db/pool';

export interface JwtPayload {
  userId: string;
  email: string;
  tier: 'free' | 'premium';
}

// Extend Express Request to include user
declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

/**
 * Optional auth middleware - sets req.user if a valid token is present,
 * but does NOT reject requests without a token.
 */
export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next();
  }

  const token = authHeader.split(' ')[1];
  if (!token) {
    return next();
  }

  try {
    const decoded = jwt.verify(token, config.jwt.secret) as JwtPayload;
    req.user = decoded;
  } catch {
    // Invalid token - proceed as unauthenticated
  }

  next();
}

/**
 * Required auth middleware - rejects requests without a valid token.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const token = authHeader.split(' ')[1];
  if (!token) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  try {
    const decoded = jwt.verify(token, config.jwt.secret) as JwtPayload;
    req.user = decoded;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

/**
 * Generate a JWT token for a user.
 */
export function generateToken(payload: JwtPayload): string {
  return jwt.sign(payload, config.jwt.secret, {
    expiresIn: config.jwt.expiresIn,
  } as jwt.SignOptions);
}

/**
 * Refresh user tier from the database (checks subscription status).
 */
export async function getUserTier(userId: string): Promise<'free' | 'premium'> {
  // Check if user has an active subscription
  const subResult = await query(
    `SELECT id FROM subscriptions WHERE user_id = $1 AND expires_at > NOW() LIMIT 1`,
    [userId]
  );

  if (subResult.rows.length > 0) {
    // Ensure user tier is updated
    await query(`UPDATE users SET tier = 'premium' WHERE id = $1 AND tier != 'premium'`, [userId]);
    return 'premium';
  }

  // Check user table directly (might have been set manually)
  const userResult = await query(`SELECT tier FROM users WHERE id = $1`, [userId]);
  if (userResult.rows.length > 0) {
    return userResult.rows[0].tier;
  }

  return 'free';
}
