import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from './config';
import { generalRateLimit } from './middleware/rateLimit';
import extractRoutes from './routes/extract';
import authRoutes from './routes/auth';
import subscriptionRoutes from './routes/subscription';

const app = express();

// --- Security & Parsing ---
app.use(helmet());
app.use(cors({
  origin: config.cors.origins,
  credentials: true,
}));
app.use(express.json({ limit: '1mb' }));
app.use(generalRateLimit);

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
