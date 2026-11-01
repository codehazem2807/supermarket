BEGIN;

ALTER TABLE public.sales_invoices
  ADD COLUMN IF NOT EXISTS tax_inclusive boolean NOT NULL DEFAULT false;

ALTER TABLE public.sales_invoice_items
  ADD COLUMN IF NOT EXISTS sale_unit text NOT NULL DEFAULT 'piece',
  ADD COLUMN IF NOT EXISTS base_qty numeric(14,3);

ALTER TABLE public.sales_returns
  ADD COLUMN IF NOT EXISTS warehouse_id uuid REFERENCES public.warehouses(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS session_id uuid REFERENCES public.pos_sessions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS return_number text,
  ADD COLUMN IF NOT EXISTS return_date timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS subtotal numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tax numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS refund_method public.payment_method NOT NULL DEFAULT 'cash',
  ADD COLUMN IF NOT EXISTS reason text,
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS journal_entry_id uuid REFERENCES public.journal_entries(id) ON DELETE SET NULL;

UPDATE public.sales_returns sr
SET session_id = si.session_id
FROM public.sales_invoices si
WHERE sr.original_invoice_id = si.id
  AND sr.session_id IS NULL
  AND si.session_id IS NOT NULL;

UPDATE public.sales_invoices
SET total = ROUND(COALESCE(subtotal, 0), 2),
    paid = LEAST(GREATEST(COALESCE(paid, 0), 0), ROUND(COALESCE(subtotal, 0), 2)),
    remaining = GREATEST(
      ROUND(COALESCE(subtotal, 0), 2)
      - LEAST(GREATEST(COALESCE(paid, 0), 0), ROUND(COALESCE(subtotal, 0), 2)),
      0
    )
WHERE total = 0
  AND COALESCE(discount, 0) = 0
  AND COALESCE(tax, 0) = 0
  AND status <> 'voided';

UPDATE public.pos_sessions ps
SET total_sales = COALESCE((
      SELECT SUM(si.total)
      FROM public.sales_invoices si
      WHERE si.session_id = ps.id
        AND si.status <> 'voided'
    ), 0),
    total_returns = COALESCE((
      SELECT SUM(sr.total)
      FROM public.sales_returns sr
      WHERE sr.session_id = ps.id
    ), 0);

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
  p_notes text DEFAULT NULL,
  p_tax numeric DEFAULT 0,
  p_discount numeric DEFAULT 0,
  p_discount_type text DEFAULT 'percent',
  p_payments jsonb DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_invoice_id uuid;
  v_invoice_num text;
  v_item jsonb;
  v_subtotal numeric := 0;
  v_discount numeric := 0;
  v_after_disc numeric := 0;
  v_tax_amt numeric := 0;
  v_final numeric := 0;
  v_remaining numeric := 0;
  v_status public.invoice_status;
  v_payment jsonb;
  v_product_id uuid;
  v_quantity numeric;
  v_unit_price numeric;
  v_unit_cost numeric;
  v_sale_unit text;
  v_is_bundle boolean;
  v_comp record;
  v_pick record;
  v_bundle_qty numeric;
  v_payment_total numeric := 0;
  v_credit_amount numeric := 0;
BEGIN
  IF p_items IS NULL OR jsonb_typeof(p_items) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'At least one invoice item is required';
  END IF;
  IF p_method IS NULL OR p_tax_inclusive IS NULL THEN
    RAISE EXCEPTION 'Payment method and tax mode are required';
  END IF;
  IF p_method = 'credit' AND p_customer IS NULL THEN
    RAISE EXCEPTION 'A customer is required for credit invoices';
  END IF;

  v_invoice_num := public.generate_invoice_number(p_company);

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_quantity := COALESCE(NULLIF(v_item->>'quantity', '')::numeric, 0);
    v_unit_price := COALESCE(NULLIF(v_item->>'unit_price', '')::numeric, 0);
    IF v_quantity <= 0 OR v_unit_price < 0 THEN
      RAISE EXCEPTION 'Invoice items require a positive quantity and non-negative price';
    END IF;
    v_subtotal := v_subtotal + ROUND(v_quantity * v_unit_price, 2);
  END LOOP;
  v_subtotal := ROUND(v_subtotal, 2);

  IF p_discount_type = 'percent' THEN
    IF COALESCE(p_discount, 0) < 0 OR COALESCE(p_discount, 0) > 100 THEN
      RAISE EXCEPTION 'Percentage discount must be between 0 and 100';
    END IF;
    v_discount := ROUND(v_subtotal * COALESCE(p_discount, 0) / 100, 2);
  ELSIF p_discount_type = 'fixed' THEN
    IF COALESCE(p_discount, 0) < 0 THEN
      RAISE EXCEPTION 'Discount cannot be negative';
    END IF;
    v_discount := LEAST(ROUND(COALESCE(p_discount, 0), 2), v_subtotal);
  ELSE
    RAISE EXCEPTION 'Unsupported discount type: %', p_discount_type;
  END IF;

  v_after_disc := ROUND(v_subtotal - v_discount, 2);
  v_tax_amt := ROUND(COALESCE(p_tax, 0), 2);
  IF v_tax_amt < 0 THEN
    RAISE EXCEPTION 'Tax cannot be negative';
  END IF;
  v_final := ROUND(v_after_disc + CASE WHEN p_tax_inclusive THEN 0 ELSE v_tax_amt END, 2);

  IF p_method = 'mixed' THEN
    IF p_payments IS NULL OR jsonb_typeof(p_payments) IS DISTINCT FROM 'array'
       OR jsonb_array_length(p_payments) < 2 THEN
      RAISE EXCEPTION 'Mixed payment requires at least two payment methods';
    END IF;
    SELECT COALESCE(SUM(NULLIF(payment->>'amount', '')::numeric), 0)
      INTO v_payment_total
    FROM jsonb_array_elements(p_payments) AS payment;
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_payments) AS payment
      WHERE COALESCE(NULLIF(payment->>'amount', '')::numeric, 0) <= 0
         OR NULLIF(payment->>'method', '') IS NULL
         OR lower(payment->>'method') NOT IN ('cash', 'card', 'wallet', 'bank', 'credit')
    ) OR ABS(v_payment_total - v_final) > 0.01 THEN
      RAISE EXCEPTION 'Mixed payment amounts must be positive and equal the invoice total';
    END IF;
    SELECT COALESCE(SUM(NULLIF(payment->>'amount', '')::numeric), 0)
      INTO v_credit_amount
    FROM jsonb_array_elements(p_payments) AS payment
    WHERE lower(payment->>'method') = 'credit';
    IF v_credit_amount > 0 AND p_customer IS NULL THEN
      RAISE EXCEPTION 'A customer is required when a mixed payment includes credit';
    END IF;
    p_paid := ROUND(v_payment_total - v_credit_amount, 2);
  ELSE
    p_paid := LEAST(GREATEST(ROUND(COALESCE(p_paid, 0), 2), 0), v_final);
    IF v_final - p_paid <= 0.01 THEN
      p_paid := v_final;
    END IF;
  END IF;

  v_remaining := GREATEST(ROUND(v_final - p_paid, 2), 0);
  IF v_remaining = 0 THEN
    v_status := 'paid';
  ELSIF p_paid > 0 THEN
    v_status := 'partial';
  ELSE
    v_status := 'credit';
  END IF;

  INSERT INTO public.sales_invoices (
    company_id, branch_id, warehouse_id, register_id, session_id,
    customer_id, invoice_number, invoice_date, subtotal, discount, tax,
    total, paid, remaining, payment_method, status, notes, created_by,
    tax_inclusive
  ) VALUES (
    p_company, p_branch, p_warehouse, p_register, p_session,
    p_customer, v_invoice_num, now(), v_subtotal, v_discount, v_tax_amt,
    v_final, p_paid, v_remaining, p_method, v_status, p_notes, auth.uid(),
    p_tax_inclusive
  ) RETURNING id INTO v_invoice_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_product_id := NULLIF(v_item->>'product_id', '')::uuid;
    v_quantity := COALESCE(NULLIF(v_item->>'quantity', '')::numeric, 1);
    v_unit_price := COALESCE(NULLIF(v_item->>'unit_price', '')::numeric, 0);
    v_unit_cost := COALESCE(NULLIF(v_item->>'unit_cost', '')::numeric, 0);
    v_sale_unit := COALESCE(v_item->>'sale_unit', 'piece');

    IF v_product_id IS NULL THEN
      RAISE EXCEPTION 'Invoice item requires a product';
    END IF;

    SELECT is_bundle INTO v_is_bundle
    FROM public.products WHERE id = v_product_id;

    IF v_is_bundle THEN
      INSERT INTO public.sales_invoice_items (
        invoice_id, product_id, quantity, unit_price, unit_cost,
        discount, sale_unit, base_qty
      ) VALUES (
        v_invoice_id, v_product_id, v_quantity, v_unit_price, v_unit_cost,
        0, v_sale_unit, v_quantity
      );

      FOR v_comp IN
        SELECT component_product_id, quantity AS qty_per_bundle
        FROM public.bundle_items WHERE bundle_product_id = v_product_id
      LOOP
        v_bundle_qty := v_comp.qty_per_bundle * v_quantity;
        FOR v_pick IN SELECT * FROM public.pick_stock_fefo(
          p_company, p_branch, p_warehouse, v_comp.component_product_id, v_bundle_qty
        ) LOOP
          INSERT INTO public.inventory_movements (
            company_id, branch_id, warehouse_id, product_id, lot_id,
            movement_type, quantity, unit_cost, reference_type, reference_id, created_by
          ) VALUES (
            p_company, p_branch, p_warehouse, v_comp.component_product_id, v_pick.lot_id,
            'out', v_pick.take_qty, v_pick.unit_cost, 'sales_invoice', v_invoice_id, auth.uid()
          );
          UPDATE public.stock_lots
          SET quantity_left = quantity_left - v_pick.take_qty, updated_at = now()
          WHERE id = v_pick.lot_id;
        END LOOP;
      END LOOP;
    ELSE
      FOR v_pick IN SELECT * FROM public.pick_stock_fefo(
        p_company, p_branch, p_warehouse, v_product_id, v_quantity
      ) LOOP
        INSERT INTO public.sales_invoice_items (
          invoice_id, product_id, lot_id, quantity, unit_price, unit_cost,
          discount, sale_unit, base_qty
        ) VALUES (
          v_invoice_id, v_product_id, v_pick.lot_id, v_pick.take_qty,
          v_unit_price, COALESCE(v_pick.unit_cost, v_unit_cost),
          0, v_sale_unit, v_pick.take_qty
        );
        INSERT INTO public.inventory_movements (
          company_id, branch_id, warehouse_id, product_id, lot_id,
          movement_type, quantity, unit_cost, reference_type, reference_id, created_by
        ) VALUES (
          p_company, p_branch, p_warehouse, v_product_id, v_pick.lot_id,
          'out', v_pick.take_qty, COALESCE(v_pick.unit_cost, v_unit_cost),
          'sales_invoice', v_invoice_id, auth.uid()
        );
        UPDATE public.stock_lots
        SET quantity_left = quantity_left - v_pick.take_qty, updated_at = now()
        WHERE id = v_pick.lot_id;
      END LOOP;
    END IF;
  END LOOP;

  IF p_method = 'mixed' THEN
    FOR v_payment IN SELECT * FROM jsonb_array_elements(p_payments) LOOP
      INSERT INTO public.invoice_payments (invoice_id, method, payment_method, amount)
      VALUES (
        v_invoice_id,
        (v_payment->>'method')::public.payment_method,
        v_payment->>'method',
        ROUND((v_payment->>'amount')::numeric, 2)
      );
      IF lower(v_payment->>'method') = 'cash' THEN
        INSERT INTO public.cash_movements (
          company_id, branch_id, session_id, movement_type, direction,
          amount, payment_method, reference_type, reference_id, description, created_by
        ) VALUES (
          p_company, p_branch, p_session, 'sale', 'in',
          ROUND((v_payment->>'amount')::numeric, 2), 'cash',
          'sales_invoice', v_invoice_id, 'بيع نقدي - ' || v_invoice_num, auth.uid()
        );
      END IF;
    END LOOP;
  ELSE
    IF p_paid > 0 THEN
      INSERT INTO public.invoice_payments (invoice_id, method, payment_method, amount)
      VALUES (v_invoice_id, p_method, p_method::text, p_paid);
    END IF;
    IF p_method = 'cash' AND p_paid > 0 THEN
      INSERT INTO public.cash_movements (
        company_id, branch_id, session_id, movement_type, direction,
        amount, payment_method, reference_type, reference_id, description, created_by
      ) VALUES (
        p_company, p_branch, p_session, 'sale', 'in',
        p_paid, 'cash', 'sales_invoice', v_invoice_id,
        'بيع نقدي - ' || v_invoice_num, auth.uid()
      );
    END IF;
  END IF;

  IF p_session IS NOT NULL THEN
    UPDATE public.pos_sessions
    SET total_sales = COALESCE(total_sales, 0) + v_final
    WHERE id = p_session;
  END IF;

  RETURN v_invoice_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_invoice_v3(
  p_company uuid,
  p_branch uuid,
  p_warehouse uuid,
  p_register uuid,
  p_session uuid,
  p_customer uuid,
  p_items jsonb,
  p_method public.payment_method,
  p_paid numeric,
  p_notes text DEFAULT NULL,
  p_tax numeric DEFAULT 0,
  p_discount numeric DEFAULT 0,
  p_discount_type text DEFAULT 'percent',
  p_payments jsonb DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  RETURN public.record_invoice_v3(
    p_company, p_branch, p_warehouse, p_register, p_session, p_customer,
    p_items, p_method, false, p_paid, p_notes, p_tax, p_discount,
    p_discount_type, p_payments
  );
END;
$$;

INSERT INTO public.chart_of_accounts (company_id, code, name_ar, name_en, account_type, is_postable, is_system)
SELECT c.id, accounts.code, accounts.name_ar, accounts.name_en, 'asset', true, true
FROM public.companies c
CROSS JOIN (VALUES
  ('1102', 'تسويات بطاقات', 'Card Clearing'),
  ('1103', 'محافظ إلكترونية', 'E-Wallets'),
  ('1104', 'حسابات بنكية', 'Bank Accounts'),
  ('4300', 'مردودات ومسموحات المبيعات', 'Sales Returns and Allowances')
) AS accounts(code, name_ar, name_en)
ON CONFLICT (company_id, code) DO NOTHING;

CREATE OR REPLACE FUNCTION public.generate_invoice_journal_entry_v2(p_invoice_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_inv public.sales_invoices%ROWTYPE;
  v_entry_id uuid;
  v_entry_num text;
  v_seq integer;
  v_subtotal numeric;
  v_discount numeric;
  v_tax numeric;
  v_total numeric;
  v_paid numeric;
  v_remaining numeric;
  v_cogs numeric := 0;
  v_tax_before_discount numeric := 0;
  v_discount_posting numeric := 0;
  v_sales_credit numeric := 0;
  v_method text;
  v_payment_row record;
  v_method_account uuid;
  v_ar_account uuid;
  v_cash_account uuid;
  v_card_account uuid;
  v_wallet_account uuid;
  v_bank_account uuid;
  v_sales_account uuid;
  v_discount_account uuid;
  v_vat_account uuid;
  v_cogs_account uuid;
  v_inv_account uuid;
BEGIN
  SELECT * INTO v_inv FROM public.sales_invoices WHERE id = p_invoice_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'الفاتورة غير موجودة: %', p_invoice_id;
  END IF;
  IF v_inv.journal_entry_id IS NOT NULL THEN
    RETURN v_inv.journal_entry_id;
  END IF;
  IF v_inv.status IN ('voided', 'draft') THEN
    RAISE EXCEPTION 'لا يمكن إنشاء قيد لفاتورة في حالة %', v_inv.status;
  END IF;

  SELECT id INTO v_ar_account FROM public.chart_of_accounts WHERE company_id = v_inv.company_id AND code = '1200' LIMIT 1;
  SELECT id INTO v_cash_account FROM public.chart_of_accounts WHERE company_id = v_inv.company_id AND code = '1101' LIMIT 1;
  SELECT id INTO v_card_account FROM public.chart_of_accounts WHERE company_id = v_inv.company_id AND code = '1102' LIMIT 1;
  SELECT id INTO v_wallet_account FROM public.chart_of_accounts WHERE company_id = v_inv.company_id AND code = '1103' LIMIT 1;
  SELECT id INTO v_bank_account FROM public.chart_of_accounts WHERE company_id = v_inv.company_id AND code = '1104' LIMIT 1;
  SELECT id INTO v_sales_account FROM public.chart_of_accounts WHERE company_id = v_inv.company_id AND code = '4100' LIMIT 1;
  SELECT id INTO v_discount_account FROM public.chart_of_accounts WHERE company_id = v_inv.company_id AND code = '4200' LIMIT 1;
  SELECT id INTO v_vat_account FROM public.chart_of_accounts WHERE company_id = v_inv.company_id AND code = '2200' LIMIT 1;
  SELECT id INTO v_cogs_account FROM public.chart_of_accounts WHERE company_id = v_inv.company_id AND code = '5100' LIMIT 1;
  SELECT id INTO v_inv_account FROM public.chart_of_accounts WHERE company_id = v_inv.company_id AND code = '1300' LIMIT 1;

  IF v_ar_account IS NULL OR v_sales_account IS NULL THEN
    RAISE EXCEPTION 'الحسابات الأساسية غير موجودة (1200, 4100)';
  END IF;

  v_subtotal := ROUND(COALESCE(v_inv.subtotal, 0), 2);
  v_discount := ROUND(COALESCE(v_inv.discount, 0), 2);
  v_tax := ROUND(COALESCE(v_inv.tax, 0), 2);
  v_total := ROUND(COALESCE(v_inv.total, 0), 2);
  v_paid := ROUND(COALESCE(v_inv.paid, 0), 2);
  v_remaining := ROUND(COALESCE(v_inv.remaining, v_total - v_paid), 2);
  v_method := COALESCE(v_inv.payment_method::text, 'cash');

  IF v_discount > 0 AND NOT COALESCE(v_inv.tax_inclusive, false) AND v_discount_account IS NULL THEN
    RAISE EXCEPTION 'حساب الخصومات غير موجود (4200)';
  END IF;
  IF v_tax > 0 AND v_vat_account IS NULL THEN
    RAISE EXCEPTION 'حساب الضريبة غير موجود (2200)';
  END IF;

  SELECT COALESCE(SUM(sii.quantity * COALESCE(sii.unit_cost, 0)), 0)
  INTO v_cogs
  FROM public.sales_invoice_items sii
  WHERE sii.invoice_id = p_invoice_id;

  IF COALESCE(v_inv.tax_inclusive, false) THEN
    v_tax_before_discount := CASE
      WHEN v_total > 0 THEN ROUND(v_tax * (v_subtotal / v_total), 2)
      ELSE 0
    END;
    v_sales_credit := ROUND(v_subtotal - v_tax_before_discount, 2);
    v_discount_posting := GREATEST(ROUND(v_discount - (v_tax_before_discount - v_tax), 2), 0);
  ELSE
    v_sales_credit := v_subtotal;
    v_discount_posting := v_discount;
  END IF;

  SELECT COALESCE(MAX(SUBSTRING(entry_number FROM '[0-9]+$')::integer), 0) + 1
  INTO v_seq
  FROM public.journal_entries
  WHERE company_id = v_inv.company_id AND entry_number LIKE 'JE-%';
  v_entry_num := 'JE-' || TO_CHAR(NOW(), 'YYYY') || '-' || LPAD(v_seq::text, 5, '0');
  v_entry_id := gen_random_uuid();

  INSERT INTO public.journal_entries (
    id, company_id, branch_id, entry_number, entry_date, posting_date,
    description, reference_type, reference_id, status, is_auto, created_by
  ) VALUES (
    v_entry_id, v_inv.company_id, v_inv.branch_id, v_entry_num,
    v_inv.invoice_date, CURRENT_DATE,
    'قيد فاتورة بيع #' || v_inv.invoice_number || ' — ' || COALESCE(v_inv.notes, ''),
    'sales_invoice', p_invoice_id, 'posted', true, v_inv.created_by
  );

  IF v_remaining > 0 THEN
    INSERT INTO public.journal_entry_lines (entry_id, account_id, debit, credit, description)
    VALUES (v_entry_id, v_ar_account, v_remaining, 0, 'مديونية عميل — فاتورة #' || v_inv.invoice_number);
  END IF;
  FOR v_payment_row IN
    SELECT lower(payment_method) AS method, ROUND(SUM(amount), 2) AS amount
    FROM public.invoice_payments
    WHERE invoice_id = p_invoice_id
      AND lower(payment_method) <> 'credit'
    GROUP BY lower(payment_method)
  LOOP
    v_method_account := CASE v_payment_row.method
      WHEN 'cash' THEN v_cash_account
      WHEN 'card' THEN v_card_account
      WHEN 'wallet' THEN v_wallet_account
      WHEN 'bank' THEN v_bank_account
      WHEN 'credit' THEN v_ar_account
      ELSE NULL
    END;
    IF v_method_account IS NULL THEN
      RAISE EXCEPTION 'حساب وسيلة الدفع غير موجود أو غير مدعوم: %', v_payment_row.method;
    END IF;
    INSERT INTO public.journal_entry_lines (entry_id, account_id, debit, credit, description)
    VALUES (v_entry_id, v_method_account, v_payment_row.amount, 0,
      'تحصيل — ' || v_payment_row.method || ' — فاتورة #' || v_inv.invoice_number);
  END LOOP;
  IF v_paid > 0 AND NOT EXISTS (
    SELECT 1 FROM public.invoice_payments WHERE invoice_id = p_invoice_id
  ) THEN
    v_method_account := CASE v_method
      WHEN 'cash' THEN v_cash_account
      WHEN 'card' THEN v_card_account
      WHEN 'wallet' THEN v_wallet_account
      WHEN 'bank' THEN v_bank_account
      WHEN 'credit' THEN v_ar_account
      ELSE NULL
    END;
    IF v_method_account IS NULL THEN
      RAISE EXCEPTION 'حساب وسيلة الدفع غير موجود أو غير مدعوم: %', v_method;
    END IF;
    INSERT INTO public.journal_entry_lines (entry_id, account_id, debit, credit, description)
    VALUES (v_entry_id, v_method_account, v_paid, 0,
      'تحصيل — ' || v_method || ' — فاتورة #' || v_inv.invoice_number);
  END IF;
  IF v_sales_credit > 0 THEN
    INSERT INTO public.journal_entry_lines (entry_id, account_id, debit, credit, description)
    VALUES (v_entry_id, v_sales_account, 0, v_sales_credit, 'إيراد مبيعات — فاتورة #' || v_inv.invoice_number);
  END IF;
  IF v_discount_posting > 0 THEN
    IF v_discount_account IS NULL THEN
      RAISE EXCEPTION 'حساب الخصومات غير موجود (4200)';
    END IF;
    INSERT INTO public.journal_entry_lines (entry_id, account_id, debit, credit, description)
    VALUES (v_entry_id, v_discount_account, v_discount_posting, 0, 'خصم مبيعات — فاتورة #' || v_inv.invoice_number);
  END IF;
  IF v_tax > 0 THEN
    INSERT INTO public.journal_entry_lines (entry_id, account_id, debit, credit, description)
    VALUES (v_entry_id, v_vat_account, 0, v_tax, 'ضريبة قيمة مضافة — فاتورة #' || v_inv.invoice_number);
  END IF;
  IF v_cogs > 0 AND v_cogs_account IS NOT NULL AND v_inv_account IS NOT NULL THEN
    INSERT INTO public.journal_entry_lines (entry_id, account_id, debit, credit, description)
    VALUES (v_entry_id, v_cogs_account, v_cogs, 0, 'تكلفة بضاعة مباعة — فاتورة #' || v_inv.invoice_number);
    INSERT INTO public.journal_entry_lines (entry_id, account_id, debit, credit, description)
    VALUES (v_entry_id, v_inv_account, 0, v_cogs, 'خصم مخزون — فاتورة #' || v_inv.invoice_number);
  END IF;

  UPDATE public.sales_invoices SET journal_entry_id = v_entry_id WHERE id = p_invoice_id;
  RETURN v_entry_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.generate_sales_return_journal_entry_v1(p_return_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_return public.sales_returns%ROWTYPE;
  v_invoice public.sales_invoices%ROWTYPE;
  v_entry_id uuid;
  v_entry_num text;
  v_seq integer;
  v_base numeric;
  v_tax numeric;
  v_total numeric;
  v_cogs numeric := 0;
  v_return_account uuid;
  v_refund_account uuid;
  v_tax_account uuid;
  v_cogs_account uuid;
  v_inventory_account uuid;
BEGIN
  SELECT * INTO v_return
  FROM public.sales_returns
  WHERE id = p_return_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'مرتجع المبيعات غير موجود: %', p_return_id;
  END IF;
  IF v_return.journal_entry_id IS NOT NULL THEN
    RETURN v_return.journal_entry_id;
  END IF;

  SELECT * INTO v_invoice
  FROM public.sales_invoices
  WHERE id = v_return.original_invoice_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'الفاتورة الأصلية للمرتجع غير موجودة';
  END IF;

  v_total := ROUND(COALESCE(v_return.total, 0), 2);
  v_tax := ROUND(COALESCE(v_return.tax, 0), 2);
  v_base := CASE
    WHEN COALESCE(v_invoice.tax_inclusive, false)
      THEN ROUND(COALESCE(v_return.subtotal, 0) - COALESCE(v_return.discount, 0) - v_tax, 2)
    ELSE ROUND(COALESCE(v_return.subtotal, 0) - COALESCE(v_return.discount, 0), 2)
  END;
  IF v_total <= 0 THEN
    RETURN NULL;
  END IF;

  SELECT id INTO v_return_account
  FROM public.chart_of_accounts
  WHERE company_id = v_return.company_id AND code = '4300'
  LIMIT 1;
  SELECT id INTO v_tax_account
  FROM public.chart_of_accounts
  WHERE company_id = v_return.company_id AND code = '2200'
  LIMIT 1;
  v_refund_account := CASE v_return.refund_method::text
    WHEN 'cash' THEN (SELECT id FROM public.chart_of_accounts WHERE company_id = v_return.company_id AND code = '1101' LIMIT 1)
    WHEN 'card' THEN (SELECT id FROM public.chart_of_accounts WHERE company_id = v_return.company_id AND code = '1102' LIMIT 1)
    WHEN 'wallet' THEN (SELECT id FROM public.chart_of_accounts WHERE company_id = v_return.company_id AND code = '1103' LIMIT 1)
    WHEN 'bank' THEN (SELECT id FROM public.chart_of_accounts WHERE company_id = v_return.company_id AND code = '1104' LIMIT 1)
    WHEN 'credit' THEN (SELECT id FROM public.chart_of_accounts WHERE company_id = v_return.company_id AND code = '1200' LIMIT 1)
    ELSE NULL
  END;
  SELECT id INTO v_cogs_account
  FROM public.chart_of_accounts
  WHERE company_id = v_return.company_id AND code = '5100'
  LIMIT 1;
  SELECT id INTO v_inventory_account
  FROM public.chart_of_accounts
  WHERE company_id = v_return.company_id AND code = '1300'
  LIMIT 1;

  IF v_return_account IS NULL OR v_refund_account IS NULL THEN
    RAISE EXCEPTION 'حساب المردودات أو حساب وسيلة الاسترداد غير موجود';
  END IF;
  IF v_tax > 0 AND v_tax_account IS NULL THEN
    RAISE EXCEPTION 'حساب الضريبة غير موجود (2200)';
  END IF;

  SELECT COALESCE(SUM(sri.quantity * COALESCE(cost.average_cost, 0)), 0)
  INTO v_cogs
  FROM public.sales_return_items sri
  LEFT JOIN LATERAL (
    SELECT SUM(sii.quantity * COALESCE(sii.unit_cost, 0))
      / NULLIF(SUM(sii.quantity), 0) AS average_cost
    FROM public.sales_invoice_items sii
    WHERE sii.invoice_id = v_return.original_invoice_id
      AND sii.product_id = sri.product_id
      AND sii.lot_id IS NOT DISTINCT FROM sri.lot_id
  ) cost ON true
  WHERE sri.return_id = p_return_id;

  IF v_cogs > 0 AND ((v_cogs_account IS NULL) <> (v_inventory_account IS NULL)) THEN
    RAISE EXCEPTION 'حساب تكلفة البضاعة أو المخزون غير موجود';
  END IF;

  SELECT COALESCE(MAX(SUBSTRING(entry_number FROM '[0-9]+$')::integer), 0) + 1
  INTO v_seq
  FROM public.journal_entries
  WHERE company_id = v_return.company_id AND entry_number LIKE 'JE-%';
  v_entry_num := 'JE-' || TO_CHAR(NOW(), 'YYYY') || '-' || LPAD(v_seq::text, 5, '0');
  v_entry_id := gen_random_uuid();

  INSERT INTO public.journal_entries (
    id, company_id, branch_id, entry_number, entry_date, posting_date,
    description, reference_type, reference_id, status, is_auto, created_by,
    posted_by, posted_at
  ) VALUES (
    v_entry_id, v_return.company_id, v_return.branch_id, v_entry_num,
    COALESCE(v_return.return_date::date, CURRENT_DATE), CURRENT_DATE,
    'قيد مرتجع #' || v_return.return_number || ' — فاتورة #' || v_invoice.invoice_number,
    'sales_return', p_return_id, 'posted', true, v_return.created_by,
    auth.uid(), now()
  );

  IF v_base > 0 THEN
    INSERT INTO public.journal_entry_lines (entry_id, account_id, debit, credit, description)
    VALUES (v_entry_id, v_return_account, v_base, 0, 'مردودات مبيعات — ' || v_return.return_number);
  END IF;
  IF v_tax > 0 THEN
    INSERT INTO public.journal_entry_lines (entry_id, account_id, debit, credit, description)
    VALUES (v_entry_id, v_tax_account, v_tax, 0, 'عكس ضريبة مبيعات — ' || v_return.return_number);
  END IF;
  INSERT INTO public.journal_entry_lines (entry_id, account_id, debit, credit, description)
  VALUES (v_entry_id, v_refund_account, 0, v_total, 'استرداد — ' || v_return.refund_method::text || ' — ' || v_return.return_number);

  IF v_cogs > 0 AND v_cogs_account IS NOT NULL AND v_inventory_account IS NOT NULL THEN
    INSERT INTO public.journal_entry_lines (entry_id, account_id, debit, credit, description)
    VALUES (v_entry_id, v_inventory_account, v_cogs, 0, 'إعادة مخزون — ' || v_return.return_number);
    INSERT INTO public.journal_entry_lines (entry_id, account_id, debit, credit, description)
    VALUES (v_entry_id, v_cogs_account, 0, v_cogs, 'عكس تكلفة بضاعة مباعة — ' || v_return.return_number);
  END IF;

  UPDATE public.sales_returns SET journal_entry_id = v_entry_id WHERE id = p_return_id;
  RETURN v_entry_id;
END;
$$;

DO $$
BEGIN
  IF to_regprocedure('public.record_return_unaccounted(uuid,uuid,uuid,jsonb,public.payment_method,text)') IS NULL
     AND to_regprocedure('public.record_return(uuid,uuid,uuid,jsonb,public.payment_method,text)') IS NOT NULL THEN
    EXECUTE 'ALTER FUNCTION public.record_return(uuid, uuid, uuid, jsonb, public.payment_method, text) RENAME TO record_return_unaccounted';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_return(
  p_company uuid,
  p_branch uuid,
  p_original_invoice uuid,
  p_items jsonb,
  p_refund_method public.payment_method,
  p_reason text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_return_id uuid;
  v_return public.sales_returns%ROWTYPE;
  v_invoice public.sales_invoices%ROWTYPE;
  v_original_total numeric;
  v_ratio numeric;
  v_discount numeric;
  v_tax numeric;
  v_new_total numeric;
BEGIN
  v_return_id := public.record_return_unaccounted(
    p_company, p_branch, p_original_invoice, p_items, p_refund_method, p_reason
  );

  SELECT * INTO v_return
  FROM public.sales_returns WHERE id = v_return_id;
  SELECT * INTO v_invoice
  FROM public.sales_invoices WHERE id = p_original_invoice;
  v_original_total := COALESCE(v_return.total, 0);

  IF COALESCE(v_invoice.subtotal, 0) <= 0 THEN
    RAISE EXCEPTION 'لا يمكن توزيع الخصم والضريبة: إجمالي الفاتورة الأصلية غير صالح';
  END IF;
  v_ratio := LEAST(v_original_total / v_invoice.subtotal, 1);
  v_discount := ROUND(COALESCE(v_invoice.discount, 0) * v_ratio, 2);
  v_tax := ROUND(COALESCE(v_invoice.tax, 0) * v_ratio, 2);
  v_new_total := CASE
    WHEN COALESCE(v_invoice.tax_inclusive, false)
      THEN ROUND(v_original_total - v_discount, 2)
    ELSE ROUND(v_original_total - v_discount + v_tax, 2)
  END;
  IF v_new_total < 0 THEN
    RAISE EXCEPTION 'قيمة المرتجع المحسوبة غير صالحة';
  END IF;

  UPDATE public.sales_returns
  SET discount = v_discount, tax = v_tax, total = v_new_total
  WHERE id = v_return_id;

  IF p_refund_method = 'cash' THEN
    UPDATE public.cash_movements
    SET amount = v_new_total
    WHERE reference_type = 'sales_return'
      AND reference_id = v_return_id
      AND movement_type = 'return';
  END IF;
  IF v_return.session_id IS NOT NULL THEN
    UPDATE public.pos_sessions ps
    SET total_returns = COALESCE((
      SELECT SUM(sr.total) FROM public.sales_returns sr WHERE sr.session_id = ps.id
    ), 0)
    WHERE ps.id = v_return.session_id;
  END IF;

  PERFORM public.generate_sales_return_journal_entry_v1(v_return_id);
  RETURN v_return_id;
END;
$$;

DO $$
DECLARE
  v_return_id uuid;
BEGIN
  FOR v_return_id IN
    SELECT id FROM public.sales_returns
    WHERE total > 0 AND journal_entry_id IS NULL
    ORDER BY created_at, id
  LOOP
    PERFORM public.generate_sales_return_journal_entry_v1(v_return_id);
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.generate_sales_return_journal_entry_v1(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_return_unaccounted(uuid, uuid, uuid, jsonb, public.payment_method, text) FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION public.record_return(uuid, uuid, uuid, jsonb, public.payment_method, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_return(uuid, uuid, uuid, jsonb, public.payment_method, text) TO authenticated;

REVOKE ALL ON FUNCTION public.record_invoice_v3(uuid, uuid, uuid, uuid, uuid, uuid, jsonb, public.payment_method, boolean, numeric, text, numeric, numeric, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_invoice_v3(uuid, uuid, uuid, uuid, uuid, uuid, jsonb, public.payment_method, boolean, numeric, text, numeric, numeric, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_invoice_v3(uuid, uuid, uuid, uuid, uuid, uuid, jsonb, public.payment_method, numeric, text, numeric, numeric, text, jsonb) TO authenticated;

COMMIT;