-- Migration: Add 'paypal' as valid store for subscriptions table
-- Run: psql $DATABASE_URL -f src/db/migrations/002_add_paypal_store.sql

-- Drop the old CHECK constraint on subscriptions.store
ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS subscriptions_store_check;

-- Add new CHECK constraint that includes 'paypal'
ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_store_check
  CHECK (store IN ('apple', 'google', 'stripe', 'paypal'));
