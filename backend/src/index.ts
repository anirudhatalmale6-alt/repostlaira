import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import { config } from './config';
import { generalRateLimit } from './middleware/rateLimit';
import extractRoutes from './routes/extract';
import authRoutes from './routes/auth';
import subscriptionRoutes from './routes/subscription';
import adminRoutes, { adsPublicRouter } from './routes/admin';
import paymentRoutes from './routes/payment';

const app = express();

// --- Security & Parsing ---
app.use(helmet({
  crossOriginResourcePolicy: false,
  contentSecurityPolicy: false,
}));
app.use(cors({
  origin: config.cors.origins.includes('*') ? true : config.cors.origins,
  credentials: true,
}));
app.use(express.json({
  limit: '1mb',
  verify: (req: any, _res, buf) => {
    if (req.originalUrl === '/api/payment/stripe/webhook' || req.originalUrl === '/api/payment/paypal/webhook') {
      req.rawBody = buf;
    }
  },
}));
app.use(generalRateLimit);

// --- Static files ---
app.use('/public', express.static(path.join(__dirname, '..', 'public')));
app.use('/admin', express.static(path.join(__dirname, '..', 'web', 'admin')));
app.use('/app', express.static(path.join(__dirname, '..', 'web', 'app')));

// --- Health Check ---
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'repostlaira-backend',
    timestamp: new Date().toISOString(),
  });
});

// --- Routes ---
app.use('/api/extract', extractRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/subscription', subscriptionRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/ads', adsPublicRouter);
app.use('/api/payment', paymentRoutes);

// --- Web app root redirect ---
app.get('/', (_req, res) => {
  res.redirect('/app');
});

// --- 404 Handler ---
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// --- Error Handler ---
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[server] Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// --- Start Server ---
app.listen(config.port, '0.0.0.0', () => {
  console.log(`[RepostLaira] Server running on port ${config.port}`);
  console.log(`[RepostLaira] Environment: ${config.nodeEnv}`);
  console.log(`[RepostLaira] yt-dlp path: ${config.ytdlp.path}`);
});

export default app;
