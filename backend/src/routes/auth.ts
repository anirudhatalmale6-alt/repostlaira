import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { query } from '../db/pool';
import { generateToken, JwtPayload } from '../middleware/auth';

const router = Router();

// --- Validation Schemas ---

const registerSchema = z.object({
  email: z.string().email('Invalid email address').max(255),
  password: z.string().min(8, 'Password must be at least 8 characters').max(128),
});

const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

// --- POST /api/auth/register ---

router.post('/register', async (req: Request, res: Response): Promise<void> => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'Invalid request',
      details: parsed.error.issues.map((i) => i.message),
    });
    return;
  }

  const { email, password } = parsed.data;

  try {
    // Check if email already exists
    const existing = await query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    if (existing.rows.length > 0) {
      res.status(409).json({ error: 'An account with this email already exists.' });
      return;
    }

    // Hash password
    const salt = await bcrypt.genSalt(12);
    const passwordHash = await bcrypt.hash(password, salt);

    // Create user
    const result = await query(
      `INSERT INTO users (email, password_hash, tier) VALUES ($1, $2, 'free') RETURNING id, email, tier, created_at`,
      [email.toLowerCase(), passwordHash]
    );

    const user = result.rows[0];

    // Generate token
    const tokenPayload: JwtPayload = {
      userId: user.id,
      email: user.email,
      tier: user.tier,
    };
    const token = generateToken(tokenPayload);

    res.status(201).json({
      success: true,
      data: {
        user: {
          id: user.id,
          email: user.email,
          tier: user.tier,
          created_at: user.created_at,
        },
        token,
      },
    });
  } catch (err) {
    console.error('[auth/register] Error:', err);
    res.status(500).json({ error: 'Registration failed. Please try again.' });
  }
});

// --- POST /api/auth/login ---

router.post('/login', async (req: Request, res: Response): Promise<void> => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'Invalid request',
      details: parsed.error.issues.map((i) => i.message),
    });
    return;
  }

  const { email, password } = parsed.data;

  try {
    // Find user
    const result = await query(
      'SELECT id, email, password_hash, tier FROM users WHERE email = $1',
      [email.toLowerCase()]
    );

    if (result.rows.length === 0) {
      res.status(401).json({ error: 'Invalid email or password.' });
      return;
    }

    const user = result.rows[0];

    // Verify password
    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      res.status(401).json({ error: 'Invalid email or password.' });
      return;
    }

    // Generate token
    const tokenPayload: JwtPayload = {
      userId: user.id,
      email: user.email,
      tier: user.tier,
    };
    const token = generateToken(tokenPayload);

    res.json({
      success: true,
      data: {
        user: {
          id: user.id,
          email: user.email,
          tier: user.tier,
        },
        token,
      },
    });
  } catch (err) {
    console.error('[auth/login] Error:', err);
    res.status(500).json({ error: 'Login failed. Please try again.' });
  }
});

// --- GET /api/auth/tiktok/callback ---
router.get('/tiktok/callback', async (req: Request, res: Response): Promise<void> => {
  const { code, state } = req.query;

  if (!code || state !== 'repostlaira') {
    res.status(400).send('Authorization failed. Missing code or invalid state.');
    return;
  }

  try {
    const tokenRes = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_key: process.env.TIKTOK_CLIENT_KEY || 'aw1j8mw20p6ovj1s',
        client_secret: process.env.TIKTOK_CLIENT_SECRET || 'u7emxMzPl1v0Uzct3tvukMiiNc7jaVLf',
        code: code as string,
        grant_type: 'authorization_code',
        redirect_uri: 'https://repost.arialtravel.com/api/auth/tiktok/callback',
      }),
    });

    const tokenData = await tokenRes.json() as any;
    console.log('[auth/tiktok] Token response:', JSON.stringify(tokenData));

    if (tokenData.access_token) {
      const fs = require('fs');
      const envPath = '/opt/repostlaira/auto-repost/.env';
      let envContent = '';
      try { envContent = fs.readFileSync(envPath, 'utf8'); } catch {}

      if (envContent.includes('TIKTOK_ACCESS_TOKEN=')) {
        envContent = envContent.replace(/TIKTOK_ACCESS_TOKEN=.*/g, `TIKTOK_ACCESS_TOKEN=${tokenData.access_token}`);
      } else {
        envContent += `\nTIKTOK_ACCESS_TOKEN=${tokenData.access_token}\n`;
      }

      if (tokenData.refresh_token) {
        if (envContent.includes('TIKTOK_REFRESH_TOKEN=')) {
          envContent = envContent.replace(/TIKTOK_REFRESH_TOKEN=.*/g, `TIKTOK_REFRESH_TOKEN=${tokenData.refresh_token}`);
        } else {
          envContent += `TIKTOK_REFRESH_TOKEN=${tokenData.refresh_token}\n`;
        }
      }

      fs.writeFileSync(envPath, envContent);

      res.send(`
        <html><body style="background:#0f172a;color:white;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;">
          <div style="text-align:center;">
            <h1 style="color:#3B82F6;">TikTok autorise avec succes !</h1>
            <p>Le token a ete sauvegarde. L'auto-post TikTok est maintenant actif.</p>
            <p>Vous pouvez fermer cette page.</p>
          </div>
        </body></html>
      `);
    } else {
      console.error('[auth/tiktok] Failed to get token:', tokenData);
      res.status(400).send(`Authorization failed: ${JSON.stringify(tokenData)}`);
    }
  } catch (err) {
    console.error('[auth/tiktok] Callback error:', err);
    res.status(500).send('TikTok authorization failed. Please try again.');
  }
});

export default router;
