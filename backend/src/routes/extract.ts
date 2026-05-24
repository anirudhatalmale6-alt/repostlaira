import { Router, Request, Response } from 'express';
import { z } from 'zod';
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

export default router;
