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

export default router;
