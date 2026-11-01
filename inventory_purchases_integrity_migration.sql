-- Atomic, company-scoped purchase receipts with retry-safe request IDs.
-- Apply after the base schema.
BEGIN;

ALTER TABLE public.purchase_order_items
  ADD COLUMN IF NOT EXISTS is_purchase_unit boolean NOT NULL DEFAULT false;

ALTER TABLE public.purchase_orders
  ADD COLUMN IF NOT EXISTS received_date date;

UPDATE public.purchase_order_items
SET is_purchase_unit = (
  COALESCE(units_per_purchase, 1) > 1
  AND COALESCE(
    abs(
      COALESCE(base_qty, 0) / NULLIF(quantity, 0)
      - COALESCE(units_per_purchase, 1)
    ) < 0.001,
    false
  )
)
WHERE COALESCE(received_qty, 0) = 0;

CREATE TABLE IF NOT EXISTS public.purchase_receipts (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  purchase_order_id uuid NOT NULL REFERENCES public.purchase_orders(id) ON DELETE RESTRICT,
  supplier_id uuid REFERENCES public.suppliers(id) ON DELETE SET NULL,
  branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL,
  warehouse_id uuid NOT NULL REFERENCES public.warehouses(id) ON DELETE RESTRICT,
  notes text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id, id)
);

CREATE INDEX IF NOT EXISTS idx_purchase_receipts_po
  ON public.purchase_receipts(company_id, purchase_order_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.purchase_receipt_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id uuid NOT NULL REFERENCES public.purchase_receipts(id) ON DELETE CASCADE,
  purchase_order_item_id uuid NOT NULL REFERENCES public.purchase_order_items(id) ON DELETE RESTRICT,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  lot_id uuid NOT NULL REFERENCES public.stock_lots(id) ON DELETE RESTRICT,
  received_quantity numeric(14,3) NOT NULL CHECK (received_quantity > 0),
  base_quantity numeric(14,3) NOT NULL CHECK (base_quantity > 0),
  unit_cost numeric(14,2) NOT NULL CHECK (unit_cost >= 0),
  sale_price numeric(14,2) NOT NULL CHECK (sale_price >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_purchase_receipt_items_receipt
  ON public.purchase_receipt_items(receipt_id);

CREATE OR REPLACE FUNCTION public.approve_purchase_order(p_po_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_po public.purchase_orders%ROWTYPE;
BEGIN
  IF NOT (
    public.auth_has_permission('purchases.approve')
    OR public.auth_has_permission('purchases.full')
    OR public.auth_has_permission('admin.full')
  ) THEN
    RAISE EXCEPTION 'Permission denied: purchase order approval';
  END IF;

  SELECT * INTO v_po
  FROM public.purchase_orders
  WHERE id = p_po_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Purchase order not found'; END IF;
  IF NOT public.auth_is_platform_admin()
     AND v_po.company_id IS DISTINCT FROM public.auth_company_id() THEN
    RAISE EXCEPTION 'Permission denied for this company';
  END IF;
  IF v_po.status <> 'pending' THEN
    RAISE EXCEPTION 'Only pending purchase orders can be approved';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.purchase_order_items WHERE po_id = p_po_id
  ) THEN
    RAISE EXCEPTION 'Cannot approve a purchase order with no items';
  END IF;

  UPDATE public.purchase_orders
  SET status = 'approved'::public.po_status,
      approved_by = auth.uid(),
      updated_at = now()
  WHERE id = p_po_id;
END
$$;

ALTER TABLE public.purchase_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_receipt_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS purchase_receipts_all ON public.purchase_receipts;
CREATE POLICY purchase_receipts_all ON public.purchase_receipts FOR ALL
  USING (company_id = public.auth_company_id() OR public.auth_is_platform_admin())
  WITH CHECK (company_id = public.auth_company_id() OR public.auth_is_platform_admin());

DROP POLICY IF EXISTS purchase_receipt_items_all ON public.purchase_receipt_items;
CREATE POLICY purchase_receipt_items_all ON public.purchase_receipt_items FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.purchase_receipts pr
      WHERE pr.id = receipt_id
        AND (pr.company_id = public.auth_company_id() OR public.auth_is_platform_admin())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.purchase_receipts pr
      WHERE pr.id = receipt_id
        AND (pr.company_id = public.auth_company_id() OR public.auth_is_platform_admin())
    )
  );

CREATE OR REPLACE FUNCTION public.record_purchase_receipt(
  p_receipt_id uuid,
  p_company uuid,
  p_branch uuid,
  p_warehouse uuid,
  p_supplier uuid,
  p_po uuid,
  p_items jsonb,
  p_notes text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_po public.purchase_orders%ROWTYPE;
  v_po_item public.purchase_order_items%ROWTYPE;
  v_item jsonb;
  v_receipt_id uuid;
  v_lot_id uuid;
  v_product public.products%ROWTYPE;
  v_received_qty numeric;
  v_base_qty numeric;
  v_multiplier numeric;
  v_unit_cost numeric;
  v_sale_price numeric;
  v_expiry_date date;
  v_lot_number text;
  v_line_number integer := 0;
  v_all_received boolean;
  v_received_lines integer := 0;
  v_warehouse_requires_expiry boolean;
BEGIN
  IF p_receipt_id IS NULL THEN
    RAISE EXCEPTION 'Receipt request ID is required';
  END IF;
  IF NOT (
    public.auth_has_permission('purchases.receive')
    OR public.auth_has_permission('purchases.full')
    OR public.auth_has_permission('admin.full')
  ) THEN
    RAISE EXCEPTION 'Permission denied: purchase receipt';
  END IF;
  IF NOT public.auth_is_platform_admin()
     AND p_company IS DISTINCT FROM public.auth_company_id() THEN
    RAISE EXCEPTION 'Permission denied for this company';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array'
     OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'At least one receipt line is required';
  END IF;

  SELECT * INTO v_po
  FROM public.purchase_orders
  WHERE id = p_po
    AND company_id = p_company
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Purchase order not found'; END IF;

  SELECT id INTO v_receipt_id
  FROM public.purchase_receipts
  WHERE id = p_receipt_id
    AND company_id = p_company
    AND purchase_order_id = p_po
  FOR UPDATE;
  IF FOUND THEN
    RETURN jsonb_build_object('receipt_id', v_receipt_id, 'duplicate', true);
  END IF;

  IF v_po.status NOT IN ('approved', 'partially_received') THEN
    RAISE EXCEPTION 'Only approved or partially received purchase orders can be received';
  END IF;
  IF v_po.supplier_id IS DISTINCT FROM p_supplier
     OR v_po.warehouse_id IS DISTINCT FROM p_warehouse
     OR v_po.branch_id IS DISTINCT FROM p_branch THEN
    RAISE EXCEPTION 'Receipt supplier, branch, or warehouse does not match the purchase order';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.warehouses w
    WHERE w.id = p_warehouse
      AND w.company_id = p_company
      AND (w.branch_id = p_branch OR w.branch_id IS NULL)
      AND w.is_active = true
      AND w.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Receipt warehouse is unavailable';
  END IF;

  INSERT INTO public.purchase_receipts(
    id, company_id, purchase_order_id, supplier_id,
    branch_id, warehouse_id, notes, created_by
  ) VALUES (
    p_receipt_id, p_company, p_po, p_supplier,
    p_branch, p_warehouse, NULLIF(trim(p_notes), ''), auth.uid()
  )
  ON CONFLICT (id) DO NOTHING
  RETURNING id INTO v_receipt_id;

  IF v_receipt_id IS NULL THEN
    SELECT id INTO v_receipt_id
    FROM public.purchase_receipts
    WHERE id = p_receipt_id
      AND company_id = p_company
      AND purchase_order_id = p_po
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Receipt request ID was already used for a different operation';
    END IF;
    RETURN jsonb_build_object('receipt_id', v_receipt_id, 'duplicate', true);
  END IF;

  SELECT COALESCE(w.require_expiry_date, true)
  INTO v_warehouse_requires_expiry
  FROM public.warehouses w
  WHERE w.id = p_warehouse;
  SELECT COALESCE(
    (
      SELECT (cs.value #>> '{}')::boolean
      FROM public.company_settings cs
      WHERE cs.company_id = p_company
        AND cs.branch_id IS NULL
        AND cs.category = 'inventory'
        AND cs.key = 'require_expiry_date'
      LIMIT 1
    ),
    v_warehouse_requires_expiry
  ) INTO v_warehouse_requires_expiry;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_items) AS line(value)
    WHERE NULLIF(line.value->>'purchase_order_item_id', '') IS NULL
  ) THEN
    RAISE EXCEPTION 'Each receipt line must identify its purchase order item';
  END IF;
  IF (
    SELECT COUNT(*) <> COUNT(DISTINCT value->>'purchase_order_item_id')
    FROM jsonb_array_elements(p_items) AS lines(value)
  ) THEN
    RAISE EXCEPTION 'A purchase order item may appear only once per receipt';
  END IF;

  FOR v_item IN
    SELECT value
    FROM jsonb_array_elements(p_items)
    ORDER BY value->>'purchase_order_item_id'
  LOOP
    v_line_number := v_line_number + 1;
    v_received_qty := NULLIF(v_item->>'received_quantity', '')::numeric;
    v_sale_price := COALESCE(NULLIF(v_item->>'sale_price', '')::numeric, 0);
    v_expiry_date := NULLIF(v_item->>'expiry_date', '')::date;
    v_lot_number := NULLIF(trim(v_item->>'lot_number'), '');

    IF v_received_qty IS NULL OR v_received_qty <= 0 THEN
      RAISE EXCEPTION 'Receipt quantity must be greater than zero';
    END IF;
    IF v_sale_price < 0 THEN
      RAISE EXCEPTION 'Sale price cannot be negative';
    END IF;
    IF v_warehouse_requires_expiry AND v_expiry_date IS NULL THEN
      RAISE EXCEPTION 'Expiry date is required for this warehouse';
    END IF;
    IF v_expiry_date IS NOT NULL AND v_expiry_date < current_date THEN
      RAISE EXCEPTION 'Expiry date cannot be in the past';
    END IF;

    SELECT * INTO v_po_item
    FROM public.purchase_order_items
    WHERE id = (v_item->>'purchase_order_item_id')::uuid
      AND po_id = p_po
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Purchase order item % not found', v_item->>'purchase_order_item_id';
    END IF;
    IF v_item->>'product_id' IS NOT NULL
       AND (v_item->>'product_id')::uuid IS DISTINCT FROM v_po_item.product_id THEN
      RAISE EXCEPTION 'Receipt product does not match its purchase order item';
    END IF;
    IF COALESCE(v_po_item.received_qty, 0) + v_received_qty > v_po_item.quantity + 0.0005 THEN
      RAISE EXCEPTION 'Receipt quantity exceeds the remaining ordered quantity for item %',
        v_po_item.id;
    END IF;

    SELECT * INTO v_product
    FROM public.products
    WHERE id = v_po_item.product_id
      AND company_id = p_company
      AND is_active = true
      AND deleted_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Product % is not active in this company', v_po_item.product_id;
    END IF;

    v_multiplier := CASE
      WHEN v_po_item.is_purchase_unit THEN COALESCE(NULLIF(v_po_item.units_per_purchase, 0), 1)
      ELSE 1
    END;
    v_base_qty := round(v_received_qty * v_multiplier, 3);
    v_unit_cost := COALESCE(
      NULLIF(v_po_item.base_unit_cost, 0),
      v_po_item.unit_cost / v_multiplier,
      0
    );
    IF v_base_qty <= 0 OR v_unit_cost < 0 THEN
      RAISE EXCEPTION 'Invalid base quantity or unit cost for item %', v_po_item.id;
    END IF;

    v_lot_id := gen_random_uuid();
    IF v_lot_number IS NULL THEN
      v_lot_number := 'PO-' || substr(replace(p_po::text, '-', ''), 1, 8)
        || '-' || v_line_number::text;
    END IF;

    INSERT INTO public.stock_lots(
      id, company_id, branch_id, warehouse_id, product_id,
      lot_number, quantity_in, quantity_left, effective_unit_cost,
      sale_price, expiry_date
    ) VALUES (
      v_lot_id, p_company, p_branch, p_warehouse, v_po_item.product_id,
      v_lot_number, v_base_qty, v_base_qty, v_unit_cost,
      v_sale_price, COALESCE(v_expiry_date, current_date + 365)
    );

    INSERT INTO public.inventory_movements(
      company_id, branch_id, warehouse_id, product_id, lot_id,
      movement_type, quantity, unit_cost, reference_type, reference_id,
      reason, created_by
    ) VALUES (
      p_company, p_branch, p_warehouse, v_po_item.product_id, v_lot_id,
      'in', v_base_qty, v_unit_cost, 'purchase_receipt', v_receipt_id,
      'استلام أمر شراء ' || v_po.po_number, auth.uid()
    );

    INSERT INTO public.purchase_receipt_items(
      receipt_id, purchase_order_item_id, product_id, lot_id,
      received_quantity, base_quantity, unit_cost, sale_price
    ) VALUES (
      v_receipt_id, v_po_item.id, v_po_item.product_id, v_lot_id,
      v_received_qty, v_base_qty, v_unit_cost, v_sale_price
    );

    UPDATE public.purchase_order_items
    SET received_qty = COALESCE(received_qty, 0) + v_received_qty
    WHERE id = v_po_item.id;

    v_received_lines := v_received_lines + 1;
  END LOOP;

  SELECT COALESCE(bool_and(COALESCE(received_qty, 0) >= quantity), false)
  INTO v_all_received
  FROM public.purchase_order_items
  WHERE po_id = p_po;

  UPDATE public.purchase_orders
  SET status = CASE
        WHEN v_all_received THEN 'received'::public.po_status
        ELSE 'partially_received'::public.po_status
      END,
      received_date = CASE WHEN v_all_received THEN current_date ELSE received_date END,
      updated_at = now()
  WHERE id = p_po;

  RETURN jsonb_build_object(
    'receipt_id', v_receipt_id,
    'duplicate', false,
    'received_lines', v_received_lines,
    'status', CASE WHEN v_all_received THEN 'received' ELSE 'partially_received' END
  );
END
$$;

REVOKE ALL ON FUNCTION public.record_receipt(uuid, uuid, uuid, uuid, uuid, jsonb, text) FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION public.record_purchase_receipt(uuid, uuid, uuid, uuid, uuid, uuid, jsonb, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.approve_purchase_order(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_purchase_receipt(uuid, uuid, uuid, uuid, uuid, uuid, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_purchase_order(uuid) TO authenticated;
GRANT SELECT ON public.purchase_receipts, public.purchase_receipt_items TO authenticated;

COMMIT;
