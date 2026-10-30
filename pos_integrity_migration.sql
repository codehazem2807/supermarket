BEGIN;

ALTER TABLE public.audit_log
  ADD COLUMN IF NOT EXISTS user_name text;

ALTER TABLE public.pos_sessions
  ADD COLUMN IF NOT EXISTS opening_cash numeric(14,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS closing_cash numeric(14,2),
  ADD COLUMN IF NOT EXISTS expected_cash numeric(14,2),
  ADD COLUMN IF NOT EXISTS counted_cash numeric(14,2),
  ADD COLUMN IF NOT EXISTS actual_cash numeric(14,2),
  ADD COLUMN IF NOT EXISTS difference numeric(14,2),
  ADD COLUMN IF NOT EXISTS total_sales numeric(14,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_returns numeric(14,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS opened_by uuid,
  ADD COLUMN IF NOT EXISTS closed_by uuid,
  ADD COLUMN IF NOT EXISTS opened_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS closed_at timestamptz;

ALTER TABLE public.cash_movements
  ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS description text;

DO $$
DECLARE
  v_source text;
BEGIN
  IF to_regclass('public.invoice_payments') IS NULL THEN
    RAISE EXCEPTION 'Table public.invoice_payments is missing';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'invoice_payments' AND column_name = 'payment_method'
  ) THEN
    RETURN;
  END IF;

  SELECT c.column_name INTO v_source
  FROM information_schema.columns c
  WHERE c.table_schema = 'public' AND c.table_name = 'invoice_payments'
    AND c.column_name IN ('method', 'payment_type', 'type')
  ORDER BY array_position(ARRAY['method', 'payment_type', 'type'], c.column_name::text)
  LIMIT 1;

  IF v_source IS NULL THEN
    ALTER TABLE public.invoice_payments ADD COLUMN payment_method text;
  ELSE
    ALTER TABLE public.invoice_payments ADD COLUMN payment_method text;
    EXECUTE format('UPDATE public.invoice_payments SET payment_method = %I::text', v_source);
    EXECUTE format(
      'CREATE FUNCTION public.invoice_payments_sync_method() RETURNS trigger LANGUAGE plpgsql AS $f$
       BEGIN NEW.payment_method := COALESCE(NEW.%1$I::text, NEW.payment_method); RETURN NEW; END $f$',
      v_source
    );
    CREATE TRIGGER trg_invoice_payments_sync_method
      BEFORE INSERT OR UPDATE ON public.invoice_payments
      FOR EACH ROW EXECUTE FUNCTION public.invoice_payments_sync_method();
  END IF;
END
$$;

ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS vendor_name text,
  ADD COLUMN IF NOT EXISTS reference_number text,
  ADD COLUMN IF NOT EXISTS status text DEFAULT 'paid';

CREATE OR REPLACE FUNCTION public.auth_permissions() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_user_permissions jsonb;
  v_role_permissions jsonb;
BEGIN
  SELECT u.permissions, r.permissions
    INTO v_user_permissions, v_role_permissions
  FROM public.users u
  LEFT JOIN public.roles r ON r.id = u.role_id
  WHERE u.id = auth.uid();

  IF jsonb_typeof(v_user_permissions) = 'array'
     AND jsonb_array_length(v_user_permissions) > 0 THEN
    RETURN v_user_permissions;
  END IF;

  RETURN COALESCE(v_role_permissions, '[]'::jsonb);
END
$$;

CREATE OR REPLACE VIEW public.v_stock_on_hand AS
SELECT company_id, branch_id, warehouse_id, product_id,
  SUM(quantity_left) AS on_hand
FROM public.stock_lots
WHERE is_quarantined = false
  AND quantity_left > 0
  AND (expiry_date IS NULL OR expiry_date >= current_date)
GROUP BY company_id, branch_id, warehouse_id, product_id;

DROP VIEW IF EXISTS public.v_stock_on_hand_all;
CREATE VIEW public.v_stock_on_hand_all AS
WITH product_stock AS (
  SELECT company_id, branch_id, warehouse_id, product_id,
    SUM(quantity_left) AS on_hand
  FROM public.stock_lots
  WHERE is_quarantined = false
    AND quantity_left > 0
    AND (expiry_date IS NULL OR expiry_date >= current_date)
  GROUP BY company_id, branch_id, warehouse_id, product_id
)
SELECT
  p.company_id,
  p.id AS product_id,
  p.name,
  p.is_bundle,
  p.base_unit,
  p.sale_unit,
  CASE
    WHEN p.is_bundle THEN COALESCE((
      SELECT MIN(FLOOR(COALESCE(cs.on_hand, 0) / NULLIF(bi.quantity, 0)))
      FROM public.bundle_items bi
      LEFT JOIN product_stock cs
        ON cs.company_id = p.company_id
        AND cs.branch_id IS NOT DISTINCT FROM w.branch_id
        AND cs.warehouse_id = w.id
        AND cs.product_id = bi.component_product_id
      WHERE bi.bundle_product_id = p.id
        AND bi.company_id = p.company_id
    ), 0)
    ELSE COALESCE(ps.on_hand, 0)
  END AS on_hand,
  w.branch_id,
  w.id AS warehouse_id,
  CASE
    WHEN p.is_bundle THEN COALESCE((
      SELECT MIN(FLOOR(COALESCE(cs.on_hand, 0) / NULLIF(bi.quantity, 0)))
      FROM public.bundle_items bi
      LEFT JOIN product_stock cs
        ON cs.company_id = p.company_id
        AND cs.branch_id IS NOT DISTINCT FROM w.branch_id
        AND cs.warehouse_id = w.id
        AND cs.product_id = bi.component_product_id
      WHERE bi.bundle_product_id = p.id
        AND bi.company_id = p.company_id
    ), 0)
    ELSE COALESCE(ps.on_hand, 0)
  END AS available
FROM public.products p
JOIN public.warehouses w ON w.company_id = p.company_id
LEFT JOIN product_stock ps
  ON ps.company_id = p.company_id
  AND ps.branch_id IS NOT DISTINCT FROM w.branch_id
  AND ps.warehouse_id = w.id
  AND ps.product_id = p.id
WHERE p.deleted_at IS NULL
  AND w.deleted_at IS NULL;

GRANT SELECT ON public.v_stock_on_hand_all TO authenticated;
DROP FUNCTION IF EXISTS public.get_products_stock_bulk(uuid);
CREATE FUNCTION public.get_products_stock_bulk(p_company_id uuid)
RETURNS TABLE(product_id uuid, on_hand numeric, is_bundle boolean)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT p.id AS product_id,
    COALESCE(SUM(v.on_hand), 0) AS on_hand,
    COALESCE(p.is_bundle, false) AS is_bundle
  FROM public.products p
  LEFT JOIN public.v_stock_on_hand_all v
    ON v.product_id = p.id AND v.company_id = p.company_id
  WHERE p.company_id = p_company_id
    AND p.deleted_at IS NULL
    AND p.is_active = true
  GROUP BY p.id, p.is_bundle;
$$;

DROP FUNCTION IF EXISTS public.pick_stock_fefo(uuid, uuid, uuid, uuid, numeric);
CREATE FUNCTION public.pick_stock_fefo(
  p_company uuid, p_branch uuid, p_warehouse uuid, p_product uuid, p_qty numeric
) RETURNS TABLE(lot_id uuid, lot_number text, take_qty numeric, unit_cost numeric, sale_price numeric, expiry_date date)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  r record;
  remaining numeric := p_qty;
  take numeric;
BEGIN
  IF p_qty IS NULL OR p_qty <= 0 THEN
    RAISE EXCEPTION 'Quantity must be greater than zero';
  END IF;

  FOR r IN
    SELECT sl.* FROM public.stock_lots sl
    WHERE sl.company_id = p_company
      AND sl.branch_id = p_branch
      AND sl.warehouse_id = p_warehouse
      AND sl.product_id = p_product
      AND sl.quantity_left > 0
      AND sl.is_quarantined = false
      AND (sl.expiry_date IS NULL OR sl.expiry_date >= current_date)
    ORDER BY sl.expiry_date ASC NULLS LAST, sl.received_at ASC
    FOR UPDATE
  LOOP
    EXIT WHEN remaining <= 0;
    take := LEAST(remaining, r.quantity_left);
    lot_id := r.id;
    lot_number := r.lot_number;
    take_qty := take;
    unit_cost := r.effective_unit_cost;
    sale_price := r.sale_price;
    expiry_date := r.expiry_date;
    remaining := remaining - take;
    RETURN NEXT;
  END LOOP;

  IF remaining > 0 THEN
    RAISE EXCEPTION 'Insufficient stock for product % (missing %)', p_product, remaining;
  END IF;
END
$$;

DROP FUNCTION IF EXISTS public.open_pos_session(uuid, uuid, uuid, uuid, numeric);
CREATE FUNCTION public.open_pos_session(
  p_company uuid, p_branch uuid, p_warehouse uuid, p_register uuid, p_opening_cash numeric
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_id uuid := gen_random_uuid();
BEGIN
  IF NOT auth_has_permission('session.use') THEN
    RAISE EXCEPTION 'Permission denied: session.use';
  END IF;
  IF NOT auth_is_platform_admin() AND p_company IS DISTINCT FROM auth_company_id() THEN
    RAISE EXCEPTION 'Permission denied for this company';
  END IF;
  IF p_opening_cash IS NULL OR p_opening_cash < 0 THEN
    RAISE EXCEPTION 'Opening cash must be zero or greater';
  END IF;
  IF p_register IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.registers r
    WHERE r.id = p_register AND r.company_id = p_company
      AND r.branch_id IS NOT DISTINCT FROM p_branch AND r.is_active = true
  ) THEN
    RAISE EXCEPTION 'Register does not belong to this branch';
  END IF;
  IF p_warehouse IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.warehouses w
    WHERE w.id = p_warehouse AND w.company_id = p_company
      AND w.branch_id IS NOT DISTINCT FROM p_branch
      AND w.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Warehouse does not belong to this branch';
  END IF;

  INSERT INTO public.pos_sessions(
    id, company_id, branch_id, warehouse_id, register_id, cashier_id,
    opened_by, opening_cash, status
  )
  VALUES (
    v_id, p_company, p_branch, p_warehouse, p_register, auth.uid(),
    auth.uid(), p_opening_cash, 'open'
  );
  RETURN v_id;
END
$$;

DROP FUNCTION IF EXISTS public.close_pos_session(uuid, numeric);
CREATE FUNCTION public.close_pos_session(p_session uuid, p_counted_cash numeric) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_company uuid;
  v_opening numeric;
  v_cash_sales numeric;
  v_other_movements numeric;
  v_expected numeric;
BEGIN
  IF NOT auth_has_permission('session.use') THEN
    RAISE EXCEPTION 'Permission denied: session.use';
  END IF;
  IF p_counted_cash IS NULL OR p_counted_cash < 0 THEN
    RAISE EXCEPTION 'Counted cash must be zero or greater';
  END IF;

  SELECT company_id, COALESCE(opening_cash, 0)
    INTO v_company, v_opening
  FROM public.pos_sessions
  WHERE id = p_session AND status = 'open'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Open POS session not found';
  END IF;
  IF NOT auth_is_platform_admin() AND v_company IS DISTINCT FROM auth_company_id() THEN
    RAISE EXCEPTION 'Permission denied for this company';
  END IF;

  SELECT COALESCE(SUM(cm.amount), 0)
  INTO v_cash_sales
  FROM public.cash_movements cm
  WHERE cm.session_id = p_session
    AND cm.movement_type = 'sale'
    AND cm.direction = 'in'
    AND COALESCE(lower(cm.payment_method::text), 'cash') = 'cash';

  SELECT COALESCE(SUM(
    CASE WHEN cm.direction = 'in' THEN cm.amount ELSE -cm.amount END
  ), 0)
  INTO v_other_movements
  FROM public.cash_movements cm
  WHERE cm.session_id = p_session
    AND cm.movement_type <> 'sale'
    AND COALESCE(cm.payment_method, 'cash') = 'cash';

  v_expected := ROUND(v_opening + v_cash_sales + v_other_movements, 2);

  UPDATE public.pos_sessions
  SET status = 'closed',
      closed_at = now(),
      closed_by = auth.uid(),
      expected_cash = v_expected,
      closing_cash = v_expected,
      counted_cash = p_counted_cash,
      actual_cash = p_counted_cash,
      difference = p_counted_cash - v_expected
  WHERE id = p_session;
END
$$;

CREATE OR REPLACE VIEW public.v_pos_session_summary AS
SELECT
  ps.id AS session_id,
  ps.company_id,
  ps.branch_id,
  ps.register_id,
  ps.status,
  ps.opening_cash,
  ps.total_sales,
  ps.total_returns,
  ps.total_sales - ps.total_returns AS net_sales,
  COALESCE(ps.opening_cash, 0) + COALESCE(cash_sales.amount, 0) +
    COALESCE(other_movements.amount, 0) AS expected_cash,
  ps.counted_cash,
  ps.difference,
  ps.opened_at,
  ps.closed_at
FROM public.pos_sessions ps
LEFT JOIN LATERAL (
  SELECT COALESCE(SUM(cm.amount), 0) AS amount
  FROM public.cash_movements cm
  WHERE cm.session_id = ps.id
    AND cm.movement_type = 'sale'
    AND cm.direction = 'in'
    AND COALESCE(lower(cm.payment_method::text), 'cash') = 'cash'
) cash_sales ON true
LEFT JOIN LATERAL (
  SELECT COALESCE(SUM(
    CASE WHEN cm.direction = 'in' THEN cm.amount ELSE -cm.amount END
  ), 0) AS amount
  FROM public.cash_movements cm
  WHERE cm.session_id = ps.id
    AND cm.movement_type <> 'sale'
    AND COALESCE(cm.payment_method, 'cash') = 'cash'
) other_movements ON true;

DROP FUNCTION IF EXISTS public.record_return(uuid, uuid, uuid, jsonb, public.payment_method, text);
CREATE FUNCTION public.record_return(
  p_company uuid,
  p_branch uuid,
  p_original_invoice uuid,
  p_items jsonb,
  p_refund_method public.payment_method,
  p_reason text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_id uuid := gen_random_uuid();
  v_invoice public.sales_invoices%ROWTYPE;
  v_item jsonb;
  v_product uuid;
  v_lot uuid;
  v_quantity numeric;
  v_unit_price numeric;
  v_sold_quantity numeric;
  v_returned_quantity numeric;
  v_total numeric := 0;
  v_return_number text;
  v_return_session uuid;
  v_open_session uuid;
  v_open_session_count integer := 0;
BEGIN
  IF NOT (
    auth_has_permission('pos.refund')
    OR auth_has_permission('pos.return')
    OR auth_has_permission('sales.full')
    OR auth_has_permission('sales.manage')
  ) THEN
    RAISE EXCEPTION 'Permission denied to record returns';
  END IF;
  IF NOT auth_is_platform_admin() AND p_company IS DISTINCT FROM auth_company_id() THEN
    RAISE EXCEPTION 'Permission denied for this company';
  END IF;
  SELECT * INTO v_invoice
  FROM public.sales_invoices si
  WHERE si.id = p_original_invoice
    AND si.company_id = p_company
    AND si.branch_id IS NOT DISTINCT FROM p_branch
    AND si.status <> 'voided'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice not found or cannot be returned';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Return items are required';
  END IF;
  IF jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Return items are required';
  END IF;
  IF NULLIF(trim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'A return reason is required';
  END IF;
  IF p_refund_method IS NULL THEN
    RAISE EXCEPTION 'A refund method is required';
  END IF;

  v_return_session := v_invoice.session_id;
  IF p_refund_method = 'cash' THEN
    FOR v_open_session IN
      SELECT ps.id
      FROM public.pos_sessions ps
      WHERE ps.company_id = p_company
        AND ps.branch_id IS NOT DISTINCT FROM p_branch
        AND ps.status = 'open'
      FOR UPDATE
    LOOP
      v_open_session_count := v_open_session_count + 1;
      v_return_session := v_open_session;
    END LOOP;
    IF v_open_session_count = 0 THEN
      RAISE EXCEPTION 'Open a POS session in this branch before issuing a cash refund';
    ELSIF v_open_session_count > 1 THEN
      RAISE EXCEPTION 'Multiple POS sessions are open in this branch; close all but the return register';
    END IF;
  END IF;

  v_return_number := 'RET-' || to_char(now(), 'YYYY') || '-' || substr(v_id::text, 1, 8);
  INSERT INTO public.sales_returns(
    id, company_id, branch_id, warehouse_id, session_id, customer_id,
    original_invoice_id, return_number, subtotal, total, refund_method,
    reason, created_by
  )
  VALUES (
    v_id, p_company, p_branch, v_invoice.warehouse_id, v_return_session,
    v_invoice.customer_id, p_original_invoice, v_return_number,
    0, 0, p_refund_method, trim(p_reason), auth.uid()
  );

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_product := NULLIF(v_item->>'product_id', '')::uuid;
    v_lot := NULLIF(v_item->>'lot_id', '')::uuid;
    v_quantity := NULLIF(v_item->>'quantity', '')::numeric;
    IF v_product IS NULL OR v_quantity IS NULL OR v_quantity <= 0 THEN
      RAISE EXCEPTION 'Each return item requires a product and positive quantity';
    END IF;

    SELECT COALESCE(SUM(sii.quantity), 0)
      INTO v_sold_quantity
    FROM public.sales_invoice_items sii
    WHERE sii.invoice_id = p_original_invoice
      AND sii.product_id = v_product
      AND sii.lot_id IS NOT DISTINCT FROM v_lot;
    IF v_sold_quantity <= 0 THEN
      RAISE EXCEPTION 'Product and lot were not sold on this invoice';
    END IF;

    SELECT COALESCE(SUM(sri.quantity), 0)
      INTO v_returned_quantity
    FROM public.sales_return_items sri
    JOIN public.sales_returns sr ON sr.id = sri.return_id
    WHERE sr.original_invoice_id = p_original_invoice
      AND sri.product_id = v_product
      AND sri.lot_id IS NOT DISTINCT FROM v_lot;
    IF v_returned_quantity + v_quantity > v_sold_quantity THEN
      RAISE EXCEPTION 'Return quantity exceeds the quantity sold';
    END IF;

    SELECT SUM(sii.quantity * sii.unit_price) / NULLIF(SUM(sii.quantity), 0)
      INTO v_unit_price
    FROM public.sales_invoice_items sii
    WHERE sii.invoice_id = p_original_invoice
      AND sii.product_id = v_product
      AND sii.lot_id IS NOT DISTINCT FROM v_lot
    ORDER BY sii.created_at, sii.id
    LIMIT 1;
    IF v_unit_price IS NULL THEN
      RAISE EXCEPTION 'Could not determine the original sale price';
    END IF;

    IF v_lot IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.stock_lots sl
      WHERE sl.id = v_lot
        AND sl.company_id = p_company
        AND sl.branch_id IS NOT DISTINCT FROM p_branch
        AND sl.product_id = v_product
        AND sl.warehouse_id IS NOT DISTINCT FROM v_invoice.warehouse_id
    ) THEN
      RAISE EXCEPTION 'Return lot does not belong to the original sale';
    END IF;

    INSERT INTO public.sales_return_items(return_id, product_id, lot_id, quantity, unit_price)
    VALUES (v_id, v_product, v_lot, v_quantity, v_unit_price);

    IF v_lot IS NOT NULL THEN
      UPDATE public.stock_lots
      SET quantity_left = quantity_left + v_quantity
      WHERE id = v_lot;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Return lot no longer exists';
      END IF;
    END IF;

    INSERT INTO public.inventory_movements(
      company_id, branch_id, warehouse_id, product_id, lot_id,
      movement_type, quantity, unit_cost, reference_type, reference_id,
      reason, created_by
    )
    SELECT p_company, p_branch, v_invoice.warehouse_id, v_product, v_lot,
      'return', v_quantity, COALESCE(sii.unit_cost, 0), 'sales_return', v_id,
      trim(p_reason), auth.uid()
    FROM public.sales_invoice_items sii
    WHERE sii.invoice_id = p_original_invoice
      AND sii.product_id = v_product
      AND sii.lot_id IS NOT DISTINCT FROM v_lot
    ORDER BY sii.created_at, sii.id
    LIMIT 1;

    v_total := v_total + ROUND(v_quantity * v_unit_price, 2);
  END LOOP;

  UPDATE public.sales_returns SET subtotal = v_total, total = v_total WHERE id = v_id;
  IF p_refund_method = 'cash' AND v_total > 0 THEN
    INSERT INTO public.cash_movements(
      company_id, branch_id, session_id, movement_type, direction, amount,
      payment_method, reference_type, reference_id, description, created_by
    )
    VALUES (
      p_company, p_branch, v_return_session, 'return', 'out', v_total,
      'cash', 'sales_return', v_id, 'رد نقدي ' || v_return_number, auth.uid()
    );
  END IF;
  UPDATE public.pos_sessions
  SET total_returns = COALESCE(total_returns, 0) + v_total
  WHERE id = v_return_session;

  IF NOT EXISTS (
    SELECT 1
    FROM (
      SELECT sii.product_id, sii.lot_id, SUM(sii.quantity) AS sold_quantity
      FROM public.sales_invoice_items sii
      WHERE sii.invoice_id = p_original_invoice
      GROUP BY sii.product_id, sii.lot_id
    ) sold
    WHERE sold.sold_quantity > COALESCE((
      SELECT SUM(sri.quantity)
      FROM public.sales_return_items sri
      JOIN public.sales_returns sr ON sr.id = sri.return_id
      WHERE sr.original_invoice_id = p_original_invoice
        AND sri.product_id = sold.product_id
        AND sri.lot_id IS NOT DISTINCT FROM sold.lot_id
    ), 0)
  ) THEN
    UPDATE public.sales_invoices SET status = 'returned' WHERE id = p_original_invoice;
  END IF;

  RETURN v_id;
END
$$;

DROP FUNCTION IF EXISTS public.void_invoice(uuid, text);
CREATE FUNCTION public.void_invoice(p_invoice uuid, p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_invoice public.sales_invoices%ROWTYPE;
  v_item record;
  v_cash_amount numeric := 0;
  v_expected_cash numeric := 0;
  v_current_session uuid;
  v_open_session uuid;
  v_open_session_count integer := 0;
BEGIN
  IF NOT (
    auth_has_permission('pos.void')
    OR auth_has_permission('pos.full')
    OR auth_has_permission('sales.void')
    OR auth_has_permission('sales.full')
    OR auth_has_permission('sales.manage')
  ) THEN
    RAISE EXCEPTION 'Permission denied to void invoices';
  END IF;
  SELECT * INTO v_invoice
  FROM public.sales_invoices si
  WHERE si.id = p_invoice AND si.status <> 'voided'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice not found or already voided';
  END IF;
  IF NOT auth_is_platform_admin() AND v_invoice.company_id IS DISTINCT FROM auth_company_id() THEN
    RAISE EXCEPTION 'Permission denied for this company';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.sales_returns WHERE original_invoice_id = p_invoice
  ) THEN
    RAISE EXCEPTION 'Invoices with recorded returns cannot be voided';
  END IF;
  IF NULLIF(trim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'A void reason is required';
  END IF;

  SELECT COALESCE(SUM(cm.amount), 0)
    INTO v_cash_amount
  FROM public.cash_movements cm
  WHERE cm.reference_type = 'sales_invoice'
    AND cm.reference_id = p_invoice
    AND cm.movement_type = 'sale'
    AND cm.direction = 'in'
    AND lower(COALESCE(cm.payment_method, '')) = 'cash';

  IF v_invoice.payment_method = 'cash' THEN
    v_expected_cash := LEAST(COALESCE(v_invoice.paid, 0), COALESCE(v_invoice.total, 0));
  ELSIF v_invoice.payment_method = 'mixed' THEN
    SELECT COALESCE(SUM(ip.amount), 0)
      INTO v_expected_cash
    FROM public.invoice_payments ip
    WHERE ip.invoice_id = p_invoice
      AND lower(ip.payment_method) = 'cash';
  END IF;
  IF v_expected_cash > 0 AND v_cash_amount <= 0 THEN
    RAISE EXCEPTION 'Cash movement is missing for this invoice; reconcile the drawer before voiding';
  END IF;

  IF v_cash_amount > 0 THEN
    FOR v_open_session IN
      SELECT ps.id
      FROM public.pos_sessions ps
      WHERE ps.company_id = v_invoice.company_id
        AND ps.branch_id IS NOT DISTINCT FROM v_invoice.branch_id
        AND ps.status = 'open'
      FOR UPDATE
    LOOP
      v_open_session_count := v_open_session_count + 1;
      v_current_session := v_open_session;
    END LOOP;
    IF v_open_session_count = 0 THEN
      RAISE EXCEPTION 'Open a POS session in this branch before voiding a cash invoice';
    ELSIF v_open_session_count > 1 THEN
      RAISE EXCEPTION 'Multiple POS sessions are open in this branch; close all but the void register';
    END IF;

    INSERT INTO public.cash_movements(
      company_id, branch_id, session_id, movement_type, direction, amount,
      payment_method, reference_type, reference_id, description, created_by
    )
    VALUES (
      v_invoice.company_id, v_invoice.branch_id, v_current_session,
      'void', 'out', v_cash_amount, 'cash', 'sales_invoice_void', p_invoice,
      'عكس نقد الفاتورة ' || v_invoice.invoice_number, auth.uid()
    );
  END IF;

  FOR v_item IN
    SELECT sii.product_id, sii.lot_id, SUM(sii.quantity) AS quantity,
      SUM(sii.quantity * sii.unit_cost) / NULLIF(SUM(sii.quantity), 0) AS unit_cost
    FROM public.sales_invoice_items sii
    WHERE sii.invoice_id = p_invoice AND sii.lot_id IS NOT NULL
    GROUP BY sii.product_id, sii.lot_id
  LOOP
    UPDATE public.stock_lots
    SET quantity_left = quantity_left + v_item.quantity
    WHERE id = v_item.lot_id
      AND company_id = v_invoice.company_id
      AND branch_id IS NOT DISTINCT FROM v_invoice.branch_id
      AND product_id = v_item.product_id
      AND warehouse_id IS NOT DISTINCT FROM v_invoice.warehouse_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Could not restore stock lot % for voided invoice', v_item.lot_id;
    END IF;

    INSERT INTO public.inventory_movements(
      company_id, branch_id, warehouse_id, product_id, lot_id,
      movement_type, quantity, unit_cost, reference_type, reference_id,
      reason, created_by
    )
    VALUES (
      v_invoice.company_id, v_invoice.branch_id, v_invoice.warehouse_id,
      v_item.product_id, v_item.lot_id, 'return', v_item.quantity,
      v_item.unit_cost, 'sales_invoice_void', p_invoice, trim(p_reason), auth.uid()
    );
  END LOOP;

  IF v_invoice.session_id IS NOT NULL THEN
    UPDATE public.pos_sessions
    SET total_sales = GREATEST(0, COALESCE(total_sales, 0) - COALESCE(v_invoice.total, 0))
    WHERE id = v_invoice.session_id;
  END IF;

  UPDATE public.sales_invoices
  SET status = 'voided', voided_at = now(), void_reason = trim(p_reason)
  WHERE id = p_invoice;
END
$$;

DROP FUNCTION IF EXISTS public.record_cash_expense(uuid, uuid, uuid, text, text, numeric, date);
DROP FUNCTION IF EXISTS public.record_cash_expense(uuid, uuid, uuid, text, text, numeric, date, text, text, text, text, uuid);
CREATE FUNCTION public.record_cash_expense(
  p_company uuid,
  p_branch uuid,
  p_session uuid,
  p_category text,
  p_description text,
  p_amount numeric,
  p_expense_date date,
  p_payment_method text DEFAULT 'cash',
  p_vendor_name text DEFAULT NULL,
  p_reference_number text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_expense_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_expense uuid := COALESCE(p_expense_id, gen_random_uuid());
  v_existing public.expenses%ROWTYPE;
  v_effective_session uuid;
  v_open boolean;
  v_cash_movement uuid;
BEGIN
  IF NOT (auth_has_permission('session.use') OR auth_has_permission('expenses.manage')) THEN
    RAISE EXCEPTION 'Permission denied to record cash expense';
  END IF;
  IF NOT auth_is_platform_admin() AND p_company IS DISTINCT FROM auth_company_id() THEN
    RAISE EXCEPTION 'Permission denied for this company';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 OR NULLIF(trim(p_description), '') IS NULL THEN
    RAISE EXCEPTION 'A description and positive amount are required';
  END IF;
  IF p_payment_method IS NULL THEN
    RAISE EXCEPTION 'A payment method is required';
  END IF;

  IF p_expense_id IS NOT NULL THEN
    SELECT * INTO v_existing
    FROM public.expenses
    WHERE id = p_expense_id AND company_id = p_company
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Expense not found';
    END IF;

    IF v_existing.payment_method::text = 'cash' AND v_existing.session_id IS NOT NULL
       AND EXISTS (
         SELECT 1 FROM public.pos_sessions ps
         WHERE ps.id = v_existing.session_id AND ps.status <> 'open'
       ) THEN
      RAISE EXCEPTION 'Cash expenses in a closed session cannot be edited';
    END IF;
  END IF;

  v_effective_session := CASE WHEN p_payment_method = 'cash'
    THEN COALESCE(p_session, v_existing.session_id)
    ELSE NULL END;

  IF p_payment_method = 'cash' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.pos_sessions ps
      WHERE ps.id = v_effective_session
        AND ps.company_id = p_company
        AND ps.branch_id IS NOT DISTINCT FROM p_branch
        AND ps.status = 'open'
    ) INTO v_open;
    IF NOT COALESCE(v_open, false) THEN
      RAISE EXCEPTION 'An open cash session is required for cash expenses';
    END IF;
    IF v_existing.payment_method::text = 'cash'
       AND v_existing.session_id IS NOT NULL
       AND v_effective_session IS DISTINCT FROM v_existing.session_id THEN
      RAISE EXCEPTION 'A cash expense cannot be moved between sessions';
    END IF;
  END IF;

  IF p_expense_id IS NULL THEN
    INSERT INTO public.expenses(
      id, company_id, branch_id, session_id, category, description,
      amount, payment_method, expense_date, status, vendor_name,
      reference_number, notes, created_by
    )
    VALUES (
      v_expense, p_company, p_branch, v_effective_session, p_category,
      trim(p_description),       p_amount, p_payment_method::public.payment_method,
      COALESCE(p_expense_date, current_date), 'paid', p_vendor_name,
      p_reference_number, p_notes, auth.uid()
    );
  ELSE
    UPDATE public.expenses
    SET branch_id = p_branch,
        session_id = v_effective_session,
        category = p_category,
        description = trim(p_description),
        amount = p_amount,
        payment_method = p_payment_method::public.payment_method,
        expense_date = COALESCE(p_expense_date, current_date),
        vendor_name = p_vendor_name,
        reference_number = p_reference_number,
        notes = p_notes
    WHERE id = v_expense;
  END IF;

  SELECT id INTO v_cash_movement
  FROM public.cash_movements
  WHERE reference_type = 'expense'
    AND reference_id = v_expense
    AND movement_type = 'expense'
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF p_payment_method = 'cash' THEN
    IF v_cash_movement IS NULL THEN
      INSERT INTO public.cash_movements(
        company_id, branch_id, session_id, movement_type, direction, amount,
        payment_method, reference_type, reference_id, description, created_by
      )
      VALUES (
        p_company, p_branch, v_effective_session, 'expense', 'out', p_amount,
        'cash', 'expense', v_expense, trim(p_description), auth.uid()
      );
    ELSE
      UPDATE public.cash_movements
      SET amount = p_amount, description = trim(p_description)
      WHERE id = v_cash_movement;
    END IF;
  ELSIF v_cash_movement IS NOT NULL THEN
    DELETE FROM public.cash_movements WHERE id = v_cash_movement;
  END IF;

  RETURN v_expense;
END
$$;

DROP FUNCTION IF EXISTS public.record_cash_movement(uuid, uuid, uuid, text, numeric, text);
CREATE FUNCTION public.record_cash_movement(
  p_company uuid,
  p_branch uuid,
  p_session uuid,
  p_movement_type text,
  p_amount numeric,
  p_description text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_movement uuid := gen_random_uuid();
  v_direction public.payment_direction;
BEGIN
  IF NOT auth_has_permission('session.use') THEN
    RAISE EXCEPTION 'Permission denied: session.use';
  END IF;
  IF NOT auth_is_platform_admin() AND p_company IS DISTINCT FROM auth_company_id() THEN
    RAISE EXCEPTION 'Permission denied for this company';
  END IF;
  IF p_movement_type NOT IN ('deposit', 'withdrawal')
     OR p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'A valid cash movement and positive amount are required';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.pos_sessions ps
    WHERE ps.id = p_session
      AND ps.company_id = p_company
      AND ps.branch_id IS NOT DISTINCT FROM p_branch
      AND ps.status = 'open'
  ) THEN
    RAISE EXCEPTION 'An open cash session is required';
  END IF;

  v_direction := CASE WHEN p_movement_type = 'withdrawal' THEN 'out'::public.payment_direction
                      ELSE 'in'::public.payment_direction END;
  INSERT INTO public.cash_movements(
    id, company_id, branch_id, session_id, movement_type, direction, amount,
    payment_method, reference_type, description, created_by
  )
  VALUES (
    v_movement, p_company, p_branch, p_session, p_movement_type, v_direction,
    p_amount, 'cash', 'manual', NULLIF(trim(p_description), ''), auth.uid()
  );

  RETURN v_movement;
END
$$;

DROP FUNCTION IF EXISTS public.delete_expense(uuid);
DROP FUNCTION IF EXISTS public.record_sale_cash_movement(uuid);
CREATE FUNCTION public.record_sale_cash_movement(p_invoice uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_inv public.sales_invoices%ROWTYPE;
  v_cash numeric := 0;
  v_id uuid;
BEGIN
  SELECT * INTO v_inv FROM public.sales_invoices WHERE id = p_invoice;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice not found';
  END IF;
  IF NOT auth_is_platform_admin() AND v_inv.company_id IS DISTINCT FROM auth_company_id() THEN
    RAISE EXCEPTION 'Permission denied for this company';
  END IF;
  IF NOT (auth_has_permission('pos.use') OR auth_has_permission('session.use')) THEN
    RAISE EXCEPTION 'Permission denied: pos.use';
  END IF;
  IF v_inv.session_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT id INTO v_id FROM public.cash_movements
  WHERE reference_type = 'sales_invoice' AND reference_id = p_invoice AND movement_type = 'sale'
  LIMIT 1;
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  IF v_inv.payment_method::text = 'cash' THEN
    v_cash := LEAST(COALESCE(v_inv.paid, 0), COALESCE(v_inv.total, 0));
  ELSIF v_inv.payment_method::text = 'mixed' THEN
    SELECT COALESCE(SUM(ip.amount), 0) INTO v_cash
    FROM public.invoice_payments ip
    WHERE ip.invoice_id = p_invoice AND lower(ip.payment_method) = 'cash';
  END IF;
  IF v_cash <= 0 THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.cash_movements(
    company_id, branch_id, session_id, movement_type, direction, amount,
    payment_method, reference_type, reference_id, description, created_by
  )
  VALUES (
    v_inv.company_id, v_inv.branch_id, v_inv.session_id, 'sale', 'in', v_cash,
    'cash', 'sales_invoice', p_invoice, 'فاتورة بيع', auth.uid()
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END
$$;

INSERT INTO public.cash_movements(
  company_id, branch_id, session_id, movement_type, direction, amount,
  payment_method, reference_type, reference_id, description, created_by
)
SELECT si.company_id, si.branch_id, si.session_id, 'sale', 'in',
  CASE WHEN si.payment_method::text = 'cash' THEN LEAST(COALESCE(si.paid, 0), COALESCE(si.total, 0))
       ELSE (SELECT COALESCE(SUM(ip.amount), 0) FROM public.invoice_payments ip
             WHERE ip.invoice_id = si.id AND lower(ip.payment_method) = 'cash') END,
  'cash', 'sales_invoice', si.id, 'فاتورة بيع', si.created_by
FROM public.sales_invoices si
WHERE si.session_id IS NOT NULL
  AND si.status::text <> 'voided'
  AND si.payment_method::text IN ('cash', 'mixed')
  AND NOT EXISTS (
    SELECT 1 FROM public.cash_movements cm
    WHERE cm.reference_type = 'sales_invoice' AND cm.reference_id = si.id AND cm.movement_type = 'sale'
  )
  AND (CASE WHEN si.payment_method::text = 'cash' THEN LEAST(COALESCE(si.paid, 0), COALESCE(si.total, 0))
       ELSE (SELECT COALESCE(SUM(ip.amount), 0) FROM public.invoice_payments ip
             WHERE ip.invoice_id = si.id AND lower(ip.payment_method) = 'cash') END) > 0;

CREATE FUNCTION public.delete_expense(p_expense uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_expense public.expenses%ROWTYPE;
BEGIN
  IF NOT auth_has_permission('expenses.manage') THEN
    RAISE EXCEPTION 'Permission denied: expenses.manage';
  END IF;

  SELECT * INTO v_expense
  FROM public.expenses
  WHERE id = p_expense AND company_id = auth_company_id()
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Expense not found';
  END IF;

  IF v_expense.payment_method::text = 'cash' AND v_expense.session_id IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM public.pos_sessions ps
       WHERE ps.id = v_expense.session_id AND ps.status <> 'open'
     ) THEN
    RAISE EXCEPTION 'Cash expenses in a closed session cannot be deleted';
  END IF;

  DELETE FROM public.cash_movements
  WHERE reference_type = 'expense'
    AND reference_id = p_expense
    AND movement_type = 'expense';

  DELETE FROM public.expenses WHERE id = p_expense;
END
$$;

CREATE OR REPLACE FUNCTION public.audit_business_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_row jsonb;
  v_old jsonb;
  v_new jsonb;
  v_company uuid;
  v_branch uuid;
  v_entity_id uuid;
  v_actor uuid;
  v_email text;
  v_name text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_row := to_jsonb(OLD);
    v_old := v_row - ARRAY['password', 'password_hash', 'api_key', 'secret', 'access_token', 'refresh_token']::text[];
    v_new := NULL;
  ELSE
    v_row := to_jsonb(NEW);
    v_old := CASE WHEN TG_OP = 'UPDATE'
      THEN (to_jsonb(OLD) - ARRAY['password', 'password_hash', 'api_key', 'secret', 'access_token', 'refresh_token']::text[])
      ELSE NULL END;
    v_new := v_row - ARRAY['password', 'password_hash', 'api_key', 'secret', 'access_token', 'refresh_token']::text[];
  END IF;

  v_company := NULLIF(v_row->>'company_id', '')::uuid;
  IF TG_TABLE_NAME = 'companies' THEN
    v_company := NULLIF(v_row->>'id', '')::uuid;
  END IF;
  v_branch := NULLIF(v_row->>'branch_id', '')::uuid;
  v_entity_id := NULLIF(v_row->>'id', '')::uuid;
  IF TG_TABLE_NAME = 'sales_invoice_items' OR TG_TABLE_NAME = 'invoice_payments' THEN
    SELECT si.company_id, si.branch_id INTO v_company, v_branch
    FROM public.sales_invoices si
    WHERE si.id = NULLIF(v_row->>'invoice_id', '')::uuid;
    v_entity_id := COALESCE(v_entity_id, NULLIF(v_row->>'invoice_id', '')::uuid);
  ELSIF TG_TABLE_NAME = 'purchase_order_items' THEN
    SELECT po.company_id, po.branch_id INTO v_company, v_branch
    FROM public.purchase_orders po
    WHERE po.id = NULLIF(v_row->>'po_id', '')::uuid;
    v_entity_id := COALESCE(v_entity_id, NULLIF(v_row->>'po_id', '')::uuid);
  ELSIF TG_TABLE_NAME = 'sales_return_items' THEN
    SELECT sr.company_id, sr.branch_id INTO v_company, v_branch
    FROM public.sales_returns sr
    WHERE sr.id = NULLIF(v_row->>'return_id', '')::uuid;
    v_entity_id := COALESCE(v_entity_id, NULLIF(v_row->>'return_id', '')::uuid);
  ELSIF TG_TABLE_NAME = 'stock_transfer_items' THEN
    SELECT st.company_id, st.branch_id INTO v_company, v_branch
    FROM public.stock_transfers st
    WHERE st.id = NULLIF(v_row->>'transfer_id', '')::uuid;
    v_entity_id := COALESCE(v_entity_id, NULLIF(v_row->>'transfer_id', '')::uuid);
  ELSIF TG_TABLE_NAME = 'warehouse_count_items' THEN
    SELECT wc.company_id, wc.branch_id INTO v_company, v_branch
    FROM public.warehouse_counts wc
    WHERE wc.id = NULLIF(v_row->>'count_id', '')::uuid;
    v_entity_id := COALESCE(v_entity_id, NULLIF(v_row->>'count_id', '')::uuid);
  ELSIF TG_TABLE_NAME = 'journal_entry_lines' THEN
    SELECT je.company_id, je.branch_id INTO v_company, v_branch
    FROM public.journal_entries je
    WHERE je.id = NULLIF(v_row->>'entry_id', '')::uuid;
    v_entity_id := COALESCE(v_entity_id, NULLIF(v_row->>'entry_id', '')::uuid);
  END IF;
  v_actor := COALESCE(
    auth.uid(),
    NULLIF(v_row->>'created_by', '')::uuid,
    NULLIF(v_row->>'opened_by', '')::uuid,
    NULLIF(v_row->>'closed_by', '')::uuid
  );

  SELECT u.full_name, u.email INTO v_name, v_email
  FROM public.users u
  WHERE u.id = v_actor;
  v_email := COALESCE(v_email, (SELECT au.email FROM auth.users au WHERE au.id = v_actor));

  INSERT INTO public.audit_log(
    company_id, branch_id, user_id, user_email, user_name, action,
    entity_type, entity_id, old_values, new_values
  )
  VALUES (
    v_company, v_branch, v_actor, v_email, COALESCE(v_name, v_email),
    lower(TG_TABLE_NAME) || '.' || lower(TG_OP),
    TG_TABLE_NAME, v_entity_id, v_old, v_new
  );

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END
$$;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'companies', 'branches', 'users', 'roles', 'categories', 'warehouses',
    'products', 'customers', 'suppliers', 'stock_lots', 'inventory_movements',
    'stock_transfers', 'stock_transfer_items', 'warehouse_counts',
    'warehouse_count_items', 'registers', 'pos_sessions', 'cash_movements',
    'sales_invoices', 'sales_invoice_items', 'invoice_payments', 'sales_returns',
    'sales_return_items', 'purchase_orders', 'purchase_order_items', 'expenses',
    'payments', 'account_transactions', 'journal_entries', 'journal_entry_lines'
  ] LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = t
    ) THEN
      EXECUTE format('DROP TRIGGER IF EXISTS audit_business_change ON public.%I', t);
      EXECUTE format(
        'CREATE TRIGGER audit_business_change AFTER INSERT OR UPDATE OR DELETE ON public.%I '
        'FOR EACH ROW EXECUTE FUNCTION public.audit_business_change()',
        t
      );
    END IF;
  END LOOP;
END
$$;

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pos_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS audit_select ON public.audit_log;
CREATE POLICY audit_select ON public.audit_log FOR SELECT
  USING (
    (company_id = auth_company_id() AND auth_has_permission('audit.view'))
    OR auth_is_platform_admin()
  );

DROP POLICY IF EXISTS expenses_all ON public.expenses;
DROP POLICY IF EXISTS expenses_select ON public.expenses;
DROP POLICY IF EXISTS expenses_insert ON public.expenses;
DROP POLICY IF EXISTS expenses_update ON public.expenses;
DROP POLICY IF EXISTS expenses_delete ON public.expenses;
CREATE POLICY expenses_select ON public.expenses FOR SELECT
  USING (
    (company_id = auth_company_id() AND (
      auth_has_permission('expenses.view')
      OR auth_has_permission('expenses.manage')
      OR auth_has_permission('session.use')
    ))
    OR auth_is_platform_admin()
  );
CREATE POLICY expenses_insert ON public.expenses FOR INSERT
  WITH CHECK (
    (company_id = auth_company_id() AND auth_has_permission('expenses.manage'))
    OR auth_is_platform_admin()
  );
CREATE POLICY expenses_update ON public.expenses FOR UPDATE
  USING (
    (company_id = auth_company_id() AND auth_has_permission('expenses.manage'))
    OR auth_is_platform_admin()
  )
  WITH CHECK (
    (company_id = auth_company_id() AND auth_has_permission('expenses.manage'))
    OR auth_is_platform_admin()
  );
CREATE POLICY expenses_delete ON public.expenses FOR DELETE
  USING (
    (company_id = auth_company_id() AND auth_has_permission('expenses.manage'))
    OR auth_is_platform_admin()
  );

DROP POLICY IF EXISTS audit_insert ON public.audit_log;
CREATE POLICY audit_insert ON public.audit_log FOR INSERT
  WITH CHECK (
    (company_id = auth_company_id() AND user_id = auth.uid())
    OR auth_is_platform_admin()
  );

DROP POLICY IF EXISTS invoice_payments_select ON public.invoice_payments;
CREATE POLICY invoice_payments_select ON public.invoice_payments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.sales_invoices si
      WHERE si.id = invoice_id
        AND si.company_id = auth_company_id()
        AND (
          auth_has_permission('pos.use')
          OR auth_has_permission('pos.full')
          OR auth_has_permission('sales.view')
          OR auth_has_permission('sales.full')
          OR auth_has_permission('sales.manage')
          OR auth_has_permission('session.use')
          OR auth_has_permission('session.view')
          OR auth_has_permission('accounting.view')
          OR auth_has_permission('accounting.manage')
          OR auth_has_permission('reports.view')
          OR auth_has_permission('reports.full')
          OR auth_has_permission('reports.financial')
          OR auth_has_permission('customers.view')
          OR auth_has_permission('customers.manage')
          OR auth_has_permission('admin.full')
          OR auth_has_permission('company.owner')
        )
    )
    OR auth_is_platform_admin()
  );

DROP POLICY IF EXISTS sales_invoices_all ON public.sales_invoices;
DROP POLICY IF EXISTS sales_invoices_select ON public.sales_invoices;
DROP POLICY IF EXISTS sales_invoice_items_select ON public.sales_invoice_items;
DROP POLICY IF EXISTS sii_all ON public.sales_invoice_items;
CREATE POLICY sales_invoices_select ON public.sales_invoices FOR SELECT
  USING (
    (company_id = auth_company_id() AND (
      auth_has_permission('sales.view')
      OR auth_has_permission('sales.full')
      OR auth_has_permission('sales.manage')
      OR auth_has_permission('pos.use')
      OR auth_has_permission('pos.full')
      OR auth_has_permission('session.use')
      OR auth_has_permission('session.view')
      OR auth_has_permission('accounting.view')
      OR auth_has_permission('accounting.manage')
      OR auth_has_permission('reports.view')
      OR auth_has_permission('reports.full')
      OR auth_has_permission('reports.financial')
      OR auth_has_permission('customers.view')
      OR auth_has_permission('customers.manage')
      OR auth_has_permission('admin.full')
      OR auth_has_permission('company.owner')
    ))
    OR auth_is_platform_admin()
  );
CREATE POLICY sales_invoice_items_select ON public.sales_invoice_items FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.sales_invoices si
      WHERE si.id = invoice_id
        AND si.company_id = auth_company_id()
        AND (
          auth_has_permission('sales.view')
          OR auth_has_permission('sales.full')
          OR auth_has_permission('sales.manage')
          OR auth_has_permission('pos.use')
          OR auth_has_permission('pos.full')
          OR auth_has_permission('session.use')
          OR auth_has_permission('session.view')
          OR auth_has_permission('accounting.view')
          OR auth_has_permission('accounting.manage')
          OR auth_has_permission('reports.view')
          OR auth_has_permission('reports.full')
          OR auth_has_permission('reports.financial')
          OR auth_has_permission('customers.view')
          OR auth_has_permission('customers.manage')
          OR auth_has_permission('admin.full')
          OR auth_has_permission('company.owner')
        )
    )
    OR auth_is_platform_admin()
  );

DROP POLICY IF EXISTS sales_returns_all ON public.sales_returns;
DROP POLICY IF EXISTS sales_returns_select ON public.sales_returns;
DROP POLICY IF EXISTS sales_return_items_select ON public.sales_return_items;
DROP POLICY IF EXISTS sri_all ON public.sales_return_items;
CREATE POLICY sales_returns_select ON public.sales_returns FOR SELECT
  USING (
    (company_id = auth_company_id() AND (
      auth_has_permission('sales.view')
      OR auth_has_permission('sales.full')
      OR auth_has_permission('sales.manage')
      OR auth_has_permission('pos.use')
      OR auth_has_permission('pos.full')
      OR auth_has_permission('session.use')
      OR auth_has_permission('session.view')
      OR auth_has_permission('accounting.view')
      OR auth_has_permission('accounting.manage')
      OR auth_has_permission('reports.view')
      OR auth_has_permission('reports.full')
      OR auth_has_permission('reports.financial')
      OR auth_has_permission('customers.view')
      OR auth_has_permission('customers.manage')
      OR auth_has_permission('admin.full')
      OR auth_has_permission('company.owner')
    ))
    OR auth_is_platform_admin()
  );
CREATE POLICY sales_return_items_select ON public.sales_return_items FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.sales_returns sr
      WHERE sr.id = return_id
        AND sr.company_id = auth_company_id()
        AND (
          auth_has_permission('sales.view')
          OR auth_has_permission('sales.full')
          OR auth_has_permission('sales.manage')
          OR auth_has_permission('pos.use')
          OR auth_has_permission('pos.full')
          OR auth_has_permission('session.use')
          OR auth_has_permission('session.view')
          OR auth_has_permission('accounting.view')
          OR auth_has_permission('accounting.manage')
          OR auth_has_permission('reports.view')
          OR auth_has_permission('reports.full')
          OR auth_has_permission('reports.financial')
          OR auth_has_permission('customers.view')
          OR auth_has_permission('customers.manage')
          OR auth_has_permission('admin.full')
          OR auth_has_permission('company.owner')
        )
    )
    OR auth_is_platform_admin()
  );

DROP POLICY IF EXISTS pos_sessions_all ON public.pos_sessions;
CREATE POLICY pos_sessions_all ON public.pos_sessions FOR ALL
  USING (
    (company_id = auth_company_id() AND auth_has_permission('session.use'))
    OR auth_is_platform_admin()
  )
  WITH CHECK (
    (company_id = auth_company_id() AND auth_has_permission('session.use'))
    OR auth_is_platform_admin()
  );

DROP POLICY IF EXISTS cash_movements_all ON public.cash_movements;
DROP POLICY IF EXISTS cash_movements_select ON public.cash_movements;
DROP POLICY IF EXISTS cash_movements_insert ON public.cash_movements;
DROP POLICY IF EXISTS cash_movements_update ON public.cash_movements;
DROP POLICY IF EXISTS cash_movements_delete ON public.cash_movements;
CREATE POLICY cash_movements_select ON public.cash_movements FOR SELECT
  USING (
    (company_id = auth_company_id() AND (
      auth_has_permission('session.use')
      OR auth_has_permission('pos.use')
      OR auth_has_permission('purchases.full')
      OR auth_has_permission('expenses.view')
      OR auth_has_permission('expenses.manage')
      OR auth_has_permission('accounting.view')
    ))
    OR auth_is_platform_admin()
  );
CREATE POLICY cash_movements_insert ON public.cash_movements FOR INSERT
  WITH CHECK (
    (company_id = auth_company_id() AND (
      auth_has_permission('session.use')
      OR auth_has_permission('pos.use')
      OR auth_has_permission('purchases.full')
      OR auth_has_permission('expenses.manage')
      OR auth_has_permission('accounting.manage')
    ))
    OR auth_is_platform_admin()
  );
CREATE POLICY cash_movements_update ON public.cash_movements FOR UPDATE
  USING (
    (company_id = auth_company_id() AND (
      auth_has_permission('session.use')
      OR auth_has_permission('purchases.full')
      OR auth_has_permission('expenses.manage')
      OR auth_has_permission('accounting.manage')
    ))
    OR auth_is_platform_admin()
  )
  WITH CHECK (
    (company_id = auth_company_id() AND (
      auth_has_permission('session.use')
      OR auth_has_permission('purchases.full')
      OR auth_has_permission('expenses.manage')
      OR auth_has_permission('accounting.manage')
    ))
    OR auth_is_platform_admin()
  );
CREATE POLICY cash_movements_delete ON public.cash_movements FOR DELETE
  USING (
    (company_id = auth_company_id() AND (
      auth_has_permission('session.use')
      OR auth_has_permission('purchases.full')
      OR auth_has_permission('expenses.manage')
      OR auth_has_permission('accounting.manage')
    ))
    OR auth_is_platform_admin()
  );

REVOKE ALL ON FUNCTION public.open_pos_session(uuid, uuid, uuid, uuid, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.close_pos_session(uuid, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_cash_expense(uuid, uuid, uuid, text, text, numeric, date, text, text, text, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_cash_movement(uuid, uuid, uuid, text, numeric, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_expense(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_return(uuid, uuid, uuid, jsonb, public.payment_method, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_products_stock_bulk(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pick_stock_fefo(uuid, uuid, uuid, uuid, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_products_stock_bulk(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pick_stock_fefo(uuid, uuid, uuid, uuid, numeric) TO authenticated;
REVOKE ALL ON FUNCTION public.void_invoice(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.open_pos_session(uuid, uuid, uuid, uuid, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.close_pos_session(uuid, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_cash_expense(uuid, uuid, uuid, text, text, numeric, date, text, text, text, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_cash_movement(uuid, uuid, uuid, text, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_expense(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_return(uuid, uuid, uuid, jsonb, public.payment_method, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.void_invoice(uuid, text) TO authenticated;
REVOKE ALL ON FUNCTION public.record_sale_cash_movement(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_sale_cash_movement(uuid) TO authenticated;

DROP FUNCTION IF EXISTS public.get_store_theme(uuid);
CREATE FUNCTION public.get_store_theme(p_company uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_company record;
  v_config jsonb;
BEGIN
  SELECT active_theme_slug, active_custom_theme_id, theme_overrides
  INTO v_company
  FROM public.companies
  WHERE id = p_company AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF v_company.active_custom_theme_id IS NOT NULL THEN
    SELECT config INTO v_config FROM public.company_themes
    WHERE id = v_company.active_custom_theme_id AND company_id = p_company;
  END IF;
  IF v_config IS NULL AND v_company.active_theme_slug IS NOT NULL THEN
    SELECT config INTO v_config FROM public.themes WHERE slug = v_company.active_theme_slug;
  END IF;
  IF v_config IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN v_config || COALESCE(v_company.theme_overrides, '{}'::jsonb);
END
$$;
REVOKE ALL ON FUNCTION public.get_store_theme(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_store_theme(uuid) TO anon, authenticated;

ALTER TABLE public.store_orders
  ADD COLUMN IF NOT EXISTS invoice_id uuid,
  ADD COLUMN IF NOT EXISTS paid_at timestamptz,
  ADD COLUMN IF NOT EXISTS paid_by uuid,
  ADD COLUMN IF NOT EXISTS session_id uuid;

DROP FUNCTION IF EXISTS public.settle_store_order(uuid, text);
CREATE FUNCTION public.settle_store_order(p_order uuid, p_method text DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_order public.store_orders%ROWTYPE;
  v_method text;
  v_session public.pos_sessions%ROWTYPE;
  v_open_count int;
  v_warehouse uuid;
  v_items jsonb := '[]'::jsonb;
  v_row record;
  v_prod jsonb;
  v_invoice uuid;
  v_subtotal numeric := 0;
BEGIN
  IF NOT (auth_has_permission('store.orders_manage') OR auth_has_permission('store.manage')) THEN
    RAISE EXCEPTION 'Permission denied: store.orders_manage';
  END IF;

  SELECT * INTO v_order FROM public.store_orders WHERE id = p_order FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Store order not found';
  END IF;
  IF NOT auth_is_platform_admin() AND v_order.company_id IS DISTINCT FROM auth_company_id() THEN
    RAISE EXCEPTION 'Permission denied for this company';
  END IF;
  IF v_order.status = 'cancelled' THEN
    RAISE EXCEPTION 'Cancelled orders cannot be paid';
  END IF;
  IF v_order.invoice_id IS NOT NULL THEN
    RETURN v_order.invoice_id;
  END IF;

  v_method := lower(COALESCE(NULLIF(trim(p_method), ''), v_order.payment_method, 'cash'));
  v_method := CASE WHEN v_method IN ('card', 'online', 'visa') THEN 'card' ELSE 'cash' END;

  SELECT count(*) INTO v_open_count
  FROM public.pos_sessions ps
  WHERE ps.company_id = v_order.company_id
    AND ps.status = 'open'
    AND (ps.cashier_id = auth.uid() OR ps.branch_id IS NOT DISTINCT FROM v_order.branch_id);

  SELECT * INTO v_session
  FROM public.pos_sessions ps
  WHERE ps.company_id = v_order.company_id
    AND ps.status = 'open'
    AND (ps.cashier_id = auth.uid() OR ps.branch_id IS NOT DISTINCT FROM v_order.branch_id)
  ORDER BY (ps.cashier_id = auth.uid()) DESC NULLS LAST,
           (ps.branch_id IS NOT DISTINCT FROM v_order.branch_id) DESC,
           ps.opened_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'An open cash session is required to collect payment for a store order';
  END IF;
  IF v_open_count > 1 AND v_session.cashier_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Several cash sessions are open; open your own session first';
  END IF;

  v_warehouse := v_session.warehouse_id;
  IF v_warehouse IS NULL THEN
    SELECT w.id INTO v_warehouse FROM public.warehouses w
    WHERE w.company_id = v_order.company_id
      AND w.branch_id IS NOT DISTINCT FROM v_session.branch_id
      AND w.deleted_at IS NULL
    ORDER BY w.created_at LIMIT 1;
  END IF;

  FOR v_row IN
    SELECT i.product_id, i.quantity, i.unit_price
    FROM public.store_order_items i WHERE i.order_id = p_order AND i.product_id IS NOT NULL
  LOOP
    SELECT to_jsonb(p) INTO v_prod FROM public.products p WHERE p.id = v_row.product_id;
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'product_id', v_row.product_id,
      'quantity', v_row.quantity,
      'unit_price', v_row.unit_price,
      'unit_cost', COALESCE((v_prod->>'cost_price')::numeric, 0),
      'sale_unit', COALESCE(v_prod->>'sale_unit', v_prod->>'base_unit', 'piece')
    ));
    v_subtotal := v_subtotal + v_row.quantity * v_row.unit_price;
  END LOOP;
  IF jsonb_array_length(v_items) = 0 THEN
    RAISE EXCEPTION 'Store order has no items';
  END IF;

  v_invoice := public.record_invoice_v3(
    p_company := v_order.company_id,
    p_branch := v_session.branch_id,
    p_warehouse := v_warehouse,
    p_register := v_session.register_id,
    p_session := v_session.id,
    p_customer := v_order.customer_id,
    p_items := v_items,
    p_method := v_method::public.payment_method,
    p_paid := v_subtotal,
    p_notes := 'طلب متجر ' || v_order.order_number,
    p_tax := 0,
    p_discount := 0,
    p_discount_type := 'percent'
  );

  PERFORM public.record_sale_cash_movement(v_invoice);

  BEGIN
    PERFORM public.generate_invoice_journal_entry_v2(v_invoice);
  EXCEPTION WHEN others THEN
    RAISE WARNING 'store order journal entry failed: %', SQLERRM;
  END;

  UPDATE public.store_orders
  SET payment_status = 'paid', payment_method = v_method, invoice_id = v_invoice,
      session_id = v_session.id, paid_at = now(), paid_by = auth.uid(), updated_at = now()
  WHERE id = p_order;

  RETURN v_invoice;
END
$$;
REVOKE ALL ON FUNCTION public.settle_store_order(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.settle_store_order(uuid, text) TO authenticated;

ALTER TABLE public.themes
  ADD COLUMN IF NOT EXISTS name text,
  ADD COLUMN IF NOT EXISTS name_ar text,
  ADD COLUMN IF NOT EXISTS is_system boolean DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS uq_themes_slug ON public.themes(slug);

INSERT INTO public.themes (slug, name, name_ar, config, is_system)
SELECT v.slug, v.name, v.name, v.config, v.is_system FROM (VALUES
('ocean-teal', 'الفيروزي البحري', '{"primary":"#0f4c5c","primaryLight":"#1b6b7e","primaryDark":"#08303a","accent":"#0ea5a4","accentDark":"#0b8483","gold":"#f59e0b","bg":"#f0fafa","bgSoft":"#f7fdfd","bgCard":"#ffffff","bgSidebar":"#0f4c5c","text":"#12303a","textMuted":"#5b7882","border":"#cfe8ea","success":"#10b981","danger":"#ef4444","warning":"#f59e0b","info":"#3b82f6","sidebarStyle":"dark","radius":"14px","fontFamily":"Cairo, sans-serif","mode":"light"}'::jsonb, true),
('graphite-gold', 'الجرافيت والذهبي', '{"primary":"#27272a","primaryLight":"#3f3f46","primaryDark":"#18181b","accent":"#d4a017","accentDark":"#b58612","gold":"#d4a017","bg":"#fafaf9","bgSoft":"#f5f5f4","bgCard":"#ffffff","bgSidebar":"#18181b","text":"#1c1917","textMuted":"#78716c","border":"#e7e5e4","success":"#16a34a","danger":"#dc2626","warning":"#d4a017","info":"#2563eb","sidebarStyle":"dark","radius":"12px","fontFamily":"Cairo, sans-serif","mode":"light"}'::jsonb, true),
('crimson-classic', 'الأحمر الكلاسيكي', '{"primary":"#7f1d1d","primaryLight":"#991b1b","primaryDark":"#450a0a","accent":"#dc2626","accentDark":"#b91c1c","gold":"#f59e0b","bg":"#fef2f2","bgSoft":"#fff7f7","bgCard":"#ffffff","bgSidebar":"#7f1d1d","text":"#1f2937","textMuted":"#6b7280","border":"#fecaca","success":"#10b981","danger":"#ef4444","warning":"#f59e0b","info":"#3b82f6","sidebarStyle":"dark","radius":"14px","fontFamily":"Cairo, sans-serif","mode":"light"}'::jsonb, true),
('indigo-modern', 'النيلي العصري', '{"primary":"#312e81","primaryLight":"#3730a3","primaryDark":"#1e1b4b","accent":"#6366f1","accentDark":"#4f46e5","gold":"#f59e0b","bg":"#eef2ff","bgSoft":"#f5f7ff","bgCard":"#ffffff","bgSidebar":"#312e81","text":"#1e1b4b","textMuted":"#6b7280","border":"#c7d2fe","success":"#10b981","danger":"#ef4444","warning":"#f59e0b","info":"#3b82f6","sidebarStyle":"dark","radius":"16px","fontFamily":"Cairo, sans-serif","mode":"light"}'::jsonb, true),
('fresh-lime', 'الأخضر المنعش', '{"primary":"#365314","primaryLight":"#4d7c0f","primaryDark":"#1a2e05","accent":"#65a30d","accentDark":"#4d7c0f","gold":"#f59e0b","bg":"#f7fee7","bgSoft":"#fbffef","bgCard":"#ffffff","bgSidebar":"#365314","text":"#1a2e05","textMuted":"#5f6f4a","border":"#d9f99d","success":"#16a34a","danger":"#ef4444","warning":"#f59e0b","info":"#3b82f6","sidebarStyle":"dark","radius":"14px","fontFamily":"Cairo, sans-serif","mode":"light"}'::jsonb, true),
('sky-light', 'السماوي الهادئ', '{"primary":"#0c4a6e","primaryLight":"#075985","primaryDark":"#082f49","accent":"#0284c7","accentDark":"#0369a1","gold":"#f59e0b","bg":"#f0f9ff","bgSoft":"#f7fcff","bgCard":"#ffffff","bgSidebar":"#0c4a6e","text":"#0c2d48","textMuted":"#5b7a90","border":"#bae6fd","success":"#10b981","danger":"#ef4444","warning":"#f59e0b","info":"#0ea5e9","sidebarStyle":"dark","radius":"14px","fontFamily":"Cairo, sans-serif","mode":"light"}'::jsonb, true),
('coffee-warm', 'القهوة الدافئة', '{"primary":"#4a2c1a","primaryLight":"#6b4226","primaryDark":"#2b190f","accent":"#b45309","accentDark":"#92400e","gold":"#d97706","bg":"#faf5ef","bgSoft":"#fdf9f4","bgCard":"#ffffff","bgSidebar":"#4a2c1a","text":"#2b190f","textMuted":"#7c6552","border":"#eadccb","success":"#16a34a","danger":"#dc2626","warning":"#d97706","info":"#3b82f6","sidebarStyle":"dark","radius":"14px","fontFamily":"Cairo, sans-serif","mode":"light"}'::jsonb, true),
('slate-minimal', 'الرمادي البسيط', '{"primary":"#334155","primaryLight":"#475569","primaryDark":"#1e293b","accent":"#475569","accentDark":"#334155","gold":"#f59e0b","bg":"#f8fafc","bgSoft":"#f1f5f9","bgCard":"#ffffff","bgSidebar":"#1e293b","text":"#0f172a","textMuted":"#64748b","border":"#e2e8f0","success":"#10b981","danger":"#ef4444","warning":"#f59e0b","info":"#3b82f6","sidebarStyle":"dark","radius":"10px","fontFamily":"Cairo, sans-serif","mode":"light"}'::jsonb, true),
('emerald-night', 'الزمردي الليلي', '{"primary":"#064e3b","primaryLight":"#065f46","primaryDark":"#022c22","accent":"#34d399","accentDark":"#10b981","gold":"#fbbf24","bg":"#06181a","bgSoft":"#0b2427","bgCard":"#0f2e31","bgSidebar":"#04100f","text":"#e6fffa","textMuted":"#8fb8b2","border":"#17484a","success":"#34d399","danger":"#f87171","warning":"#fbbf24","info":"#60a5fa","sidebarStyle":"dark","radius":"14px","fontFamily":"Cairo, sans-serif","mode":"dark"}'::jsonb, true),
('violet-night', 'البنفسجي الليلي', '{"primary":"#2e1065","primaryLight":"#4c1d95","primaryDark":"#1e0a45","accent":"#a78bfa","accentDark":"#8b5cf6","gold":"#fbbf24","bg":"#120a24","bgSoft":"#1a1033","bgCard":"#21153f","bgSidebar":"#0d0720","text":"#f3effe","textMuted":"#a89cc8","border":"#35275c","success":"#34d399","danger":"#f87171","warning":"#fbbf24","info":"#60a5fa","sidebarStyle":"dark","radius":"14px","fontFamily":"Cairo, sans-serif","mode":"dark"}'::jsonb, true)
) AS v(slug, name, config, is_system)
ON CONFLICT (slug) DO NOTHING;

-- ============================================================================
-- Store: stock availability, order stock guard, order status lifecycle
-- ============================================================================
DROP FUNCTION IF EXISTS public.store_available_qty(uuid, uuid, uuid);
CREATE FUNCTION public.store_available_qty(p_company uuid, p_product uuid, p_exclude_order uuid DEFAULT NULL)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT GREATEST(
    COALESCE((SELECT SUM(v.available) FROM public.v_stock_on_hand_all v
              WHERE v.company_id = p_company AND v.product_id = p_product), 0)
    - COALESCE((SELECT SUM(i.quantity)
                FROM public.store_order_items i
                JOIN public.store_orders o ON o.id = i.order_id
                WHERE o.company_id = p_company
                  AND i.product_id = p_product
                  AND o.invoice_id IS NULL
                  AND o.status NOT IN ('cancelled', 'rejected', 'delivered', 'completed', 'out_for_delivery')
                  AND (p_exclude_order IS NULL OR o.id <> p_exclude_order)), 0),
    0);
$$;
GRANT EXECUTE ON FUNCTION public.store_available_qty(uuid, uuid, uuid) TO authenticated;

DROP FUNCTION IF EXISTS public.get_store_availability(uuid);
CREATE FUNCTION public.get_store_availability(p_company_id uuid)
RETURNS TABLE(product_id uuid, available numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT p.id, public.store_available_qty(p_company_id, p.id, NULL)
  FROM public.products p
  WHERE p.company_id = p_company_id AND p.is_in_store = true
    AND p.is_active = true AND p.deleted_at IS NULL;
$$;
GRANT EXECUTE ON FUNCTION public.get_store_availability(uuid) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.trg_store_order_item_stock_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_company uuid;
  v_avail numeric;
  v_name text;
BEGIN
  IF NEW.product_id IS NULL THEN RETURN NEW; END IF;
  SELECT company_id INTO v_company FROM public.store_orders WHERE id = NEW.order_id;
  IF v_company IS NULL THEN RETURN NEW; END IF;
  v_avail := public.store_available_qty(v_company, NEW.product_id, NEW.order_id);
  IF NEW.quantity > v_avail THEN
    SELECT name INTO v_name FROM public.products WHERE id = NEW.product_id;
    RAISE EXCEPTION 'الكمية المطلوبة من "%" غير متاحة (المتاح: %)', COALESCE(v_name, NEW.product_id::text), v_avail
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END
$$;
DROP TRIGGER IF EXISTS trg_store_order_item_stock_guard ON public.store_order_items;
CREATE TRIGGER trg_store_order_item_stock_guard
  BEFORE INSERT ON public.store_order_items
  FOR EACH ROW EXECUTE FUNCTION public.trg_store_order_item_stock_guard();

ALTER TABLE public.store_orders
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancel_reason text,
  ADD COLUMN IF NOT EXISTS confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS prepared_at timestamptz,
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz,
  ADD COLUMN IF NOT EXISTS status_changed_by uuid;

DROP FUNCTION IF EXISTS public.set_store_order_status(uuid, text, text);
CREATE FUNCTION public.set_store_order_status(p_order uuid, p_status text, p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_order public.store_orders%ROWTYPE;
  v_invoice uuid;
BEGIN
  IF NOT (auth_has_permission('store.orders_manage') OR auth_has_permission('store.manage')) THEN
    RAISE EXCEPTION 'Permission denied: store.orders_manage';
  END IF;
  SELECT * INTO v_order FROM public.store_orders WHERE id = p_order FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Store order not found'; END IF;
  IF NOT auth_is_platform_admin() AND v_order.company_id IS DISTINCT FROM auth_company_id() THEN
    RAISE EXCEPTION 'Permission denied for this company';
  END IF;
  IF v_order.status = 'cancelled' THEN
    RAISE EXCEPTION 'Cancelled orders cannot change status';
  END IF;

  v_invoice := v_order.invoice_id;

  IF p_status IN ('out_for_delivery', 'delivered') AND v_invoice IS NULL THEN
    v_invoice := public.settle_store_order(p_order, NULL);
  END IF;

  IF p_status = 'cancelled' AND v_invoice IS NOT NULL THEN
    PERFORM public.void_invoice(v_invoice, COALESCE(NULLIF(trim(p_reason), ''), 'إلغاء طلب متجر ' || v_order.order_number));
  END IF;

  UPDATE public.store_orders SET
    status = p_status,
    updated_at = now(),
    status_changed_by = auth.uid(),
    cancelled_at = CASE WHEN p_status = 'cancelled' THEN now() ELSE cancelled_at END,
    cancel_reason = CASE WHEN p_status = 'cancelled' THEN NULLIF(trim(p_reason), '') ELSE cancel_reason END,
    confirmed_at = CASE WHEN p_status = 'confirmed' THEN now() ELSE confirmed_at END,
    prepared_at = CASE WHEN p_status = 'preparing' THEN now() ELSE prepared_at END,
    delivered_at = CASE WHEN p_status = 'delivered' THEN now() ELSE delivered_at END
  WHERE id = p_order;

  BEGIN
    INSERT INTO public.audit_log(company_id, user_id, action, entity_type, new_values)
    VALUES (v_order.company_id, auth.uid(), 'store_order.status', 'store_order',
            jsonb_build_object('order_id', p_order, 'order_number', v_order.order_number,
                               'from', v_order.status, 'to', p_status, 'reason', p_reason));
  EXCEPTION WHEN others THEN
    RAISE WARNING 'store order audit failed: %', SQLERRM;
  END;

  RETURN jsonb_build_object('ok', true, 'status', p_status, 'invoice_id', v_invoice);
END
$$;
REVOKE ALL ON FUNCTION public.set_store_order_status(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_store_order_status(uuid, text, text) TO authenticated;

-- ============================================================================
-- Stocktake: completing a count really adjusts stock and logs movements
-- ============================================================================
DROP FUNCTION IF EXISTS public.complete_warehouse_count(uuid, boolean);
CREATE FUNCTION public.complete_warehouse_count(p_count_id uuid, p_apply_adjustments boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_count public.warehouse_counts%ROWTYPE;
  v_branch uuid;
  v_item record;
  v_lot record;
  v_diff numeric;
  v_remaining numeric;
  v_take numeric;
  v_current numeric;
  v_var_items int := 0;
  v_var_value numeric := 0;
  v_cost numeric;
BEGIN
  IF NOT (auth_has_permission('inventory.adjust') OR auth_has_permission('inventory.manage')
          OR auth_has_permission('inventory.full') OR auth_has_permission('counts.manage')
          OR auth_has_permission('counts.complete') OR auth_has_permission('warehouses.manage')) THEN
    RAISE EXCEPTION 'Permission denied: stocktake completion';
  END IF;

  SELECT * INTO v_count FROM public.warehouse_counts WHERE id = p_count_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Count not found'; END IF;
  IF NOT auth_is_platform_admin() AND v_count.company_id IS DISTINCT FROM auth_company_id() THEN
    RAISE EXCEPTION 'Permission denied for this company';
  END IF;
  IF v_count.status IN ('completed', 'cancelled') THEN
    RAISE EXCEPTION 'Count is already %', v_count.status;
  END IF;

  SELECT branch_id INTO v_branch FROM public.warehouses WHERE id = v_count.warehouse_id;

  FOR v_item IN
    SELECT * FROM public.warehouse_count_items WHERE count_id = p_count_id AND counted_qty IS NOT NULL
  LOOP
    IF v_item.lot_id IS NOT NULL THEN
      SELECT quantity_left, COALESCE(effective_unit_cost, 0) INTO v_current, v_cost
      FROM public.stock_lots WHERE id = v_item.lot_id FOR UPDATE;
      v_current := COALESCE(v_current, 0);
    ELSE
      SELECT COALESCE(SUM(quantity_left), 0), COALESCE(MAX(effective_unit_cost), 0) INTO v_current, v_cost
      FROM public.stock_lots
      WHERE company_id = v_count.company_id AND warehouse_id = v_count.warehouse_id
        AND product_id = v_item.product_id;
    END IF;

    v_diff := v_item.counted_qty - v_current;

    UPDATE public.warehouse_count_items
    SET expected_qty = v_current, variance = v_diff
    WHERE id = v_item.id;

    IF v_diff <> 0 THEN
      v_var_items := v_var_items + 1;
      v_var_value := v_var_value + v_diff * COALESCE(v_cost, 0);
    END IF;

    IF NOT p_apply_adjustments OR v_diff = 0 THEN CONTINUE; END IF;

    IF v_item.lot_id IS NOT NULL THEN
      UPDATE public.stock_lots SET quantity_left = v_item.counted_qty WHERE id = v_item.lot_id;
      INSERT INTO public.inventory_movements(company_id, branch_id, warehouse_id, product_id, lot_id,
        movement_type, quantity, reference_type, reference_id, reason, created_by)
      VALUES (v_count.company_id, v_branch, v_count.warehouse_id, v_item.product_id, v_item.lot_id,
        'adjust', v_diff, 'stock_count', p_count_id, 'جرد ' || v_count.count_number, auth.uid());
    ELSIF v_diff < 0 THEN
      v_remaining := -v_diff;
      FOR v_lot IN
        SELECT id, quantity_left FROM public.stock_lots
        WHERE company_id = v_count.company_id AND warehouse_id = v_count.warehouse_id
          AND product_id = v_item.product_id AND quantity_left > 0
        ORDER BY expiry_date ASC NULLS LAST, received_at ASC
        FOR UPDATE
      LOOP
        EXIT WHEN v_remaining <= 0;
        v_take := LEAST(v_remaining, v_lot.quantity_left);
        UPDATE public.stock_lots SET quantity_left = quantity_left - v_take WHERE id = v_lot.id;
        INSERT INTO public.inventory_movements(company_id, branch_id, warehouse_id, product_id, lot_id,
          movement_type, quantity, reference_type, reference_id, reason, created_by)
        VALUES (v_count.company_id, v_branch, v_count.warehouse_id, v_item.product_id, v_lot.id,
          'adjust', -v_take, 'stock_count', p_count_id, 'جرد ' || v_count.count_number, auth.uid());
        v_remaining := v_remaining - v_take;
      END LOOP;
    ELSE
      SELECT id INTO v_lot FROM public.stock_lots
      WHERE company_id = v_count.company_id AND warehouse_id = v_count.warehouse_id
        AND product_id = v_item.product_id
      ORDER BY received_at DESC NULLS LAST LIMIT 1;
      IF v_lot.id IS NOT NULL THEN
        UPDATE public.stock_lots SET quantity_left = quantity_left + v_diff WHERE id = v_lot.id;
        INSERT INTO public.inventory_movements(company_id, branch_id, warehouse_id, product_id, lot_id,
          movement_type, quantity, reference_type, reference_id, reason, created_by)
        VALUES (v_count.company_id, v_branch, v_count.warehouse_id, v_item.product_id, v_lot.id,
          'adjust', v_diff, 'stock_count', p_count_id, 'جرد ' || v_count.count_number, auth.uid());
      ELSE
        RAISE WARNING 'No lot to receive surplus for product %', v_item.product_id;
      END IF;
    END IF;
  END LOOP;

  UPDATE public.warehouse_counts
  SET status = 'completed', completed_at = now(), variance_items = v_var_items,
      variance_value = v_var_value, updated_at = now()
  WHERE id = p_count_id;

  RETURN jsonb_build_object('ok', true, 'variance_items', v_var_items, 'variance_value', v_var_value);
END
$$;
REVOKE ALL ON FUNCTION public.complete_warehouse_count(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_warehouse_count(uuid, boolean) TO authenticated;

-- ============================================================================
-- Subscriptions: requests to platform admin, admin review, enforced limits
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.subscription_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  request_type text NOT NULL DEFAULT 'upgrade',
  current_plan text,
  requested_plan text NOT NULL,
  note text,
  status text NOT NULL DEFAULT 'pending',
  requested_by uuid,
  requested_by_name text,
  handled_by uuid,
  handled_at timestamptz,
  admin_note text,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sub_requests_status ON public.subscription_requests(status, created_at DESC);
ALTER TABLE public.subscription_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sub_requests_select ON public.subscription_requests;
CREATE POLICY sub_requests_select ON public.subscription_requests FOR SELECT TO authenticated
  USING (auth_is_platform_admin() OR company_id = auth_company_id());
REVOKE INSERT, UPDATE, DELETE ON public.subscription_requests FROM authenticated;
GRANT SELECT ON public.subscription_requests TO authenticated;

DROP FUNCTION IF EXISTS public.plan_limits(text);
CREATE FUNCTION public.plan_limits(p_plan text) RETURNS TABLE(max_users int, max_branches int)
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE lower(p_plan) WHEN 'trial' THEN 5 WHEN 'basic' THEN 10 WHEN 'pro' THEN 50 ELSE 9999 END,
         CASE lower(p_plan) WHEN 'trial' THEN 1 WHEN 'basic' THEN 2 WHEN 'pro' THEN 10 ELSE 9999 END;
$$;

DROP FUNCTION IF EXISTS public.request_subscription_change(text, text, text);
CREATE FUNCTION public.request_subscription_change(p_plan text, p_type text DEFAULT 'upgrade', p_note text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_company uuid := auth_company_id();
  v_id uuid;
  v_current text;
  v_name text;
BEGIN
  IF v_company IS NULL THEN RAISE EXCEPTION 'No company'; END IF;
  IF NOT (auth_has_permission('subscriptions.manage') OR auth_has_permission('settings.manage')
          OR auth_has_permission('settings.full') OR EXISTS (
            SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.is_owner = true)) THEN
    RAISE EXCEPTION 'Permission denied: subscriptions.manage';
  END IF;
  IF EXISTS (SELECT 1 FROM public.subscription_requests
             WHERE company_id = v_company AND status = 'pending' AND requested_plan = p_plan) THEN
    RAISE EXCEPTION 'يوجد طلب معلق بالفعل لهذه الخطة';
  END IF;
  SELECT plan INTO v_current FROM public.subscriptions WHERE company_id = v_company
  ORDER BY created_at DESC LIMIT 1;
  SELECT COALESCE(full_name, email) INTO v_name FROM public.users WHERE id = auth.uid();
  INSERT INTO public.subscription_requests(company_id, request_type, current_plan, requested_plan, note,
                                           requested_by, requested_by_name)
  VALUES (v_company, COALESCE(p_type, 'upgrade'), v_current, p_plan, p_note, auth.uid(), v_name)
  RETURNING id INTO v_id;
  RETURN v_id;
END
$$;
REVOKE ALL ON FUNCTION public.request_subscription_change(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_subscription_change(text, text, text) TO authenticated;

DROP FUNCTION IF EXISTS public.review_subscription_request(uuid, boolean, text, integer);
CREATE FUNCTION public.review_subscription_request(p_request uuid, p_approve boolean, p_note text DEFAULT NULL, p_days integer DEFAULT 30)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  r public.subscription_requests%ROWTYPE;
  v_users int;
  v_branches int;
  v_sub uuid;
BEGIN
  IF NOT auth_is_platform_admin() THEN RAISE EXCEPTION 'Platform admin only'; END IF;
  SELECT * INTO r FROM public.subscription_requests WHERE id = p_request FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF r.status <> 'pending' THEN RAISE EXCEPTION 'Request already handled'; END IF;

  IF p_approve THEN
    SELECT pl.max_users, pl.max_branches INTO v_users, v_branches FROM public.plan_limits(r.requested_plan) pl;
    SELECT id INTO v_sub FROM public.subscriptions WHERE company_id = r.company_id ORDER BY created_at DESC LIMIT 1;
    IF v_sub IS NULL THEN
      INSERT INTO public.subscriptions(company_id, plan, status, start_date, end_date, max_users, max_branches)
      VALUES (r.company_id, r.requested_plan, 'active', current_date, current_date + p_days, v_users, v_branches);
    ELSE
      UPDATE public.subscriptions
      SET plan = r.requested_plan, status = 'active', max_users = v_users, max_branches = v_branches,
          end_date = current_date + p_days, updated_at = now()
      WHERE id = v_sub;
    END IF;
  END IF;

  UPDATE public.subscription_requests
  SET status = CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
      handled_by = auth.uid(), handled_at = now(), admin_note = p_note
  WHERE id = p_request;

  INSERT INTO public.notifications(company_id, type, title, body, link, severity, entity_type, entity_id)
  VALUES (r.company_id, 'subscription',
          CASE WHEN p_approve THEN 'تمت الموافقة على طلب الاشتراك' ELSE 'تم رفض طلب الاشتراك' END,
          COALESCE(p_note, 'الخطة المطلوبة: ' || r.requested_plan),
          'subscriptions.html', CASE WHEN p_approve THEN 'success' ELSE 'warning' END,
          'subscription_request', r.id);
END
$$;
REVOKE ALL ON FUNCTION public.review_subscription_request(uuid, boolean, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.review_subscription_request(uuid, boolean, text, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.trg_subscription_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT auth_is_platform_admin()
     AND (NEW.plan IS DISTINCT FROM OLD.plan OR NEW.max_users IS DISTINCT FROM OLD.max_users
          OR NEW.max_branches IS DISTINCT FROM OLD.max_branches OR NEW.status IS DISTINCT FROM OLD.status
          OR NEW.end_date IS DISTINCT FROM OLD.end_date) THEN
    RAISE EXCEPTION 'Subscription changes require platform admin approval';
  END IF;
  RETURN NEW;
END
$$;
DROP TRIGGER IF EXISTS trg_subscription_guard ON public.subscriptions;
CREATE TRIGGER trg_subscription_guard BEFORE UPDATE ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.trg_subscription_guard();

CREATE OR REPLACE FUNCTION public.trg_enforce_plan_limits() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_max int;
  v_used int;
BEGIN
  IF NEW.company_id IS NULL THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME = 'users' THEN
    SELECT s.max_users INTO v_max FROM public.subscriptions s
    WHERE s.company_id = NEW.company_id ORDER BY s.created_at DESC LIMIT 1;
    IF v_max IS NULL THEN RETURN NEW; END IF;
    SELECT count(*) INTO v_used FROM public.users u
    WHERE u.company_id = NEW.company_id AND u.deleted_at IS NULL AND u.id <> NEW.id;
    IF v_used >= v_max THEN
      RAISE EXCEPTION 'تم الوصول للحد الأقصى للمستخدمين في خطتك (%). قم بترقية الاشتراك.', v_max;
    END IF;
  ELSE
    SELECT s.max_branches INTO v_max FROM public.subscriptions s
    WHERE s.company_id = NEW.company_id ORDER BY s.created_at DESC LIMIT 1;
    IF v_max IS NULL THEN RETURN NEW; END IF;
    SELECT count(*) INTO v_used FROM public.branches b
    WHERE b.company_id = NEW.company_id AND b.deleted_at IS NULL AND b.id <> NEW.id;
    IF v_used >= v_max THEN
      RAISE EXCEPTION 'تم الوصول للحد الأقصى للفروع في خطتك (%). قم بترقية الاشتراك.', v_max;
    END IF;
  END IF;
  RETURN NEW;
END
$$;
DROP TRIGGER IF EXISTS trg_users_plan_limit ON public.users;
CREATE TRIGGER trg_users_plan_limit BEFORE INSERT ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.trg_enforce_plan_limits();
DROP TRIGGER IF EXISTS trg_branches_plan_limit ON public.branches;
CREATE TRIGGER trg_branches_plan_limit BEFORE INSERT ON public.branches
  FOR EACH ROW EXECUTE FUNCTION public.trg_enforce_plan_limits();

-- ============================================================================
-- Platform admin: broadcast notifications + company overview
-- ============================================================================
DROP FUNCTION IF EXISTS public.admin_send_notification(uuid, text, text, text);
CREATE FUNCTION public.admin_send_notification(p_company uuid, p_title text, p_body text DEFAULT NULL, p_severity text DEFAULT 'info')
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_count int;
BEGIN
  IF NOT auth_is_platform_admin() THEN RAISE EXCEPTION 'Platform admin only'; END IF;
  IF COALESCE(trim(p_title), '') = '' THEN RAISE EXCEPTION 'Title is required'; END IF;
  INSERT INTO public.notifications(company_id, type, title, body, severity, entity_type, metadata)
  SELECT c.id, 'platform', p_title, p_body, COALESCE(p_severity, 'info'), 'platform',
         jsonb_build_object('sent_by', auth.uid())
  FROM public.companies c
  WHERE p_company IS NULL OR c.id = p_company;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END
$$;
REVOKE ALL ON FUNCTION public.admin_send_notification(uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_send_notification(uuid, text, text, text) TO authenticated;

DROP FUNCTION IF EXISTS public.admin_company_details(uuid);
CREATE FUNCTION public.admin_company_details(p_company uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT auth_is_platform_admin() THEN RAISE EXCEPTION 'Platform admin only'; END IF;
  RETURN jsonb_build_object(
    'branches', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name,
        'is_main', b.is_main, 'is_active', b.is_active) ORDER BY b.created_at)
      FROM public.branches b WHERE b.company_id = p_company AND b.deleted_at IS NULL), '[]'::jsonb),
    'users', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', u.id, 'full_name', u.full_name,
        'email', u.email, 'is_owner', u.is_owner, 'is_active', u.is_active, 'last_login', u.last_login)
        ORDER BY u.is_owner DESC, u.created_at)
      FROM public.users u WHERE u.company_id = p_company AND u.deleted_at IS NULL), '[]'::jsonb),
    'subscription', (SELECT to_jsonb(s) FROM public.subscriptions s
      WHERE s.company_id = p_company ORDER BY s.created_at DESC LIMIT 1)
  );
END
$$;
REVOKE ALL ON FUNCTION public.admin_company_details(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_company_details(uuid) TO authenticated;

DROP FUNCTION IF EXISTS public.admin_set_user_active(uuid, boolean);
CREATE FUNCTION public.admin_set_user_active(p_user uuid, p_active boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT auth_is_platform_admin() THEN RAISE EXCEPTION 'Platform admin only'; END IF;
  UPDATE public.users SET is_active = p_active, updated_at = now() WHERE id = p_user;
END
$$;
REVOKE ALL ON FUNCTION public.admin_set_user_active(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_user_active(uuid, boolean) TO authenticated;

COMMIT;
