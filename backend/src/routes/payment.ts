import { Router, Request, Response } from 'express';
import Stripe from 'stripe';

import { requireAuth } from '../middleware/auth';
import { query } from '../db/pool';
import { config } from '../config';

const router = Router();

const COIN_PACKS = [
  { id: 'coins_50', coins: 50, price_cents: 199, label: '50 coins' },
  { id: 'coins_150', coins: 150, price_cents: 499, label: '150 coins' },
  { id: 'coins_500', coins: 500, price_cents: 1499, label: '500 coins' },
];

const PREMIUM_MONTHLY_CENTS = 499;

function getStripe(): any {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  return new Stripe(key);
}

function getBaseUrl(): string {
  return process.env.BASE_URL || `http://localhost:${config.port}`;
}

// --- GET /api/payment/products ---
router.get('/products', (_req: Request, res: Response) => {
  res.json({
    success: true,
    data: {
      coin_packs: COIN_PACKS.map(p => ({
        id: p.id,
        coins: p.coins,
        price: (p.price_cents / 100).toFixed(2),
        currency: 'EUR',
      })),
      premium: {
        price: (PREMIUM_MONTHLY_CENTS / 100).toFixed(2),
        currency: 'EUR',
        period: 'month',
      },
      providers: {
        stripe: !!process.env.STRIPE_SECRET_KEY,
        paypal: !!process.env.PAYPAL_CLIENT_ID,
      },
    },
  });
});

// --- GET /api/payment/coins ---
router.get('/coins', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.userId;
    const result = await query(
      'SELECT coins, coins_last_reset FROM users WHERE id = $1',
      [userId]
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    const user = result.rows[0];
    const today = new Date().toISOString().slice(0, 10);

    let coins = user.coins;
    if (user.coins_last_reset !== today) {
      const tierResult = await query(
        `SELECT s.id FROM subscriptions s WHERE s.user_id = $1 AND s.expires_at > NOW() LIMIT 1`,
        [userId]
      );
      const isPremium = tierResult.rows.length > 0;
      if (!isPremium) {
        coins = 10;
        await query(
          'UPDATE users SET coins = 10, coins_last_reset = $1 WHERE id = $2',
          [today, userId]
        );
        await query(
          `INSERT INTO coin_transactions (user_id, amount, type, description)
           VALUES ($1, 10, 'daily_reset', 'Rechargement quotidien gratuit')`,
          [userId]
        );
      }
    }

    res.json({ success: true, data: { coins } });
  } catch (err) {
    console.error('[payment/coins] Error:', err);
    res.status(500).json({ error: 'Failed to get coin balance' });
  }
});

// --- POST /api/payment/use-coin ---
router.post('/use-coin', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.userId;
    const tierResult = await query(
      `SELECT s.id FROM subscriptions s WHERE s.user_id = $1 AND s.expires_at > NOW() LIMIT 1`,
      [userId]
    );
    const isPremium = tierResult.rows.length > 0;
    if (isPremium) {
      res.json({ success: true, data: { coins: -1, premium: true } });
      return;
    }

    const result = await query(
      'UPDATE users SET coins = coins - 1 WHERE id = $1 AND coins > 0 RETURNING coins',
      [userId]
    );
    if (result.rows.length === 0) {
      res.status(402).json({
        error: 'Pas assez de coins',
        message: 'Achetez des coins ou passez a Premium pour continuer.',
      });
      return;
    }

    await query(
      `INSERT INTO coin_transactions (user_id, amount, type, description)
       VALUES ($1, -1, 'usage', 'Telechargement')`,
      [userId]
    );

    res.json({ success: true, data: { coins: result.rows[0].coins } });
  } catch (err) {
    console.error('[payment/use-coin] Error:', err);
    res.status(500).json({ error: 'Failed to use coin' });
  }
});

// --- POST /api/payment/stripe/checkout ---
router.post('/stripe/checkout', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const stripe = getStripe();
  if (!stripe) {
    res.status(503).json({ error: 'Stripe non configure' });
    return;
  }

  try {
    const userId = req.user!.userId;
    const { product_id } = req.body;

    const userResult = await query('SELECT email, stripe_customer_id FROM users WHERE id = $1', [userId]);
    if (userResult.rows.length === 0) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    const user = userResult.rows[0];

    let customerId = user.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({ email: user.email });
      customerId = customer.id;
      await query('UPDATE users SET stripe_customer_id = $1 WHERE id = $2', [customerId, userId]);
    }

    const baseUrl = getBaseUrl();

    if (product_id === 'premium') {
      let priceId = process.env.STRIPE_PREMIUM_PRICE_ID;
      if (!priceId) {
        const product = await stripe.products.create({
          name: 'RepostLaira Premium',
          description: 'Telechargements illimites, qualite HD, sans publicites',
        });
        const price = await stripe.prices.create({
          product: product.id,
          unit_amount: PREMIUM_MONTHLY_CENTS,
          currency: 'eur',
          recurring: { interval: 'month' },
        });
        priceId = price.id;
      }

      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        mode: 'subscription',
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: `${baseUrl}/app/?payment=success`,
        cancel_url: `${baseUrl}/app/?payment=cancelled`,
        metadata: { user_id: userId, product_type: 'premium' },
      });

      res.json({ success: true, data: { url: session.url } });
    } else {
      const pack = COIN_PACKS.find(p => p.id === product_id);
      if (!pack) {
        res.status(400).json({ error: 'Produit invalide' });
        return;
      }

      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        mode: 'payment',
        line_items: [{
          price_data: {
            currency: 'eur',
            product_data: { name: `RepostLaira - ${pack.label}` },
            unit_amount: pack.price_cents,
          },
          quantity: 1,
        }],
        success_url: `${baseUrl}/app/?payment=success`,
        cancel_url: `${baseUrl}/app/?payment=cancelled`,
        metadata: { user_id: userId, product_type: 'coins', coin_pack_id: pack.id, coins: String(pack.coins) },
      });

      res.json({ success: true, data: { url: session.url } });
    }
  } catch (err) {
    console.error('[payment/stripe/checkout] Error:', err);
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
});

// --- POST /api/payment/stripe/webhook ---
router.post('/stripe/webhook', async (req: Request, res: Response): Promise<void> => {
  const stripe = getStripe();
  if (!stripe) {
    res.status(503).json({ error: 'Stripe not configured' });
    return;
  }

  const sig = req.headers['stripe-signature'] as string;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event: any;

  try {
    if (webhookSecret && sig) {
      event = stripe.webhooks.constructEvent(
        (req as any).rawBody || JSON.stringify(req.body),
        sig,
        webhookSecret
      );
    } else {
      event = req.body;
    }
  } catch (err: any) {
    console.error('[stripe/webhook] Signature verification failed:', err.message);
    res.status(400).json({ error: 'Invalid signature' });
    return;
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as any;
      const meta = session.metadata || {};
      const userId = meta.user_id;

      if (!userId) {
        console.error('[stripe/webhook] No user_id in metadata');
        res.json({ received: true });
        return;
      }

      if (meta.product_type === 'coins') {
        const coins = parseInt(meta.coins || '0', 10);
        if (coins > 0) {
          await query('UPDATE users SET coins = coins + $1 WHERE id = $2', [coins, userId]);
          await query(
            `INSERT INTO coin_transactions (user_id, amount, type, description, payment_id)
             VALUES ($1, $2, 'purchase', $3, $4)`,
            [userId, coins, `Achat de ${coins} coins`, session.payment_intent]
          );
          await query(
            `INSERT INTO payments (user_id, provider, provider_payment_id, amount_cents, currency, product_type, product_detail, status)
             VALUES ($1, 'stripe', $2, $3, 'EUR', 'coins', $4, 'completed')`,
            [userId, session.payment_intent, session.amount_total, `${coins} coins`]
          );
        }
      } else if (meta.product_type === 'premium') {
        const expiresAt = new Date();
        expiresAt.setMonth(expiresAt.getMonth() + 1);
        await query(
          `INSERT INTO subscriptions (user_id, store, expires_at)
           VALUES ($1, 'stripe', $2)`,
          [userId, expiresAt.toISOString()]
        );
        await query("UPDATE users SET tier = 'premium' WHERE id = $1", [userId]);
        await query(
          `INSERT INTO payments (user_id, provider, provider_payment_id, amount_cents, currency, product_type, product_detail, status)
           VALUES ($1, 'stripe', $2, $3, 'EUR', 'premium', 'Abonnement mensuel', 'completed')`,
          [userId, session.payment_intent, session.amount_total]
        );
      }
    }

    if (event.type === 'customer.subscription.deleted') {
      const subscription = event.data.object as any;
      const customerId = subscription.customer as string;
      const userResult = await query('SELECT id FROM users WHERE stripe_customer_id = $1', [customerId]);
      if (userResult.rows.length > 0) {
        await query("UPDATE users SET tier = 'free' WHERE id = $1", [userResult.rows[0].id]);
      }
    }

    res.json({ received: true });
  } catch (err) {
    console.error('[stripe/webhook] Processing error:', err);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

// --- POST /api/payment/paypal/create-order ---
router.post('/paypal/create-order', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    res.status(503).json({ error: 'PayPal non configure' });
    return;
  }

  try {
    const { product_id } = req.body;
    let amount: string;
    let description: string;

    if (product_id === 'premium') {
      amount = (PREMIUM_MONTHLY_CENTS / 100).toFixed(2);
      description = 'RepostLaira Premium - 1 mois';
    } else {
      const pack = COIN_PACKS.find(p => p.id === product_id);
      if (!pack) {
        res.status(400).json({ error: 'Produit invalide' });
        return;
      }
      amount = (pack.price_cents / 100).toFixed(2);
      description = `RepostLaira - ${pack.label}`;
    }

    const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const tokenRes = await fetch('https://api-m.paypal.com/v1/oauth2/token', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });
    const tokenData = await tokenRes.json() as any;

    const orderRes = await fetch('https://api-m.paypal.com/v2/checkout/orders', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${tokenData.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [{
          amount: { currency_code: 'EUR', value: amount },
          description,
          custom_id: JSON.stringify({
            user_id: req.user!.userId,
            product_id,
          }),
        }],
      }),
    });
    const orderData = await orderRes.json() as any;

    res.json({ success: true, data: { order_id: orderData.id } });
  } catch (err) {
    console.error('[payment/paypal/create-order] Error:', err);
    res.status(500).json({ error: 'Failed to create PayPal order' });
  }
});

// --- POST /api/payment/paypal/capture ---
router.post('/paypal/capture', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    res.status(503).json({ error: 'PayPal non configure' });
    return;
  }

  try {
    const { order_id } = req.body;
    const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

    const tokenRes = await fetch('https://api-m.paypal.com/v1/oauth2/token', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });
    const tokenData = await tokenRes.json() as any;

    const captureRes = await fetch(`https://api-m.paypal.com/v2/checkout/orders/${order_id}/capture`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${tokenData.access_token}`,
        'Content-Type': 'application/json',
      },
    });
    const captureData = await captureRes.json() as any;

    if (captureData.status === 'COMPLETED') {
      const unit = captureData.purchase_units?.[0];
      const customData = JSON.parse(unit?.payments?.captures?.[0]?.custom_id || unit?.custom_id || '{}');
      const userId = customData.user_id || req.user!.userId;
      const productId = customData.product_id;
      const amountCents = Math.round(parseFloat(unit?.amount?.value || '0') * 100);

      if (productId === 'premium') {
        const expiresAt = new Date();
        expiresAt.setMonth(expiresAt.getMonth() + 1);
        await query(
          `INSERT INTO subscriptions (user_id, store, expires_at) VALUES ($1, 'paypal', $2)`,
          [userId, expiresAt.toISOString()]
        );
        await query("UPDATE users SET tier = 'premium' WHERE id = $1", [userId]);
        await query(
          `INSERT INTO payments (user_id, provider, provider_payment_id, amount_cents, currency, product_type, product_detail, status)
           VALUES ($1, 'paypal', $2, $3, 'EUR', 'premium', 'Abonnement mensuel', 'completed')`,
          [userId, order_id, amountCents]
        );
      } else {
        const pack = COIN_PACKS.find(p => p.id === productId);
        if (pack) {
          await query('UPDATE users SET coins = coins + $1 WHERE id = $2', [pack.coins, userId]);
          await query(
            `INSERT INTO coin_transactions (user_id, amount, type, description, payment_id)
             VALUES ($1, $2, 'purchase', $3, $4)`,
            [userId, pack.coins, `Achat de ${pack.coins} coins via PayPal`, order_id]
          );
          await query(
            `INSERT INTO payments (user_id, provider, provider_payment_id, amount_cents, currency, product_type, product_detail, status)
             VALUES ($1, 'paypal', $2, $3, 'EUR', 'coins', $4, 'completed')`,
            [userId, order_id, amountCents, `${pack.coins} coins`]
          );
        }
      }

      res.json({ success: true, data: { status: 'completed' } });
    } else {
      res.status(400).json({ error: 'Payment not completed', status: captureData.status });
    }
  } catch (err) {
    console.error('[payment/paypal/capture] Error:', err);
    res.status(500).json({ error: 'Failed to capture PayPal payment' });
  }
});

// --- GET /api/payment/history ---
router.get('/history', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.userId;
    const result = await query(
      `SELECT id, provider, amount_cents, currency, product_type, product_detail, status, created_at
       FROM payments WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [userId]
    );
    res.json({ success: true, data: { payments: result.rows } });
  } catch (err) {
    console.error('[payment/history] Error:', err);
    res.status(500).json({ error: 'Failed to get payment history' });
  }
});

export default router;
