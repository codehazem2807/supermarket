-- Atomic customer loyalty redemption and idempotent offline sales.
-- Apply after the base schema and sales_calculation_migration.sql.
BEGIN;

CREATE OR REPLACE FUNCTION public.redeem_customer_loyalty_points(
  p_customer_id uuid,
  p_points integer,
  p_reason text DEFAULT NULL
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_company_id uuid := public.auth_company_id();
  v_balance integer;
BEGIN
  IF auth.uid() IS NULL OR v_company_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF NOT (
    public.auth_has_permission('customers.manage')
    OR public.auth_has_permission('customers.full')
    OR public.auth_has_permission('admin.full')
  ) THEN
    RAISE EXCEPTION 'Permission denied: customer loyalty redemption';
  END IF;
  IF p_points IS NULL OR p_points <= 0 THEN
    RAISE EXCEPTION 'Points must be a positive integer';
  END IF;

  SELECT COALESCE(c.loyalty_points, 0)
    INTO v_balance
  FROM public.customers c
  WHERE c.id = p_customer_id
    AND c.company_id = v_company_id
    AND c.is_active = true
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active customer not found';
  END IF;
  IF v_balance < p_points THEN
    RAISE EXCEPTION 'Insufficient loyalty points';
  END IF;

  v_balance := v_balance - p_points;
  UPDATE public.customers
  SET loyalty_points = v_balance
  WHERE id = p_customer_id
    AND company_id = v_company_id;

  INSERT INTO public.loyalty_points(
    company_id, customer_id, points, reason, reference_type, reference_id
  ) VALUES (
    v_company_id, p_customer_id, -p_points,
    NULLIF(trim(p_reason), ''), 'manual', NULL
  );

  RETURN v_balance;
END
$$;

REVOKE ALL ON FUNCTION public.redeem_customer_loyalty_points(uuid, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.redeem_customer_loyalty_points(uuid, integer, text) TO authenticated;

CREATE TABLE IF NOT EXISTS public.offline_sale_requests (
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  operation_id uuid NOT NULL,
  invoice_id uuid REFERENCES public.sales_invoices(id) ON DELETE RESTRICT,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, operation_id)
);

ALTER TABLE public.offline_sale_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.offline_sale_requests FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.record_invoice_v3(
  p_company uuid,
  p_branch uuid,
  p_warehouse uuid,
  p_register uuid,
  p_session uuid,
  p_customer uuid,
  p_items jsonb,
  p_method public.payment_method,
  p_tax_inclusive boolean,
  p_paid numeric,
  p_notes text,
  p_tax numeric,
  p_discount numeric,
  p_discount_type text,
  p_payments jsonb,
  p_offline_operation_id uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_invoice_id uuid;
BEGIN
  IF auth.uid() IS NULL OR p_company IS NULL THEN
    RAISE EXCEPTION 'Authentication and company are required';
  END IF;
  IF NOT (
    public.auth_has_permission('pos.use')
    OR public.auth_has_permission('pos.full')
    OR public.auth_has_permission('admin.full')
  ) THEN
    RAISE EXCEPTION 'Permission denied: offline sale';
  END IF;
  IF NOT public.auth_is_platform_admin()
     AND p_company IS DISTINCT FROM public.auth_company_id() THEN
    RAISE EXCEPTION 'Permission denied for this company';
  END IF;
  IF p_offline_operation_id IS NULL THEN
    RAISE EXCEPTION 'Offline operation ID is required';
  END IF;

  INSERT INTO public.offline_sale_requests(company_id, operation_id, created_by)
  VALUES (p_company, p_offline_operation_id, auth.uid())
  ON CONFLICT (company_id, operation_id) DO NOTHING;

  SELECT invoice_id
    INTO v_invoice_id
  FROM public.offline_sale_requests
  WHERE company_id = p_company
    AND operation_id = p_offline_operation_id
  FOR UPDATE;

  IF v_invoice_id IS NOT NULL THEN
    RETURN v_invoice_id;
  END IF;

  v_invoice_id := public.record_invoice_v3(
    p_company, p_branch, p_warehouse, p_register, p_session, p_customer,
    p_items, p_method, p_tax_inclusive, p_paid, p_notes, p_tax,
    p_discount, p_discount_type, p_payments
  );

  UPDATE public.offline_sale_requests
  SET invoice_id = v_invoice_id
  WHERE company_id = p_company
    AND operation_id = p_offline_operation_id;

  RETURN v_invoice_id;
END
$$;

REVOKE ALL ON FUNCTION public.record_invoice_v3(
  uuid, uuid, uuid, uuid, uuid, uuid, jsonb, public.payment_method,
  boolean, numeric, text, numeric, numeric, text, jsonb, uuid
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_invoice_v3(
  uuid, uuid, uuid, uuid, uuid, uuid, jsonb, public.payment_method,
  boolean, numeric, text, numeric, numeric, text, jsonb, uuid
) TO authenticated;

COMMIT;
