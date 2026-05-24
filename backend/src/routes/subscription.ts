import { Router, Request, Response } from 'express';
import { requireAuth, getUserTier } from '../middleware/auth';
import { query } from '../db/pool';

const router = Router();

// --- GET /api/subscription/status ---

router.get('/status', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.userId;

    // Get current tier (checks subscriptions table for active subs)
    const tier = await getUserTier(userId);

    // Get active subscription details if any
    const subResult = await query(
      `SELECT id, store, expires_at, created_at
       FROM subscriptions
       WHERE user_id = $1 AND expires_at > NOW()
       ORDER BY expires_at DESC
       LIMIT 1`,
      [userId]
    );

    const activeSubscription = subResult.rows.length > 0 ? subResult.rows[0] : null;

    // Get usage stats for current hour (for free tier info)
    const historyResult = await query(
      `SELECT COUNT(*) as extraction_count
       FROM download_history
       WHERE user_id = $1 AND downloaded_at > NOW() - INTERVAL '1 hour'`,
      [userId]
    );

    const extractionsThisHour = parseInt(historyResult.rows[0]?.extraction_count || '0', 10);

    res.json({
      success: true,
      data: {
        tier,
        subscription: activeSubscription
          ? {
              id: activeSubscription.id,
              store: activeSubscription.store,
              expires_at: activeSubscription.expires_at,
              created_at: activeSubscription.created_at,
            }
          : null,
        usage: {
          extractions_this_hour: extractionsThisHour,
          limit_per_hour: tier === 'premium' ? null : 10,
        },
      },
    });
  } catch (err) {
    console.error('[subscription/status] Error:', err);
    res.status(500).json({ error: 'Failed to retrieve subscription status.' });
  }
});

export default router;
