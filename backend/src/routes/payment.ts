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

// ===== PAYPAL HELPERS =====

function getPayPalBaseUrl(): string {
  return config.paypal.mode === 'live'
    ? 'https://api-m.paypal.com'
    : 'https://api-m.sandbox.paypal.com';
}

async function getPayPalAccessToken(): Promise<string> {
  const { clientId, clientSecret } = config.paypal;
  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const baseUrl = getPayPalBaseUrl();

  const tokenRes = await fetch(`${baseUrl}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  if (!tokenRes.ok) {
    const errBody = await tokenRes.text();
    console.error('[paypal] Token request failed:', tokenRes.status, errBody);
    throw new Error('PayPal authentication failed');
  }

  const tokenData = await tokenRes.json() as any;
  return tokenData.access_token;
}

async function verifyPayPalWebhookSignature(
  req: Request,
  webhookId: string
): Promise<boolean> {
  try {
    const accessToken = await getPayPalAccessToken();
    const baseUrl = getPayPalBaseUrl();

    const verifyRes = await fetch(`${baseUrl}/v1/notifications/verify-webhook-signature`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        auth_algo: req.headers['paypal-auth-algo'],
        cert_url: req.headers['paypal-cert-url'],
        transmission_id: req.headers['paypal-transmission-id'],
        transmission_sig: req.headers['paypal-transmission-sig'],
        transmission_time: req.headers['paypal-transmission-time'],
        webhook_id: webhookId,
        webhook_event: req.body,
      }),
    });

    const verifyData = await verifyRes.json() as any;
    return verifyData.verification_status === 'SUCCESS';
  } catch (err) {
    console.error('[paypal/webhook] Signature verification error:', err);
    return false;
  }
}

// --- POST /api/payment/paypal/create-order ---
router.post('/paypal/create-order', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const { clientId, clientSecret } = config.paypal;
  if (!clientId || !clientSecret) {
    res.status(503).json({ error: 'PayPal non configure' });
    return;
  }

  try {
    const userId = req.user!.userId;
    const { type, pack_id } = req.body;

    // Determine product_id from the request body
    // Support both old format { product_id } and new format { type, pack_id }
    const product_id = type === 'premium' ? 'premium' : (pack_id || req.body.product_id);

    if (!product_id) {
      res.status(400).json({ error: 'Produit requis (type + pack_id ou product_id)' });
      return;
    }

    let amount: string;
    let description: string;
    let itemName: string;

    if (product_id === 'premium') {
      amount = (PREMIUM_MONTHLY_CENTS / 100).toFixed(2);
      description = 'RepostLaira Premium - Abonnement mensuel';
      itemName = 'RepostLaira Premium (1 mois)';
    } else {
      const pack = COIN_PACKS.find(p => p.id === product_id);
      if (!pack) {
        res.status(400).json({ error: 'Pack invalide. Packs disponibles: coins_50, coins_150, coins_500' });
        return;
      }
      amount = (pack.price_cents / 100).toFixed(2);
      description = `RepostLaira - ${pack.coins} coins`;
      itemName = `${pack.coins} Coins RepostLaira`;
    }

    console.log(`[paypal/create-order] User ${userId} creating order for ${product_id}, amount: ${amount} EUR`);

    const accessToken = await getPayPalAccessToken();
    const baseUrl = getPayPalBaseUrl();
    const appBaseUrl = getBaseUrl();

    const orderPayload: any = {
      intent: 'CAPTURE',
      purchase_units: [{
        amount: {
          currency_code: 'EUR',
          value: amount,
          breakdown: {
            item_total: { currency_code: 'EUR', value: amount },
          },
        },
        description,
        custom_id: JSON.stringify({ user_id: userId, product_id }),
        items: [{
          name: itemName,
          quantity: '1',
          unit_amount: { currency_code: 'EUR', value: amount },
          category: product_id === 'premium' ? 'DIGITAL_GOODS' : 'DIGITAL_GOODS',
        }],
      }],
      application_context: {
        brand_name: 'RepostLaira',
        locale: 'fr-FR',
        landing_page: 'LOGIN',
        user_action: 'PAY_NOW',
        return_url: `${appBaseUrl}/app/?payment=success&provider=paypal`,
        cancel_url: `${appBaseUrl}/app/?payment=cancelled&provider=paypal`,
      },
    };

    const orderRes = await fetch(`${baseUrl}/v2/checkout/orders`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation',
      },
      body: JSON.stringify(orderPayload),
    });

    const orderData = await orderRes.json() as any;

    if (!orderRes.ok || !orderData.id) {
      console.error('[paypal/create-order] PayPal API error:', JSON.stringify(orderData));
      res.status(502).json({
        error: 'Erreur PayPal lors de la creation de la commande',
        details: orderData.message || orderData.details?.[0]?.description,
      });
      return;
    }

    // Extract the approval URL for redirect-based flow
    const approvalLink = orderData.links?.find((l: any) => l.rel === 'approve');
    const approvalUrl = approvalLink?.href || null;

    console.log(`[paypal/create-order] Order created: ${orderData.id}, status: ${orderData.status}`);

    res.json({
      success: true,
      data: {
        order_id: orderData.id,
        orderId: orderData.id,
        approval_url: approvalUrl,
        approvalUrl,
        status: orderData.status,
      },
    });
  } catch (err) {
    console.error('[paypal/create-order] Error:', err);
    res.status(500).json({ error: 'Impossible de creer la commande PayPal' });
  }
});

// --- POST /api/payment/paypal/capture-order ---
router.post('/paypal/capture-order', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const { clientId, clientSecret } = config.paypal;
  if (!clientId || !clientSecret) {
    res.status(503).json({ error: 'PayPal non configure' });
    return;
  }

  try {
    const userId = req.user!.userId;
    const orderId = req.body.orderId || req.body.order_id;

    if (!orderId) {
      res.status(400).json({ error: 'orderId requis' });
      return;
    }

    console.log(`[paypal/capture-order] User ${userId} capturing order ${orderId}`);

    const accessToken = await getPayPalAccessToken();
    const baseUrl = getPayPalBaseUrl();

    // First, get order details to check status
    const orderCheckRes = await fetch(`${baseUrl}/v2/checkout/orders/${orderId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });
    const orderCheckData = await orderCheckRes.json() as any;

    // If already captured, handle idempotently
    if (orderCheckData.status === 'COMPLETED') {
      console.log(`[paypal/capture-order] Order ${orderId} already completed, handling idempotently`);
      res.json({ success: true, data: { status: 'completed', message: 'Paiement deja traite' } });
      return;
    }

    if (orderCheckData.status !== 'APPROVED') {
      console.warn(`[paypal/capture-order] Order ${orderId} not approved, status: ${orderCheckData.status}`);
      res.status(400).json({
        error: 'La commande n\'a pas ete approuvee par l\'utilisateur',
        status: orderCheckData.status,
      });
      return;
    }

    // Capture the payment
    const captureRes = await fetch(`${baseUrl}/v2/checkout/orders/${orderId}/capture`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation',
      },
    });

    const captureData = await captureRes.json() as any;

    if (!captureRes.ok || captureData.status !== 'COMPLETED') {
      console.error('[paypal/capture-order] Capture failed:', JSON.stringify(captureData));
      res.status(400).json({
        error: 'Le paiement n\'a pas pu etre capture',
        status: captureData.status,
        details: captureData.details?.[0]?.description,
      });
      return;
    }

    // Extract payment details
    const unit = captureData.purchase_units?.[0];
    const capture = unit?.payments?.captures?.[0];
    const captureId = capture?.id || orderId;
    const amountValue = capture?.amount?.value || unit?.amount?.value || '0';
    const amountCents = Math.round(parseFloat(amountValue) * 100);

    // Parse custom_id to get product info
    let customData: any = {};
    try {
      const rawCustomId = capture?.custom_id || unit?.custom_id || '{}';
      customData = JSON.parse(rawCustomId);
    } catch {
      console.warn('[paypal/capture-order] Could not parse custom_id, using request user');
    }

    const effectiveUserId = customData.user_id || userId;
    const productId = customData.product_id;

    // Check for duplicate payment (idempotency)
    const existingPayment = await query(
      `SELECT id FROM payments WHERE provider = 'paypal' AND provider_payment_id = $1`,
      [captureId]
    );
    if (existingPayment.rows.length > 0) {
      console.log(`[paypal/capture-order] Payment ${captureId} already recorded, skipping`);
      res.json({ success: true, data: { status: 'completed', message: 'Paiement deja enregistre' } });
      return;
    }

    let responseData: any = { status: 'completed' };

    if (productId === 'premium') {
      // Activate premium subscription
      const expiresAt = new Date();
      expiresAt.setMonth(expiresAt.getMonth() + 1);

      await query(
        `INSERT INTO subscriptions (user_id, store, expires_at) VALUES ($1, 'paypal', $2)`,
        [effectiveUserId, expiresAt.toISOString()]
      );
      await query("UPDATE users SET tier = 'premium' WHERE id = $1", [effectiveUserId]);
      await query(
        `INSERT INTO payments (user_id, provider, provider_payment_id, amount_cents, currency, product_type, product_detail, status)
         VALUES ($1, 'paypal', $2, $3, 'EUR', 'premium', 'Abonnement Premium mensuel via PayPal', 'completed')`,
        [effectiveUserId, captureId, amountCents]
      );

      responseData.subscription = {
        type: 'premium',
        expires_at: expiresAt.toISOString(),
      };

      console.log(`[paypal/capture-order] Premium activated for user ${effectiveUserId}, expires: ${expiresAt.toISOString()}`);
    } else {
      // Add coins
      const pack = COIN_PACKS.find(p => p.id === productId);
      if (!pack) {
        console.error(`[paypal/capture-order] Unknown product_id: ${productId}`);
        // Still record the payment but warn
        await query(
          `INSERT INTO payments (user_id, provider, provider_payment_id, amount_cents, currency, product_type, product_detail, status)
           VALUES ($1, 'paypal', $2, $3, 'EUR', 'unknown', $4, 'completed')`,
          [effectiveUserId, captureId, amountCents, `Produit inconnu: ${productId}`]
        );
        res.status(400).json({ error: 'Pack de coins inconnu. Le paiement a ete capture mais les coins n\'ont pas ete ajoutes. Contactez le support.' });
        return;
      }

      await query('UPDATE users SET coins = coins + $1 WHERE id = $2', [pack.coins, effectiveUserId]);
      await query(
        `INSERT INTO coin_transactions (user_id, amount, type, description, payment_id)
         VALUES ($1, $2, 'purchase', $3, $4)`,
        [effectiveUserId, pack.coins, `Achat de ${pack.coins} coins via PayPal`, captureId]
      );
      await query(
        `INSERT INTO payments (user_id, provider, provider_payment_id, amount_cents, currency, product_type, product_detail, status)
         VALUES ($1, 'paypal', $2, $3, 'EUR', 'coins', $4, 'completed')`,
        [effectiveUserId, captureId, amountCents, `${pack.coins} coins`]
      );

      // Get updated coin balance
      const balanceResult = await query('SELECT coins FROM users WHERE id = $1', [effectiveUserId]);
      const newBalance = balanceResult.rows[0]?.coins || 0;

      responseData.coins_added = pack.coins;
      responseData.new_balance = newBalance;

      console.log(`[paypal/capture-order] ${pack.coins} coins added to user ${effectiveUserId}, new balance: ${newBalance}`);
    }

    res.json({ success: true, data: responseData });
  } catch (err) {
    console.error('[paypal/capture-order] Error:', err);
    res.status(500).json({ error: 'Impossible de capturer le paiement PayPal' });
  }
});

// --- POST /api/payment/paypal/capture (alias for backward compatibility) ---
router.post('/paypal/capture', requireAuth, async (req: Request, res: Response): Promise<void> => {
  // Forward to capture-order
  req.body.orderId = req.body.orderId || req.body.order_id;
  // Use the same handler by redirecting internally
  const { clientId, clientSecret } = config.paypal;
  if (!clientId || !clientSecret) {
    res.status(503).json({ error: 'PayPal non configure' });
    return;
  }

  try {
    const userId = req.user!.userId;
    const orderId = req.body.orderId || req.body.order_id;
    if (!orderId) {
      res.status(400).json({ error: 'order_id requis' });
      return;
    }

    const accessToken = await getPayPalAccessToken();
    const baseUrl = getPayPalBaseUrl();

    const captureRes = await fetch(`${baseUrl}/v2/checkout/orders/${orderId}/capture`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation',
      },
    });
    const captureData = await captureRes.json() as any;

    if (captureData.status === 'COMPLETED') {
      const unit = captureData.purchase_units?.[0];
      const capture = unit?.payments?.captures?.[0];
      const captureId = capture?.id || orderId;
      const customData = JSON.parse(capture?.custom_id || unit?.custom_id || '{}');
      const effectiveUserId = customData.user_id || userId;
      const productId = customData.product_id;
      const amountCents = Math.round(parseFloat(capture?.amount?.value || unit?.amount?.value || '0') * 100);

      // Idempotency check
      const existing = await query(`SELECT id FROM payments WHERE provider = 'paypal' AND provider_payment_id = $1`, [captureId]);
      if (existing.rows.length > 0) {
        res.json({ success: true, data: { status: 'completed' } });
        return;
      }

      if (productId === 'premium') {
        const expiresAt = new Date();
        expiresAt.setMonth(expiresAt.getMonth() + 1);
        await query(`INSERT INTO subscriptions (user_id, store, expires_at) VALUES ($1, 'paypal', $2)`, [effectiveUserId, expiresAt.toISOString()]);
        await query("UPDATE users SET tier = 'premium' WHERE id = $1", [effectiveUserId]);
        await query(
          `INSERT INTO payments (user_id, provider, provider_payment_id, amount_cents, currency, product_type, product_detail, status)
           VALUES ($1, 'paypal', $2, $3, 'EUR', 'premium', 'Abonnement mensuel', 'completed')`,
          [effectiveUserId, captureId, amountCents]
        );
      } else {
        const pack = COIN_PACKS.find(p => p.id === productId);
        if (pack) {
          await query('UPDATE users SET coins = coins + $1 WHERE id = $2', [pack.coins, effectiveUserId]);
          await query(
            `INSERT INTO coin_transactions (user_id, amount, type, description, payment_id)
             VALUES ($1, $2, 'purchase', $3, $4)`,
            [effectiveUserId, pack.coins, `Achat de ${pack.coins} coins via PayPal`, captureId]
          );
          await query(
            `INSERT INTO payments (user_id, provider, provider_payment_id, amount_cents, currency, product_type, product_detail, status)
             VALUES ($1, 'paypal', $2, $3, 'EUR', 'coins', $4, 'completed')`,
            [effectiveUserId, captureId, amountCents, `${pack.coins} coins`]
          );
        }
      }

      res.json({ success: true, data: { status: 'completed' } });
    } else {
      res.status(400).json({ error: 'Payment not completed', status: captureData.status });
    }
  } catch (err) {
    console.error('[paypal/capture] Error:', err);
    res.status(500).json({ error: 'Failed to capture PayPal payment' });
  }
});

// --- POST /api/payment/paypal/webhook ---
router.post('/paypal/webhook', async (req: Request, res: Response): Promise<void> => {
  const { clientId, clientSecret } = config.paypal;
  if (!clientId || !clientSecret) {
    res.status(503).json({ error: 'PayPal not configured' });
    return;
  }

  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  const eventType = req.body?.event_type;
  const resource = req.body?.resource;

  console.log(`[paypal/webhook] Received event: ${eventType}`);

  // Verify webhook signature if webhook ID is configured
  if (webhookId) {
    const isValid = await verifyPayPalWebhookSignature(req, webhookId);
    if (!isValid) {
      console.error('[paypal/webhook] Invalid webhook signature');
      res.status(400).json({ error: 'Invalid webhook signature' });
      return;
    }
  } else {
    console.warn('[paypal/webhook] PAYPAL_WEBHOOK_ID not set, skipping signature verification');
  }

  try {
    switch (eventType) {
      // One-time payment captured (coin packs or single premium payment)
      case 'PAYMENT.CAPTURE.COMPLETED': {
        const captureId = resource?.id;
        const customId = resource?.custom_id;
        if (!customId) {
          console.log('[paypal/webhook] No custom_id in capture, skipping');
          break;
        }

        let customData: any;
        try {
          customData = JSON.parse(customId);
        } catch {
          console.error('[paypal/webhook] Invalid custom_id JSON:', customId);
          break;
        }

        const userId = customData.user_id;
        const productId = customData.product_id;
        const amountCents = Math.round(parseFloat(resource?.amount?.value || '0') * 100);

        if (!userId) {
          console.error('[paypal/webhook] No user_id in custom_id');
          break;
        }

        // Idempotency
        const existing = await query(
          `SELECT id FROM payments WHERE provider = 'paypal' AND provider_payment_id = $1`,
          [captureId]
        );
        if (existing.rows.length > 0) {
          console.log(`[paypal/webhook] Payment ${captureId} already processed`);
          break;
        }

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
             VALUES ($1, 'paypal', $2, $3, 'EUR', 'premium', 'Abonnement Premium (webhook)', 'completed')`,
            [userId, captureId, amountCents]
          );
          console.log(`[paypal/webhook] Premium activated for user ${userId}`);
        } else {
          const pack = COIN_PACKS.find(p => p.id === productId);
          if (pack) {
            await query('UPDATE users SET coins = coins + $1 WHERE id = $2', [pack.coins, userId]);
            await query(
              `INSERT INTO coin_transactions (user_id, amount, type, description, payment_id)
               VALUES ($1, $2, 'purchase', $3, $4)`,
              [userId, pack.coins, `Achat de ${pack.coins} coins via PayPal (webhook)`, captureId]
            );
            await query(
              `INSERT INTO payments (user_id, provider, provider_payment_id, amount_cents, currency, product_type, product_detail, status)
               VALUES ($1, 'paypal', $2, $3, 'EUR', 'coins', $4, 'completed')`,
              [userId, captureId, amountCents, `${pack.coins} coins`]
            );
            console.log(`[paypal/webhook] ${pack.coins} coins added to user ${userId}`);
          }
        }
        break;
      }

      // Payment refunded
      case 'PAYMENT.CAPTURE.REFUNDED': {
        const captureId = resource?.id;
        if (captureId) {
          await query(
            `UPDATE payments SET status = 'refunded' WHERE provider = 'paypal' AND provider_payment_id = $1`,
            [captureId]
          );
          console.log(`[paypal/webhook] Payment ${captureId} marked as refunded`);
        }
        break;
      }

      // Payment denied
      case 'PAYMENT.CAPTURE.DENIED': {
        const captureId = resource?.id;
        if (captureId) {
          await query(
            `UPDATE payments SET status = 'denied' WHERE provider = 'paypal' AND provider_payment_id = $1`,
            [captureId]
          );
          console.log(`[paypal/webhook] Payment ${captureId} denied`);
        }
        break;
      }

      default:
        console.log(`[paypal/webhook] Unhandled event type: ${eventType}`);
    }

    res.json({ received: true });
  } catch (err) {
    console.error('[paypal/webhook] Processing error:', err);
    res.status(500).json({ error: 'Webhook processing failed' });
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
