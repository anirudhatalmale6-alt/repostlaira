import { Router, Request, Response } from 'express';
import { z } from 'zod';
import https from 'https';
import http from 'http';
import { optionalAuth } from '../middleware/auth';
import { extractionRateLimit } from '../middleware/rateLimit';
import { extractMedia, getDirectUrl, ExtractionError } from '../services/extractor';
import { query } from '../db/pool';

const router = Router();

// --- Validation Schemas ---

const extractBodySchema = z.object({
  url: z.string().url('Must be a valid URL').max(2048),
});

const directUrlQuerySchema = z.object({
  url: z.string().url('Must be a valid URL').max(2048),
  format_id: z.string().min(1).max(100),
});

const downloadQuerySchema = directUrlQuerySchema.extend({
  title: z.string().max(200).optional(),
});

// --- POST /api/extract ---

router.post(
  '/',
  optionalAuth,
  extractionRateLimit,
  async (req: Request, res: Response): Promise<void> => {
    // Validate body
    const parsed = extractBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'Invalid request',
        details: parsed.error.issues.map((i) => i.message),
      });
      return;
    }

    const { url } = parsed.data;

    try {
      const result = await extractMedia(url);

      // Log to download history if user is authenticated
      if (req.user?.userId) {
        try {
          await query(
            `INSERT INTO download_history (user_id, platform, source_url, title, thumbnail_url)
             VALUES ($1, $2, $3, $4, $5)`,
            [req.user.userId, result.platform, url, result.title, result.thumbnail]
          );
        } catch (dbErr) {
          // Don't fail the extraction if history logging fails
          console.error('[extract] Failed to log history:', dbErr);
        }
      }

      res.json({
        success: true,
        data: result,
      });
    } catch (err) {
      if (err instanceof ExtractionError) {
        const statusMap: Record<string, number> = {
          INVALID_URL: 400,
          UNSUPPORTED: 400,
          NOT_FOUND: 404,
          PRIVATE_CONTENT: 403,
          TIMEOUT: 504,
          PARSE_ERROR: 502,
          EXTRACTION_FAILED: 502,
          SPAWN_ERROR: 500,
        };
        res.status(statusMap[err.code] || 500).json({
          success: false,
          error: err.message,
          code: err.code,
        });
      } else {
        console.error('[extract] Unexpected error:', err);
        res.status(500).json({
          success: false,
          error: 'An unexpected error occurred.',
          code: 'INTERNAL_ERROR',
        });
      }
    }
  }
);

// --- GET /api/extract/url ---

router.get(
  '/url',
  optionalAuth,
  extractionRateLimit,
  async (req: Request, res: Response): Promise<void> => {
    const parsed = directUrlQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({
        error: 'Invalid request',
        details: parsed.error.issues.map((i) => i.message),
      });
      return;
    }

    const { url, format_id } = parsed.data;

    try {
      const directUrl = await getDirectUrl(url, format_id);

      res.json({
        success: true,
        data: {
          url: directUrl,
        },
      });
    } catch (err) {
      if (err instanceof ExtractionError) {
        const statusMap: Record<string, number> = {
          INVALID_URL: 400,
          UNSUPPORTED: 400,
          NOT_FOUND: 404,
          TIMEOUT: 504,
          NO_URL: 404,
          EXTRACTION_FAILED: 502,
          SPAWN_ERROR: 500,
        };
        res.status(statusMap[err.code] || 500).json({
          success: false,
          error: err.message,
          code: err.code,
        });
      } else {
        console.error('[extract/url] Unexpected error:', err);
        res.status(500).json({
          success: false,
          error: 'An unexpected error occurred.',
          code: 'INTERNAL_ERROR',
        });
      }
    }
  }
);

// --- GET /api/extract/download ---

/**
 * Sanitize a string for use as a filename.
 * Removes anything that is not alphanumeric, dash, underscore, dot, or space,
 * then trims and collapses whitespace.
 */
function sanitizeFilename(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9\-_.\s]/g, '')
    .replace(/\s+/g, '_')
    .trim()
    .slice(0, 150);
}

router.get(
  '/download',
  optionalAuth,
  async (req: Request, res: Response): Promise<void> => {
    const parsed = downloadQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({
        error: 'Invalid request',
        details: parsed.error.issues.map((i) => i.message),
      });
      return;
    }

    const { url, format_id, title } = parsed.data;

    try {
      const directUrl = await getDirectUrl(url, format_id);

      // Build a safe filename
      let filename = 'repostlaira_video.mp4';
      if (title) {
        const sanitized = sanitizeFilename(title);
        if (sanitized.length > 0) {
          // Ensure it ends with a video extension
          filename = sanitized.endsWith('.mp4') ? sanitized : `${sanitized}.mp4`;
        }
      }

      // Determine which module to use based on protocol
      const fetchModule = directUrl.startsWith('https') ? https : http;

      const proxyReq = fetchModule.get(directUrl, (proxyRes) => {
        // If the upstream returned an error, forward it
        if (proxyRes.statusCode && proxyRes.statusCode >= 400) {
          res.status(proxyRes.statusCode).json({
            success: false,
            error: `Upstream returned status ${proxyRes.statusCode}`,
            code: 'PROXY_ERROR',
          });
          proxyRes.resume(); // drain the response
          return;
        }

        // Set response headers
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="${filename}"`
        );
        res.setHeader(
          'Content-Type',
          proxyRes.headers['content-type'] || 'video/mp4'
        );
        if (proxyRes.headers['content-length']) {
          res.setHeader('Content-Length', proxyRes.headers['content-length']);
        }

        // Pipe the upstream response to the client
        proxyRes.pipe(res);

        proxyRes.on('error', (pipeErr) => {
          console.error('[extract/download] Proxy response error:', pipeErr);
          if (!res.headersSent) {
            res.status(502).json({
              success: false,
              error: 'Stream interrupted while downloading.',
              code: 'PROXY_STREAM_ERROR',
            });
          } else {
            res.destroy();
          }
        });
      });

      proxyReq.on('error', (reqErr) => {
        console.error('[extract/download] Proxy request error:', reqErr);
        if (!res.headersSent) {
          res.status(502).json({
            success: false,
            error: 'Failed to connect to upstream server.',
            code: 'PROXY_CONNECT_ERROR',
          });
        }
      });

      // If the client aborts, clean up the proxy request
      req.on('close', () => {
        proxyReq.destroy();
      });
    } catch (err) {
      if (err instanceof ExtractionError) {
        const statusMap: Record<string, number> = {
          INVALID_URL: 400,
          UNSUPPORTED: 400,
          NOT_FOUND: 404,
          TIMEOUT: 504,
          NO_URL: 404,
          EXTRACTION_FAILED: 502,
          SPAWN_ERROR: 500,
        };
        res.status(statusMap[err.code] || 500).json({
          success: false,
          error: err.message,
          code: err.code,
        });
      } else {
        console.error('[extract/download] Unexpected error:', err);
        res.status(500).json({
          success: false,
          error: 'An unexpected error occurred.',
          code: 'INTERNAL_ERROR',
        });
      }
    }
  }
);

export default router;
