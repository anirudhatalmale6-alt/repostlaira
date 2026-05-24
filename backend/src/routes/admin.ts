import { Router, Request, Response } from 'express';
import { query } from '../db/pool';
import { config } from '../config';
import fs from 'fs';
import path from 'path';

const router = Router();

function requireAdmin(req: Request, res: Response, next: Function): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Admin authentication required' });
    return;
  }
  const token = authHeader.split(' ')[1];
  if (token !== config.admin.password) {
    res.status(403).json({ error: 'Invalid admin credentials' });
    return;
  }
  next();
}

router.post('/login', (req: Request, res: Response) => {
  const { password } = req.body;
  if (password === config.admin.password) {
    res.json({ success: true, token: config.admin.password });
  } else {
    res.status(401).json({ error: 'Invalid password' });
  }
});

router.get('/stats', requireAdmin, async (_req: Request, res: Response) => {
  try {
    const [users, downloads, subs, todayDownloads, weekDownloads] = await Promise.all([
      query('SELECT COUNT(*) as count FROM users'),
      query('SELECT COUNT(*) as count FROM download_history'),
      query("SELECT COUNT(*) as count FROM subscriptions WHERE expires_at > NOW()"),
      query("SELECT COUNT(*) as count FROM download_history WHERE downloaded_at > NOW() - INTERVAL '24 hours'"),
      query("SELECT COUNT(*) as count FROM download_history WHERE downloaded_at > NOW() - INTERVAL '7 days'"),
    ]);

    const platformStats = await query(
      `SELECT platform, COUNT(*) as count FROM download_history GROUP BY platform ORDER BY count DESC`
    );

    let autoRepostStatus: any = { running: false };
    try {
      const rateLimitFile = '/opt/repostlaira/auto-repost/rate_limit_until.txt';
      if (fs.existsSync(rateLimitFile)) {
        const until = fs.readFileSync(rateLimitFile, 'utf-8').trim();
        autoRepostStatus.rateLimitedUntil = until;
      }
      const logDir = '/opt/repostlaira/auto-repost/logs';
      if (fs.existsSync(logDir)) {
        const logFiles = fs.readdirSync(logDir).filter(f => f.endsWith('.log')).sort().reverse();
        if (logFiles.length > 0) {
          autoRepostStatus.lastRun = logFiles[0].replace('auto_repost_', '').replace('.log', '');
          autoRepostStatus.totalRuns = logFiles.length;
        }
      }
      const postLog = '/opt/repostlaira/auto-repost/post_log.json';
      if (fs.existsSync(postLog)) {
        const posts = JSON.parse(fs.readFileSync(postLog, 'utf-8'));
        autoRepostStatus.totalPosts = posts.length;
        autoRepostStatus.successfulPosts = posts.filter((p: any) => p.success).length;
      }
    } catch {}

    res.json({
      users: {
        total: parseInt(users.rows[0].count),
      },
      downloads: {
        total: parseInt(downloads.rows[0].count),
        today: parseInt(todayDownloads.rows[0].count),
        week: parseInt(weekDownloads.rows[0].count),
        byPlatform: platformStats.rows.map((r: any) => ({ platform: r.platform, count: parseInt(r.count) })),
      },
      subscriptions: {
        active: parseInt(subs.rows[0].count),
      },
      autoRepost: autoRepostStatus,
    });
  } catch (err) {
    console.error('[admin] Stats error:', err);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

router.get('/users', requireAdmin, async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const offset = (page - 1) * limit;

    const [usersResult, countResult] = await Promise.all([
      query(
        `SELECT u.id, u.email, u.tier, u.created_at,
          (SELECT COUNT(*) FROM download_history dh WHERE dh.user_id = u.id) as download_count,
          (SELECT MAX(downloaded_at) FROM download_history dh WHERE dh.user_id = u.id) as last_download
        FROM users u ORDER BY u.created_at DESC LIMIT $1 OFFSET $2`,
        [limit, offset]
      ),
      query('SELECT COUNT(*) as count FROM users'),
    ]);

    res.json({
      users: usersResult.rows,
      total: parseInt(countResult.rows[0].count),
      page,
      pages: Math.ceil(parseInt(countResult.rows[0].count) / limit),
    });
  } catch (err) {
    console.error('[admin] Users error:', err);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

router.get('/downloads', requireAdmin, async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const offset = (page - 1) * limit;

    const [downloadsResult, countResult] = await Promise.all([
      query(
        `SELECT dh.id, dh.platform, dh.source_url, dh.title, dh.thumbnail_url, dh.downloaded_at,
          u.email as user_email
        FROM download_history dh
        LEFT JOIN users u ON dh.user_id = u.id
        ORDER BY dh.downloaded_at DESC LIMIT $1 OFFSET $2`,
        [limit, offset]
      ),
      query('SELECT COUNT(*) as count FROM download_history'),
    ]);

    res.json({
      downloads: downloadsResult.rows,
      total: parseInt(countResult.rows[0].count),
      page,
      pages: Math.ceil(parseInt(countResult.rows[0].count) / limit),
    });
  } catch (err) {
    console.error('[admin] Downloads error:', err);
    res.status(500).json({ error: 'Failed to fetch downloads' });
  }
});

router.get('/auto-repost/logs', requireAdmin, async (_req: Request, res: Response) => {
  try {
    const logDir = '/opt/repostlaira/auto-repost/logs';
    if (!fs.existsSync(logDir)) {
      res.json({ logs: [] });
      return;
    }

    const logFiles = fs.readdirSync(logDir).filter(f => f.endsWith('.log')).sort().reverse().slice(0, 10);
    const logs = logFiles.map(filename => {
      const content = fs.readFileSync(path.join(logDir, filename), 'utf-8');
      const lines = content.split('\n').filter(l => l.trim());
      return {
        filename,
        date: filename.replace('auto_repost_', '').replace('cron_', '').replace('cron_retry_', '').replace('.log', ''),
        lines: lines.length,
        lastLine: lines[lines.length - 1] || '',
        hasErrors: lines.some(l => l.includes('[ERROR]')),
        summary: lines.filter(l => l.includes('PIPELINE COMPLETE') || l.includes('Posting complete') || l.includes('Rate-limited')).join(' | ') || 'In progress or no summary',
      };
    });

    res.json({ logs });
  } catch (err) {
    console.error('[admin] Logs error:', err);
    res.status(500).json({ error: 'Failed to fetch logs' });
  }
});

router.delete('/users/:id', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await query('DELETE FROM download_history WHERE user_id = $1', [id]);
    await query('DELETE FROM subscriptions WHERE user_id = $1', [id]);
    const result = await query('DELETE FROM users WHERE id = $1 RETURNING id', [id]);
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    res.json({ success: true });
  } catch (err) {
    console.error('[admin] Delete user error:', err);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

// ========== ADS MANAGEMENT ==========

// List all ads (admin)
router.get('/ads', requireAdmin, async (req: Request, res: Response) => {
  try {
    const result = await query(
      'SELECT * FROM ads ORDER BY created_at DESC'
    );
    res.json({ ads: result.rows });
  } catch (err) {
    console.error('[admin] Ads list error:', err);
    res.status(500).json({ error: 'Failed to fetch ads' });
  }
});

// Create ad (admin)
router.post('/ads', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { title, image_url, target_url, placement, status, start_date, end_date } = req.body;
    if (!title || !placement) {
      res.status(400).json({ error: 'Title and placement are required' });
      return;
    }
    const validPlacements = ['hero_top', 'between_results', 'footer', 'popup'];
    if (!validPlacements.includes(placement)) {
      res.status(400).json({ error: 'Invalid placement' });
      return;
    }
    const result = await query(
      `INSERT INTO ads (title, image_url, target_url, placement, status, start_date, end_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [title, image_url || null, target_url || null, placement, status || 'active', start_date || null, end_date || null]
    );
    res.json({ success: true, ad: result.rows[0] });
  } catch (err) {
    console.error('[admin] Create ad error:', err);
    res.status(500).json({ error: 'Failed to create ad' });
  }
});

// Update ad (admin)
router.put('/ads/:id', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { title, image_url, target_url, placement, status, start_date, end_date } = req.body;
    if (!title || !placement) {
      res.status(400).json({ error: 'Title and placement are required' });
      return;
    }
    const validPlacements = ['hero_top', 'between_results', 'footer', 'popup'];
    if (!validPlacements.includes(placement)) {
      res.status(400).json({ error: 'Invalid placement' });
      return;
    }
    const result = await query(
      `UPDATE ads SET title=$1, image_url=$2, target_url=$3, placement=$4, status=$5, start_date=$6, end_date=$7
       WHERE id=$8 RETURNING *`,
      [title, image_url || null, target_url || null, placement, status || 'active', start_date || null, end_date || null, id]
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Ad not found' });
      return;
    }
    res.json({ success: true, ad: result.rows[0] });
  } catch (err) {
    console.error('[admin] Update ad error:', err);
    res.status(500).json({ error: 'Failed to update ad' });
  }
});

// Delete ad (admin)
router.delete('/ads/:id', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const result = await query('DELETE FROM ads WHERE id=$1 RETURNING id', [id]);
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Ad not found' });
      return;
    }
    res.json({ success: true });
  } catch (err) {
    console.error('[admin] Delete ad error:', err);
    res.status(500).json({ error: 'Failed to delete ad' });
  }
});

// ========== PUBLIC ADS ENDPOINTS (no auth) ==========
export const adsPublicRouter = Router();

// Get active ads by placement (public)
adsPublicRouter.get('/active', async (req: Request, res: Response) => {
  try {
    const placement = req.query.placement as string;
    let sql = `SELECT id, title, image_url, target_url, placement
               FROM ads
               WHERE status = 'active'
               AND (start_date IS NULL OR start_date <= CURRENT_DATE)
               AND (end_date IS NULL OR end_date >= CURRENT_DATE)`;
    const params: any[] = [];
    if (placement) {
      params.push(placement);
      sql += ` AND placement = $${params.length}`;
    }
    sql += ' ORDER BY created_at DESC';
    const result = await query(sql, params);
    res.json({ ads: result.rows });
  } catch (err) {
    console.error('[ads] Active ads error:', err);
    res.status(500).json({ error: 'Failed to fetch ads' });
  }
});

// Track ad click (public)
adsPublicRouter.post('/:id/click', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await query('UPDATE ads SET clicks = clicks + 1 WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (err) {
    console.error('[ads] Click track error:', err);
    res.status(500).json({ error: 'Failed to track click' });
  }
});

// Track ad impression (public)
adsPublicRouter.post('/:id/impression', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await query('UPDATE ads SET impressions = impressions + 1 WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (err) {
    console.error('[ads] Impression track error:', err);
    res.status(500).json({ error: 'Failed to track impression' });
  }
});

export default router;
