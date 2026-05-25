import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

export const config = {
  port: parseInt(process.env.PORT || '3010', 10),
  nodeEnv: process.env.NODE_ENV || 'development',

  database: {
    url: process.env.DATABASE_URL || 'postgresql://repostlaira:repostlaira_secret@localhost:5432/repostlaira',
  },

  jwt: {
    secret: process.env.JWT_SECRET || 'CHANGE_ME_TO_A_RANDOM_64_CHAR_STRING',
    expiresIn: process.env.JWT_EXPIRES_IN || '30d',
  },

  admin: {
    password: process.env.ADMIN_PASSWORD || 'RepostLaira2026!',
  },

  cors: {
    origins: (process.env.CORS_ORIGINS || 'http://localhost:3000,http://198.105.115.219:3010').split(',').map(s => s.trim()),
  },

  rateLimit: {
    freeTierLimit: parseInt(process.env.FREE_TIER_LIMIT || '10', 10),
  },

  ytdlp: {
    path: process.env.YTDLP_PATH || '/usr/bin/yt-dlp',
    timeout: parseInt(process.env.YTDLP_TIMEOUT || '30000', 10),
  },

  paypal: {
    clientId: process.env.PAYPAL_CLIENT_ID || '',
    clientSecret: process.env.PAYPAL_CLIENT_SECRET || '',
    mode: (process.env.PAYPAL_MODE || 'sandbox') as 'sandbox' | 'live',
    get baseUrl(): string {
      return this.mode === 'live'
        ? 'https://api-m.paypal.com'
        : 'https://api-m.sandbox.paypal.com';
    },
  },
} as const;
