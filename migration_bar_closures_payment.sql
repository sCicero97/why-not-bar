-- Migration: add payment columns to bar_closures
-- Run this in the Supabase SQL Editor

ALTER TABLE bar_closures
  ADD COLUMN IF NOT EXISTS payment_method  TEXT,       -- 'transfer' | 'cash'
  ADD COLUMN IF NOT EXISTS cash_received   NUMERIC,    -- monto recibido en efectivo
  ADD COLUMN IF NOT EXISTS change_given    NUMERIC;    -- vuelto entregado
