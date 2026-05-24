import rateLimit from 'express-rate-limit';
import { Request, Response } from 'express';
import { config } from '../config';

/**
 * Extraction rate limiter:
 * - Free users: FREE_TIER_LIMIT extractions per hour (default 10)
 * - Premium users: unlimited
 * - Unauthenticated users: treated as free tier
 */
export const extractionRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: (req: Request, _res: Response): number => {
    // Premium users get unlimited (very high number)
    if (req.user?.tier === 'premium') {
      return 999999;
    }
    return config.rateLimit.freeTierLimit;
  },
  keyGenerator: (req: Request): string => {
    // Use user ID if authenticated, otherwise IP
    if (req.user?.userId) {
      return `user:${req.user.userId}`;
    }
    return `ip:${req.ip}`;
  },
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Rate limit exceeded',
    message: `Free tier is limited to ${config.rateLimit.freeTierLimit} extractions per hour. Upgrade to premium for unlimited access.`,
  },
});

/**
 * General API rate limiter (prevents abuse on all endpoints).
 */
export const generalRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req: Request) => {
    const path = req.path;
    return path.startsWith('/app') || path.startsWith('/admin') || path.startsWith('/public');
  },
  message: {
    error: 'Too many requests, please try again later.',
  },
});
