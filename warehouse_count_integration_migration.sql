-- Stock count, inventory valuation, and accounting integration.
-- Apply after the base schema and pos_integrity_migration.sql.
BEGIN;

ALTER TABLE public.warehouse_counts
  ADD COLUMN IF NOT EXISTS total_items integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS counted_items integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS variance_items integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS variance_value numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS started_at timestamptz,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancel_reason text;

ALTER TABLE public.warehouse_count_items
  ADD COLUMN IF NOT EXISTS lot_id uuid REFERENCES public.stock_lots(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS expected_qty numeric(14,3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS system_qty numeric(14,3),
  ADD COLUMN IF NOT EXISTS counted_qty numeric(14,3),
  ADD COLUMN IF NOT EXISTS variance numeric(14,3)
    GENERATED ALWAYS AS (
      CASE
        WHEN counted_qty IS NULL THEN NULL
        ELSE counted_qty - COALESCE(system_qty, expected_qty, 0)
      END
    ) STORED,
  ADD COLUMN IF NOT EXISTS unit_cost numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lot_number text,
  ADD COLUMN IF NOT EXISTS expiry_date date,
  ADD COLUMN IF NOT EXISTS variance_value numeric(14,2)
    GENERATED ALWAYS AS (
      round(
        COALESCE(counted_qty - COALESCE(system_qty, expected_qty, 0), 0)
        * COALESCE(unit_cost, 0),
        2
      )
    ) STORED;

DO $$
DECLARE
  v_variance_generated boolean;
  v_value_generated boolean;
BEGIN
  SELECT COALESCE((
    SELECT is_generated = 'ALWAYS'
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'warehouse_count_items'
      AND column_name = 'variance'
  ), false), COALESCE((
    SELECT is_generated = 'ALWAYS'
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'warehouse_count_items'
      AND column_name = 'variance_value'
  ), false)
  INTO v_variance_generated, v_value_generated;

  IF NOT v_variance_generated OR NOT v_value_generated THEN
    ALTER TABLE public.warehouse_count_items
      DROP COLUMN IF EXISTS variance_value,
      DROP COLUMN IF EXISTS variance;

    ALTER TABLE public.warehouse_count_items
      ADD COLUMN variance numeric(14,3)
        GENERATED ALWAYS AS (
          CASE
            WHEN counted_qty IS NULL THEN NULL
            ELSE counted_qty - COALESCE(system_qty, expected_qty, 0)
          END
        ) STORED,
      ADD COLUMN variance_value numeric(14,2)
        GENERATED ALWAYS AS (
          round(
            COALESCE(counted_qty - COALESCE(system_qty, expected_qty, 0), 0)
            * COALESCE(unit_cost, 0),
            2
          )
        ) STORED;
  END IF;
END
$$;

UPDATE public.warehouse_count_items wci
SET system_qty = COALESCE(wci.system_qty, wci.expected_qty, 0),
    expected_qty = COALESCE(wci.system_qty, wci.expected_qty, 0),
    unit_cost = COALESCE(
      (SELECT sl.effective_unit_cost FROM public.stock_lots sl WHERE sl.id = wci.lot_id),
      (SELECT p.cost_price FROM public.products p WHERE p.id = wci.product_id),
      0
    ),
    lot_number = COALESCE(
      wci.lot_number,
      (SELECT sl.lot_number FROM public.stock_lots sl WHERE sl.id = wci.lot_id)
    ),
    expiry_date = COALESCE(
      wci.expiry_date,
      (SELECT sl.expiry_date FROM public.stock_lots sl WHERE sl.id = wci.lot_id)
    )
WHERE wci.system_qty IS NULL OR wci.unit_cost = 0;

CREATE OR REPLACE VIEW public.v_warehouse_counts_summary_v2 AS
SELECT
  wc.id,
  wc.company_id,
  wc.warehouse_id,
  w.name AS warehouse_name,
  wc.count_number,
  wc.count_type,
  wc.status,
  COALESCE(wc.started_at, wc.created_at) AS started_at,
  wc.completed_at,
  COUNT(wci.id)::integer AS total_items,
  COUNT(wci.id) FILTER (WHERE wci.counted_qty IS NOT NULL)::integer AS counted_items,
  wc.variance_items,
  wc.variance_value,
  wc.notes,
  wc.cancel_reason,
  wc.created_at
FROM public.warehouse_counts wc
JOIN public.warehouses w ON w.id = wc.warehouse_id
LEFT JOIN public.warehouse_count_items wci ON wci.count_id = wc.id
WHERE wc.company_id = public.auth_company_id()
   OR public.auth_is_platform_admin()
GROUP BY wc.id, w.name;

DROP FUNCTION IF EXISTS public.create_warehouse_count(uuid, uuid, text, text, uuid[]);
CREATE FUNCTION public.create_warehouse_count(
  p_company_id uuid,
  p_warehouse_id uuid,
  p_count_type text DEFAULT 'full',
  p_notes text DEFAULT NULL,
  p_product_ids uuid[] DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_count_id uuid := gen_random_uuid();
  v_count_number text;
  v_branch_id uuid;
  v_item_count integer;
BEGIN
  IF NOT (
    public.auth_has_permission('warehouses.count')
    OR public.auth_has_permission('counts.manage')
    OR public.auth_has_permission('inventory.use')
    OR public.auth_has_permission('inventory.full')
    OR public.auth_has_permission('admin.full')
  ) THEN
    RAISE EXCEPTION 'Permission denied: stocktake creation';
  END IF;
  IF NOT public.auth_is_platform_admin()
     AND p_company_id IS DISTINCT FROM public.auth_company_id() THEN
    RAISE EXCEPTION 'Permission denied for this company';
  END IF;
  IF p_count_type IS NULL OR p_count_type NOT IN ('full', 'partial', 'spot', 'cycle') THEN
    RAISE EXCEPTION 'Invalid stock count type';
  END IF;

  SELECT branch_id INTO v_branch_id
  FROM public.warehouses
  WHERE id = p_warehouse_id
    AND company_id = p_company_id
    AND is_active = true
    AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Warehouse not found or inactive';
  END IF;

  v_count_number := 'CNT-' || to_char(current_date, 'YYYYMMDD') || '-'
    || upper(substr(replace(v_count_id::text, '-', ''), 1, 8));

  INSERT INTO public.warehouse_counts(
    id, company_id, warehouse_id, count_number, count_type, status, notes, created_by
  ) VALUES (
    v_count_id, p_company_id, p_warehouse_id, v_count_number,
    p_count_type, 'draft', NULLIF(trim(p_notes), ''), auth.uid()
  );

  INSERT INTO public.warehouse_count_items(
    count_id, product_id, lot_id, expected_qty, system_qty, unit_cost,
    lot_number, expiry_date
  )
  SELECT
    v_count_id, p.id, NULL,
    COALESCE(SUM(sl.quantity_left), 0),
    COALESCE(SUM(sl.quantity_left), 0),
    COALESCE(
      SUM(sl.quantity_left * sl.effective_unit_cost)
        / NULLIF(SUM(sl.quantity_left), 0),
      p.cost_price,
      0
    ),
    NULL,
    NULL
  FROM public.products p
  LEFT JOIN public.stock_lots sl
    ON sl.company_id = p_company_id
   AND sl.warehouse_id = p_warehouse_id
   AND sl.product_id = p.id
   AND sl.is_quarantined = false
  WHERE p.company_id = p_company_id
    AND p.is_active = true
    AND p.deleted_at IS NULL
    AND (p_product_ids IS NULL OR p.id = ANY(p_product_ids))
  GROUP BY p.id;

  GET DIAGNOSTICS v_item_count = ROW_COUNT;
  IF v_item_count = 0 THEN
    RAISE EXCEPTION 'No active products were found for this count';
  END IF;

  UPDATE public.warehouse_counts
  SET total_items = v_item_count, updated_at = now()
  WHERE id = v_count_id;

  RETURN v_count_id;
END
$$;

DROP FUNCTION IF EXISTS public.start_warehouse_count(uuid);
CREATE FUNCTION public.start_warehouse_count(p_count_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_count public.warehouse_counts%ROWTYPE;
BEGIN
  IF NOT (
    public.auth_has_permission('warehouses.count')
    OR public.auth_has_permission('counts.manage')
    OR public.auth_has_permission('inventory.use')
    OR public.auth_has_permission('inventory.full')
    OR public.auth_has_permission('admin.full')
  ) THEN
    RAISE EXCEPTION 'Permission denied: stocktake start';
  END IF;

  SELECT * INTO v_count
  FROM public.warehouse_counts
  WHERE id = p_count_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Count not found'; END IF;
  IF NOT public.auth_is_platform_admin()
     AND v_count.company_id IS DISTINCT FROM public.auth_company_id() THEN
    RAISE EXCEPTION 'Permission denied for this company';
  END IF;
  IF v_count.status <> 'draft' THEN
    RAISE EXCEPTION 'Only draft counts can be started';
  END IF;

  UPDATE public.warehouse_counts
  SET status = 'in_progress', started_at = now(), updated_at = now()
  WHERE id = p_count_id;
END
$$;

DROP FUNCTION IF EXISTS public.update_count_item(uuid, numeric);
CREATE FUNCTION public.update_count_item(
  p_item_id uuid,
  p_counted_qty numeric
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_count public.warehouse_counts%ROWTYPE;
  v_item public.warehouse_count_items%ROWTYPE;
BEGIN
  IF NOT (
    public.auth_has_permission('warehouses.count')
    OR public.auth_has_permission('counts.manage')
    OR public.auth_has_permission('inventory.use')
    OR public.auth_has_permission('inventory.full')
    OR public.auth_has_permission('admin.full')
  ) THEN
    RAISE EXCEPTION 'Permission denied: stocktake update';
  END IF;
  IF p_counted_qty IS NOT NULL AND p_counted_qty < 0 THEN
    RAISE EXCEPTION 'Counted quantity cannot be negative';
  END IF;

  SELECT wci.* INTO v_item
  FROM public.warehouse_count_items wci
  WHERE wci.id = p_item_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Count item not found'; END IF;

  SELECT * INTO v_count
  FROM public.warehouse_counts
  WHERE id = v_item.count_id
  FOR UPDATE;
  IF v_count.status <> 'in_progress' THEN
    RAISE EXCEPTION 'Only in-progress counts can be updated';
  END IF;
  IF NOT public.auth_is_platform_admin()
     AND v_count.company_id IS DISTINCT FROM public.auth_company_id() THEN
    RAISE EXCEPTION 'Permission denied for this company';
  END IF;

  UPDATE public.warehouse_count_items
  SET counted_qty = p_counted_qty
  WHERE id = p_item_id;

  UPDATE public.warehouse_counts wc
  SET counted_items = (
        SELECT COUNT(*)::integer FROM public.warehouse_count_items
        WHERE count_id = v_count.id AND counted_qty IS NOT NULL
      ),
      variance_items = (
        SELECT COUNT(*)::integer FROM public.warehouse_count_items
        WHERE count_id = v_count.id AND counted_qty IS NOT NULL AND COALESCE(variance, 0) <> 0
      ),
      variance_value = (
        SELECT COALESCE(SUM(variance_value), 0)
        FROM public.warehouse_count_items WHERE count_id = v_count.id
      ),
      updated_at = now()
  WHERE wc.id = v_count.id;
END
$$;

DROP FUNCTION IF EXISTS public.cancel_warehouse_count(uuid, text);
CREATE FUNCTION public.cancel_warehouse_count(
  p_count_id uuid,
  p_reason text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_count public.warehouse_counts%ROWTYPE;
BEGIN
  IF NOT (
    public.auth_has_permission('warehouses.count')
    OR public.auth_has_permission('counts.manage')
    OR public.auth_has_permission('inventory.full')
    OR public.auth_has_permission('admin.full')
  ) THEN
    RAISE EXCEPTION 'Permission denied: stocktake cancellation';
  END IF;
  IF NULLIF(trim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'A cancellation reason is required';
  END IF;

  SELECT * INTO v_count
  FROM public.warehouse_counts
  WHERE id = p_count_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Count not found'; END IF;
  IF NOT public.auth_is_platform_admin()
     AND v_count.company_id IS DISTINCT FROM public.auth_company_id() THEN
    RAISE EXCEPTION 'Permission denied for this company';
  END IF;
  IF v_count.status NOT IN ('draft', 'in_progress') THEN
    RAISE EXCEPTION 'Only draft or in-progress counts can be cancelled';
  END IF;

  UPDATE public.warehouse_counts
  SET status = 'cancelled', cancel_reason = trim(p_reason), updated_at = now()
  WHERE id = p_count_id;
END
$$;

DROP FUNCTION IF EXISTS public.complete_warehouse_count(uuid, boolean);
CREATE FUNCTION public.complete_warehouse_count(
  p_count_id uuid,
  p_apply_adjustments boolean DEFAULT true
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_count public.warehouse_counts%ROWTYPE;
  v_branch_id uuid;
  v_item record;
  v_lot record;
  v_product public.products%ROWTYPE;
  v_inventory_account uuid;
  v_cogs_account uuid;
  v_inventory_code text;
  v_cogs_code text;
  v_current numeric;
  v_cost numeric;
  v_delta numeric;
  v_remaining numeric;
  v_take numeric;
  v_gain_value numeric := 0;
  v_loss_value numeric := 0;
  v_variance_value numeric := 0;
  v_variance_items integer := 0;
  v_journal_id uuid;
  v_journal_number text;
BEGIN
  IF NOT (
    public.auth_has_permission('inventory.adjust')
    OR public.auth_has_permission('inventory.manage')
    OR public.auth_has_permission('inventory.full')
    OR public.auth_has_permission('counts.manage')
    OR public.auth_has_permission('counts.complete')
    OR public.auth_has_permission('warehouses.manage')
    OR public.auth_has_permission('admin.full')
  ) THEN
    RAISE EXCEPTION 'Permission denied: stocktake completion';
  END IF;

  SELECT * INTO v_count
  FROM public.warehouse_counts
  WHERE id = p_count_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Count not found'; END IF;
  IF NOT public.auth_is_platform_admin()
     AND v_count.company_id IS DISTINCT FROM public.auth_company_id() THEN
    RAISE EXCEPTION 'Permission denied for this company';
  END IF;
  IF v_count.status <> 'in_progress' THEN
    RAISE EXCEPTION 'Only in-progress counts can be completed';
  END IF;
  IF v_count.count_type = 'full' AND EXISTS (
    SELECT 1 FROM public.warehouse_count_items
    WHERE count_id = p_count_id AND counted_qty IS NULL
  ) THEN
    RAISE EXCEPTION 'Complete every item before closing a full stock count';
  END IF;

  SELECT branch_id INTO v_branch_id
  FROM public.warehouses
  WHERE id = v_count.warehouse_id
    AND company_id = v_count.company_id;

  FOR v_item IN
    SELECT wci.*, p.cost_price, p.sale_price, p.shelf_life_days
    FROM public.warehouse_count_items wci
    JOIN public.products p ON p.id = wci.product_id
    WHERE wci.count_id = p_count_id
      AND wci.counted_qty IS NOT NULL
    ORDER BY wci.product_id, wci.lot_id NULLS LAST
  LOOP
    IF v_item.lot_id IS NOT NULL THEN
      SELECT quantity_left, COALESCE(effective_unit_cost, 0)
      INTO v_current, v_cost
      FROM public.stock_lots
      WHERE id = v_item.lot_id
        AND company_id = v_count.company_id
        AND warehouse_id = v_count.warehouse_id
      FOR UPDATE;
      IF NOT FOUND THEN
        v_current := 0;
        v_cost := COALESCE(v_item.unit_cost, v_item.cost_price, 0);
      END IF;
    ELSE
      SELECT
        COALESCE(SUM(quantity_left), 0),
        COALESCE(
          SUM(quantity_left * effective_unit_cost) / NULLIF(SUM(quantity_left), 0),
          COALESCE(v_item.unit_cost, v_item.cost_price, 0)
        )
      INTO v_current, v_cost
      FROM public.stock_lots
      WHERE company_id = v_count.company_id
        AND warehouse_id = v_count.warehouse_id
        AND product_id = v_item.product_id
        AND is_quarantined = false;
    END IF;

    v_delta := v_item.counted_qty - COALESCE(v_current, 0);
    v_cost := COALESCE(v_item.unit_cost, v_cost, v_item.cost_price, 0);
    v_variance_value := v_variance_value + v_delta * v_cost;

    UPDATE public.warehouse_count_items
    SET expected_qty = COALESCE(v_current, 0),
    system_qty = COALESCE(v_current, 0),
    unit_cost = v_cost
    WHERE id = v_item.id;

    IF v_delta <> 0 THEN
      v_variance_items := v_variance_items + 1;
      IF v_delta > 0 THEN
        v_gain_value := v_gain_value + v_delta * v_cost;
      ELSE
        v_loss_value := v_loss_value + abs(v_delta) * v_cost;
      END IF;
    END IF;

    IF NOT p_apply_adjustments OR v_delta = 0 THEN
      CONTINUE;
    END IF;

    IF v_item.lot_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.stock_lots
      WHERE id = v_item.lot_id
        AND company_id = v_count.company_id
        AND warehouse_id = v_count.warehouse_id
    ) THEN
      UPDATE public.stock_lots
      SET quantity_left = v_item.counted_qty, updated_at = now()
      WHERE id = v_item.lot_id;

      INSERT INTO public.inventory_movements(
        company_id, branch_id, warehouse_id, product_id, lot_id,
        movement_type, quantity, unit_cost, reference_type, reference_id,
        reason, created_by
      ) VALUES (
        v_count.company_id, v_branch_id, v_count.warehouse_id, v_item.product_id,
        v_item.lot_id, 'adjust', v_delta, v_cost, 'stock_count', p_count_id,
        'تسوية جرد ' || v_count.count_number, auth.uid()
      );
    ELSIF v_delta < 0 THEN
      v_remaining := abs(v_delta);
      FOR v_lot IN
        SELECT id, quantity_left, effective_unit_cost
        FROM public.stock_lots
        WHERE company_id = v_count.company_id
          AND warehouse_id = v_count.warehouse_id
          AND product_id = v_item.product_id
          AND is_quarantined = false
          AND quantity_left > 0
        ORDER BY expiry_date ASC NULLS LAST, received_at ASC
        FOR UPDATE
      LOOP
        EXIT WHEN v_remaining <= 0;
        v_take := LEAST(v_remaining, v_lot.quantity_left);
        UPDATE public.stock_lots
        SET quantity_left = quantity_left - v_take, updated_at = now()
        WHERE id = v_lot.id;
        INSERT INTO public.inventory_movements(
          company_id, branch_id, warehouse_id, product_id, lot_id,
          movement_type, quantity, unit_cost, reference_type, reference_id,
          reason, created_by
        ) VALUES (
          v_count.company_id, v_branch_id, v_count.warehouse_id, v_item.product_id,
          v_lot.id, 'adjust', -v_take, COALESCE(v_lot.effective_unit_cost, v_cost),
          'stock_count', p_count_id, 'تسوية جرد ' || v_count.count_number, auth.uid()
        );
        v_remaining := v_remaining - v_take;
      END LOOP;
      IF v_remaining > 0 THEN
        RAISE EXCEPTION 'Insufficient stock lots to apply count for product %', v_item.product_id;
      END IF;
    ELSIF v_delta > 0 THEN
      SELECT * INTO v_product
      FROM public.products
      WHERE id = v_item.product_id
        AND company_id = v_count.company_id
      FOR SHARE;

      SELECT id INTO v_lot
      FROM public.stock_lots
      WHERE company_id = v_count.company_id
        AND warehouse_id = v_count.warehouse_id
        AND product_id = v_item.product_id
        AND is_quarantined = false
      ORDER BY received_at DESC NULLS LAST
      LIMIT 1
      FOR UPDATE;

      IF v_lot.id IS NOT NULL THEN
        UPDATE public.stock_lots
        SET quantity_left = quantity_left + v_delta, updated_at = now()
        WHERE id = v_lot.id;
        INSERT INTO public.inventory_movements(
          company_id, branch_id, warehouse_id, product_id, lot_id,
          movement_type, quantity, unit_cost, reference_type, reference_id,
          reason, created_by
        ) VALUES (
          v_count.company_id, v_branch_id, v_count.warehouse_id, v_item.product_id,
          v_lot.id, 'adjust', v_delta, v_cost, 'stock_count', p_count_id,
          'تسوية جرد ' || v_count.count_number, auth.uid()
        );
      ELSE
        INSERT INTO public.stock_lots(
          company_id, branch_id, warehouse_id, product_id, lot_number,
          quantity_in, quantity_left, effective_unit_cost, sale_price, expiry_date
        ) VALUES (
          v_count.company_id, v_branch_id, v_count.warehouse_id, v_item.product_id,
          'COUNT-' || substr(replace(p_count_id::text, '-', ''), 1, 8),
          v_delta, v_delta, v_cost, COALESCE(v_product.sale_price, 0),
          current_date + COALESCE(v_product.shelf_life_days, 365)
        )
        RETURNING id INTO v_lot;

        INSERT INTO public.inventory_movements(
          company_id, branch_id, warehouse_id, product_id, lot_id,
          movement_type, quantity, unit_cost, reference_type, reference_id,
          reason, created_by
        ) VALUES (
          v_count.company_id, v_branch_id, v_count.warehouse_id, v_item.product_id,
          v_lot.id, 'adjust', v_delta, v_cost, 'stock_count', p_count_id,
          'تسوية جرد ' || v_count.count_number, auth.uid()
        );
      END IF;
    END IF;
  END LOOP;

  v_gain_value := round(v_gain_value, 2);
  v_loss_value := round(v_loss_value, 2);
  v_variance_value := round(v_variance_value, 2);

  IF p_apply_adjustments AND (v_gain_value > 0 OR v_loss_value > 0) THEN
    SELECT COALESCE(
      (SELECT value #>> '{}' FROM public.company_settings
       WHERE company_id = v_count.company_id AND branch_id IS NULL
         AND category = 'accounting' AND key = 'default_inventory_account'
       LIMIT 1),
      '1300'
    ) INTO v_inventory_code;

    SELECT COALESCE(
      (SELECT value #>> '{}' FROM public.company_settings
       WHERE company_id = v_count.company_id AND branch_id IS NULL
         AND category = 'accounting' AND key = 'default_cogs_account'
       LIMIT 1),
      '5000'
    ) INTO v_cogs_code;

    SELECT id INTO v_inventory_account
    FROM public.chart_of_accounts
    WHERE company_id = v_count.company_id
      AND code = v_inventory_code
      AND is_active = true
      AND is_postable = true
      AND account_type = 'asset';
    IF v_inventory_account IS NULL THEN
      RAISE EXCEPTION 'حساب المخزون (%) غير موجود أو غير صالح في شجرة الحسابات', v_inventory_code;
    END IF;

    SELECT id INTO v_cogs_account
    FROM public.chart_of_accounts
    WHERE company_id = v_count.company_id
      AND code = v_cogs_code
      AND is_active = true
      AND is_postable = true
      AND account_type = 'expense';
    IF v_cogs_account IS NULL THEN
      RAISE EXCEPTION 'حساب تكلفة البضاعة (%) غير موجود أو غير صالح في شجرة الحسابات', v_cogs_code;
    END IF;

    v_journal_number := 'STK-' || v_count.count_number;
    INSERT INTO public.journal_entries(
      company_id, branch_id, entry_number, entry_date, posting_date, description,
      reference_type, reference_id, status, is_auto, created_by, posted_by, posted_at
    ) VALUES (
      v_count.company_id, v_branch_id, v_journal_number, current_date, current_date,
      'تسوية فروق الجرد ' || v_count.count_number,
      'stock_count', p_count_id, 'posted', true, auth.uid(), auth.uid(), now()
    )
    RETURNING id INTO v_journal_id;

    IF v_gain_value > 0 THEN
      INSERT INTO public.journal_entry_lines(entry_id, account_id, debit, credit, description)
      VALUES
        (v_journal_id, v_inventory_account, v_gain_value, 0, 'زيادة مخزون من الجرد'),
        (v_journal_id, v_cogs_account, 0, v_gain_value, 'تخفيض تكلفة البضاعة - زيادة جرد');
    END IF;
    IF v_loss_value > 0 THEN
      INSERT INTO public.journal_entry_lines(entry_id, account_id, debit, credit, description)
      VALUES
        (v_journal_id, v_cogs_account, v_loss_value, 0, 'عجز مخزون من الجرد'),
        (v_journal_id, v_inventory_account, 0, v_loss_value, 'تخفيض المخزون - عجز جرد');
    END IF;
  END IF;

  UPDATE public.warehouse_counts
  SET status = 'completed',
      completed_at = now(),
      counted_items = (
        SELECT COUNT(*)::integer FROM public.warehouse_count_items
        WHERE count_id = p_count_id AND counted_qty IS NOT NULL
      ),
      variance_items = v_variance_items,
      variance_value = v_variance_value,
      updated_at = now()
  WHERE id = p_count_id;

  RETURN jsonb_build_object(
    'ok', true,
    'variance_items', v_variance_items,
    'variance_value', v_variance_value,
    'gain_value', v_gain_value,
    'loss_value', v_loss_value,
    'journal_entry_id', v_journal_id
  );
END
$$;

DROP FUNCTION IF EXISTS public.get_inventory_ledger_reconciliation(uuid);
CREATE FUNCTION public.get_inventory_ledger_reconciliation(p_company_id uuid)
RETURNS TABLE(
  inventory_value numeric,
  ledger_balance numeric,
  difference numeric,
  inventory_account_code text,
  cogs_account_code text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_inventory_code text;
  v_cogs_code text;
  v_account_id uuid;
BEGIN
  IF NOT public.auth_is_platform_admin()
     AND p_company_id IS DISTINCT FROM public.auth_company_id() THEN
    RAISE EXCEPTION 'Permission denied for this company';
  END IF;
  IF NOT (
    public.auth_has_permission('inventory.view')
    OR public.auth_has_permission('accounting.view')
    OR public.auth_has_permission('reports.financial')
    OR public.auth_has_permission('admin.full')
  ) THEN
    RAISE EXCEPTION 'Permission denied: inventory reconciliation';
  END IF;

  SELECT COALESCE(
    (SELECT value #>> '{}' FROM public.company_settings
     WHERE company_id = p_company_id AND branch_id IS NULL
       AND category = 'accounting' AND key = 'default_inventory_account'
     LIMIT 1),
    '1300'
  ) INTO v_inventory_code;

  SELECT COALESCE(
    (SELECT value #>> '{}' FROM public.company_settings
     WHERE company_id = p_company_id AND branch_id IS NULL
       AND category = 'accounting' AND key = 'default_cogs_account'
     LIMIT 1),
    '5000'
  ) INTO v_cogs_code;

  SELECT coa.id INTO v_account_id
  FROM public.chart_of_accounts coa
  WHERE coa.company_id = p_company_id
    AND coa.code = v_inventory_code
    AND coa.account_type = 'asset'
    AND coa.is_active = true;
  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'حساب المخزون (%) غير موجود أو غير صالح', v_inventory_code;
  END IF;

  RETURN QUERY
  WITH stock AS (
    SELECT COALESCE(SUM(sl.quantity_left * sl.effective_unit_cost), 0)::numeric AS value
    FROM public.stock_lots sl
    WHERE sl.company_id = p_company_id
      AND sl.is_quarantined = false
  ), ledger AS (
    SELECT COALESCE(SUM(jel.debit - jel.credit), 0)::numeric AS balance
    FROM public.journal_entry_lines jel
    JOIN public.journal_entries je ON je.id = jel.entry_id
    WHERE je.company_id = p_company_id
      AND je.status = 'posted'
      AND jel.account_id = v_account_id
  )
  SELECT stock.value, ledger.balance, stock.value - ledger.balance,
         v_inventory_code, v_cogs_code
  FROM stock CROSS JOIN ledger;
END
$$;

REVOKE ALL ON FUNCTION public.create_warehouse_count(uuid, uuid, text, text, uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.start_warehouse_count(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_count_item(uuid, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cancel_warehouse_count(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_warehouse_count(uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_inventory_ledger_reconciliation(uuid) FROM PUBLIC;

GRANT SELECT ON public.v_warehouse_counts_summary_v2 TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_warehouse_count(uuid, uuid, text, text, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_warehouse_count(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_count_item(uuid, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_warehouse_count(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_warehouse_count(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_inventory_ledger_reconciliation(uuid) TO authenticated;
COMMIT;
