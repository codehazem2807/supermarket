-- Run once in Supabase SQL Editor to restore the payment table if it is missing.
BEGIN;

CREATE TABLE IF NOT EXISTS public.payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES public.branches(id) ON DELETE CASCADE,
  payment_number text NOT NULL,
  payment_type public.party_type,
  direction public.payment_direction NOT NULL,
  operation_type public.operation_type,
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE RESTRICT,
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  supplier_id uuid REFERENCES public.suppliers(id) ON DELETE SET NULL,
  amount numeric(14,2) NOT NULL,
  method public.payment_method DEFAULT 'cash',
  payment_date date DEFAULT current_date,
  reference text,
  notes text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE(company_id, payment_number)
);

CREATE INDEX IF NOT EXISTS idx_pay_company
  ON public.payments(company_id, payment_date DESC);

ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payments_all ON public.payments;
CREATE POLICY payments_all ON public.payments FOR ALL
  USING (company_id = auth_company_id() OR auth_is_platform_admin())
  WITH CHECK (company_id = auth_company_id() OR auth_is_platform_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.payments TO authenticated;

DO $$
BEGIN
  IF to_regprocedure('public.audit_business_change()') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS audit_business_change ON public.payments';
    EXECUTE 'CREATE TRIGGER audit_business_change
      AFTER INSERT OR UPDATE OR DELETE ON public.payments
      FOR EACH ROW EXECUTE FUNCTION public.audit_business_change()';
  END IF;
END
$$;

COMMIT;
