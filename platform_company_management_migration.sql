-- Run once in Supabase SQL Editor after the base schema.
-- Backups exclude authentication credentials, AI keys, webhook secrets, and Storage objects.
BEGIN;

CREATE SCHEMA IF NOT EXISTS platform_internal;
REVOKE ALL ON SCHEMA platform_internal FROM PUBLIC, anon, authenticated;

-- audit_log stays append-only: it is never exported, deleted, or restored.
-- Its company FK is dropped so permanent company deletion cannot cascade into it.
DO $$
DECLARE
  v_constraint text;
BEGIN
  FOR v_constraint IN
    SELECT con.conname
    FROM pg_constraint con
    WHERE con.conrelid = 'public.audit_log'::regclass
      AND con.contype = 'f'
      AND con.confrelid = 'public.companies'::regclass
  LOOP
    EXECUTE format('ALTER TABLE public.audit_log DROP CONSTRAINT %I', v_constraint);
  END LOOP;
END
$$;

-- During a platform-admin purge, audit_log may only have branch/user references nulled (FK SET NULL).
CREATE OR REPLACE FUNCTION public.audit_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF tg_op = 'UPDATE'
     AND COALESCE(current_setting('app.platform_company_purge', true), '') = 'on'
     AND auth_is_platform_admin()
     AND (to_jsonb(new) - 'branch_id' - 'user_id') = (to_jsonb(old) - 'branch_id' - 'user_id')
     AND (new.branch_id IS NULL OR new.branch_id IS NOT DISTINCT FROM old.branch_id)
     AND (new.user_id IS NULL OR new.user_id IS NOT DISTINCT FROM old.user_id) THEN
    RETURN new;
  END IF;
  RAISE EXCEPTION 'audit_log is append-only';
END
$$;

-- Owner deletion is allowed only inside a platform-admin purge.
CREATE OR REPLACE FUNCTION public.users_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF tg_op = 'DELETE' THEN
    IF old.is_owner AND NOT (
      COALESCE(current_setting('app.platform_company_purge', true), '') = 'on'
      AND auth_is_platform_admin()
    ) THEN
      RAISE EXCEPTION 'Owner cannot be deleted';
    END IF;
    RETURN old;
  END IF;
  IF tg_op = 'UPDATE' AND old.is_owner AND NOT new.is_owner THEN
    RAISE EXCEPTION 'Owner cannot be demoted';
  END IF;
  IF new.is_owner THEN
    IF EXISTS(SELECT 1 FROM users WHERE company_id = new.company_id AND is_owner = true AND id <> new.id) THEN
      RAISE EXCEPTION 'Only one owner per company';
    END IF;
  END IF;
  RETURN new;
END
$$;

CREATE OR REPLACE FUNCTION platform_internal.redact_company_backup_secrets(p_value jsonb)
RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, platform_internal AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF jsonb_typeof(p_value) = 'object' THEN
    SELECT COALESCE(
      jsonb_object_agg(entry.key, platform_internal.redact_company_backup_secrets(entry.value)),
      '{}'::jsonb
    )
    INTO v_result
    FROM jsonb_each(p_value) entry
    WHERE lower(entry.key) NOT IN (
      'secret', 'api_key', 'api_key_encrypted', 'accesstoken', 'access_token',
      'refreshtoken', 'refresh_token', 'sessiontoken', 'session_token',
      'password', 'password_hash', 'authorization', 'token', 'client_secret',
      'webhook_secret', 'private_key', 'service_role_key'
    );
    RETURN v_result;
  ELSIF jsonb_typeof(p_value) = 'array' THEN
    SELECT COALESCE(
      jsonb_agg(platform_internal.redact_company_backup_secrets(entry.value)),
      '[]'::jsonb
    )
    INTO v_result
    FROM jsonb_array_elements(p_value) entry;
    RETURN v_result;
  END IF;
  RETURN p_value;
END
$$;

CREATE OR REPLACE FUNCTION public.platform_company_backup(p_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_company jsonb;
  v_relation record;
  v_fk record;
  v_rows jsonb;
  v_tables jsonb := '{}'::jsonb;
  v_added integer;
  v_fk_added integer;
  v_cross_company_reference boolean;
BEGIN
  IF NOT auth_is_platform_admin() THEN
    RAISE EXCEPTION 'Platform admin access required';
  END IF;

  SELECT platform_internal.redact_company_backup_secrets(to_jsonb(c)) INTO v_company
  FROM public.companies c
  WHERE c.id = p_company_id;

  IF v_company IS NULL THEN
    RAISE EXCEPTION 'Company not found';
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS refad_company_backup_rows (
    table_oid oid NOT NULL,
    row_hash text NOT NULL,
    row_data jsonb NOT NULL,
    PRIMARY KEY (table_oid, row_hash)
  ) ON COMMIT DROP;
  TRUNCATE pg_temp.refad_company_backup_rows;

  FOR v_relation IN
    SELECT c.oid, c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND c.relname <> 'audit_log'
      AND EXISTS (
        SELECT 1 FROM pg_attribute a
        WHERE a.attrelid = c.oid AND a.attname = 'company_id'
          AND a.attnum > 0 AND NOT a.attisdropped
      )
  LOOP
    EXECUTE format(
      'INSERT INTO pg_temp.refad_company_backup_rows(table_oid, row_hash, row_data)
       SELECT $1, md5(to_jsonb(t)::text), to_jsonb(t) FROM %s t WHERE t.company_id = $2
       ON CONFLICT DO NOTHING',
      v_relation.oid::regclass
    ) USING v_relation.oid, p_company_id;
  END LOOP;

  LOOP
    v_added := 0;
    FOR v_fk IN
      WITH RECURSIVE tenant_tables(table_oid) AS (
        SELECT c.oid
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
          AND c.relname <> 'audit_log'
          AND EXISTS (
            SELECT 1 FROM pg_attribute a
            WHERE a.attrelid = c.oid AND a.attname = 'company_id'
              AND a.attnum > 0 AND NOT a.attisdropped
          )
        UNION
        SELECT fk.conrelid
        FROM pg_constraint fk
        JOIN tenant_tables parent ON parent.table_oid = fk.confrelid
        JOIN pg_class child ON child.oid = fk.conrelid
        JOIN pg_namespace child_ns ON child_ns.oid = child.relnamespace
        WHERE fk.contype = 'f' AND child_ns.nspname = 'public'
          AND child.relkind IN ('r', 'p')
          AND child.relname <> 'audit_log'
      ), scoped_foreign_keys AS (
        SELECT fk.conrelid AS child_oid,
          fk.confrelid AS parent_oid,
          string_agg(
            format('sc.row_data ->> %L = child.%I::text', parent_col.attname, child_col.attname),
            ' AND ' ORDER BY key_pair.ordinality
          ) AS join_condition,
          string_agg(format('child.%I IS NULL', child_col.attname), ' AND ' ORDER BY key_pair.ordinality)
            AS all_null_condition
        FROM pg_constraint fk
        JOIN tenant_tables parent ON parent.table_oid = fk.confrelid
        JOIN pg_class child_rel ON child_rel.oid = fk.conrelid
        JOIN pg_namespace child_ns ON child_ns.oid = child_rel.relnamespace
        CROSS JOIN LATERAL unnest(fk.conkey, fk.confkey)
          WITH ORDINALITY AS key_pair(child_attnum, parent_attnum, ordinality)
        JOIN pg_attribute child_col
          ON child_col.attrelid = fk.conrelid AND child_col.attnum = key_pair.child_attnum
        JOIN pg_attribute parent_col
          ON parent_col.attrelid = fk.confrelid AND parent_col.attnum = key_pair.parent_attnum
        WHERE fk.contype = 'f'
          AND child_ns.nspname = 'public'
          AND child_rel.relkind IN ('r', 'p')
          AND child_rel.relname <> 'audit_log'
        GROUP BY fk.conrelid, fk.confrelid
      )
      SELECT child_oid,
        string_agg(
          format(
            '(%s OR EXISTS (SELECT 1 FROM pg_temp.refad_company_backup_rows sc WHERE sc.table_oid = %L::oid AND %s))',
            all_null_condition, parent_oid, join_condition
          ),
          ' AND '
        ) AS scope_condition,
        string_agg(
          format(
            'EXISTS (SELECT 1 FROM pg_temp.refad_company_backup_rows sc WHERE sc.table_oid = %L::oid AND %s)',
            parent_oid, join_condition
          ),
          ' OR '
        ) AS match_condition
      FROM scoped_foreign_keys
      GROUP BY child_oid
    LOOP
      IF EXISTS (
        SELECT 1 FROM pg_attribute a
        WHERE a.attrelid = v_fk.child_oid AND a.attname = 'company_id'
          AND a.attnum > 0 AND NOT a.attisdropped
      ) THEN
        EXECUTE format(
          'SELECT EXISTS (
             SELECT 1 FROM %s child
             WHERE child.company_id IS DISTINCT FROM $1 AND (%s)
           )',
          v_fk.child_oid::regclass, v_fk.match_condition
        ) INTO v_cross_company_reference USING p_company_id;
        IF v_cross_company_reference THEN
          RAISE EXCEPTION 'Cross-company references prevent a safe backup or data operation';
        END IF;
      END IF;

      EXECUTE format(
        'INSERT INTO pg_temp.refad_company_backup_rows(table_oid, row_hash, row_data)
         SELECT %L::oid, md5(to_jsonb(child)::text), to_jsonb(child)
         FROM %s child
         WHERE (%s) AND (%s)
         ON CONFLICT DO NOTHING',
        v_fk.child_oid, v_fk.child_oid::regclass, v_fk.scope_condition, v_fk.match_condition
      );
      GET DIAGNOSTICS v_fk_added = ROW_COUNT;
      v_added := v_added + v_fk_added;
    END LOOP;
    EXIT WHEN v_added = 0;
  END LOOP;

  FOR v_relation IN
    SELECT DISTINCT scoped.table_oid, c.relname
    FROM pg_temp.refad_company_backup_rows scoped
    JOIN pg_class c ON c.oid = scoped.table_oid
    ORDER BY c.relname
  LOOP
    EXECUTE
      'SELECT COALESCE(jsonb_agg(platform_internal.redact_company_backup_secrets(row_data)), ''[]''::jsonb)
       FROM pg_temp.refad_company_backup_rows WHERE table_oid = $1'
      INTO v_rows USING v_relation.table_oid;
    v_tables := v_tables || jsonb_build_object(v_relation.relname, v_rows);
  END LOOP;

  RETURN jsonb_build_object(
    'format', 'refad-company-backup-v1',
    'exported_at', now(),
    'company_id', p_company_id,
    'company', v_company,
    'tables', v_tables,
    'excluded', jsonb_build_array(
      'بيانات تسجيل الدخول وكلمات المرور',
      'مفاتيح AI المشفرة وجلسات المستخدمين',
      'الأسرار في webhooks',
      'الملفات المرفوعة إلى Supabase Storage'
    )
  );
END
$$;

CREATE OR REPLACE FUNCTION public.clear_platform_company_data(p_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_row record;
  v_predicate text;
  v_columns text;
  v_progress integer;
  v_total integer := 0;
BEGIN
  IF NOT auth_is_platform_admin() THEN
    RAISE EXCEPTION 'Platform admin access required';
  END IF;

  PERFORM public.platform_company_backup(p_company_id);

  PERFORM set_config('app.platform_company_purge', 'on', true);

  CREATE TEMP TABLE IF NOT EXISTS refad_company_delete_rows (
    table_oid oid NOT NULL,
    row_hash text NOT NULL,
    row_data jsonb NOT NULL,
    PRIMARY KEY (table_oid, row_hash)
  ) ON COMMIT DROP;
  TRUNCATE pg_temp.refad_company_delete_rows;

  INSERT INTO pg_temp.refad_company_delete_rows(table_oid, row_hash, row_data)
  SELECT table_oid, row_hash, row_data
  FROM pg_temp.refad_company_backup_rows;
  GET DIAGNOSTICS v_total = ROW_COUNT;

  LOOP
    v_progress := 0;
    FOR v_row IN SELECT table_oid, row_data FROM pg_temp.refad_company_delete_rows
    LOOP
      SELECT string_agg(
        format(
          'target.%I IS NOT DISTINCT FROM (jsonb_populate_record(NULL::%s, $1)).%I',
          a.attname, v_row.table_oid::regclass, a.attname
        ),
        ' AND ' ORDER BY k.ordinality
      )
      INTO v_predicate
      FROM pg_index i
      CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum, ordinality)
      JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
      WHERE i.indrelid = v_row.table_oid AND i.indisprimary;

      IF v_predicate IS NULL THEN
        SELECT string_agg(
          format(
            'target.%I IS NOT DISTINCT FROM (jsonb_populate_record(NULL::%s, $1)).%I',
            a.attname, v_row.table_oid::regclass, a.attname
          ),
          ' AND ' ORDER BY a.attnum
        )
        INTO v_columns
        FROM pg_attribute a
        WHERE a.attrelid = v_row.table_oid
          AND a.attnum > 0 AND NOT a.attisdropped AND a.attgenerated = '';
        v_predicate := v_columns;
      END IF;

      BEGIN
        EXECUTE format('DELETE FROM %s target WHERE %s', v_row.table_oid::regclass, v_predicate)
          USING v_row.row_data;
        DELETE FROM pg_temp.refad_company_delete_rows
        WHERE table_oid = v_row.table_oid AND row_hash = md5(v_row.row_data::text);
        v_progress := v_progress + 1;
      EXCEPTION WHEN foreign_key_violation THEN
        NULL;
      END;
    END LOOP;

    EXIT WHEN NOT EXISTS (SELECT 1 FROM pg_temp.refad_company_delete_rows);
    IF v_progress = 0 THEN
      RAISE EXCEPTION 'Could not safely remove all company data due to unresolved references';
    END IF;
  END LOOP;

  UPDATE public.companies SET owner_id = NULL WHERE id = p_company_id;

  PERFORM set_config('app.platform_company_purge', 'off', true);

  RETURN jsonb_build_object('deleted_rows', v_total, 'company_id', p_company_id);
END
$$;

CREATE OR REPLACE FUNCTION public.restore_platform_company_backup(
  p_company_id uuid,
  p_backup jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_table record;
  v_row record;
  v_table_oid oid;
  v_column_list text;
  v_value_list text;
  v_identity text;
  v_inserted integer;
  v_progress integer;
  v_restored integer := 0;
  v_company public.companies%ROWTYPE;
BEGIN
  IF NOT auth_is_platform_admin() THEN
    RAISE EXCEPTION 'Platform admin access required';
  END IF;
  IF p_backup->>'format' IS DISTINCT FROM 'refad-company-backup-v1'
     OR p_backup->>'company_id' IS DISTINCT FROM p_company_id::text
     OR jsonb_typeof(p_backup->'tables') IS DISTINCT FROM 'object'
     OR jsonb_typeof(p_backup->'company') IS DISTINCT FROM 'object'
     OR p_backup->'company'->>'id' IS DISTINCT FROM p_company_id::text THEN
    RAISE EXCEPTION 'Invalid backup file or company mismatch';
  END IF;

  SELECT * INTO v_company FROM public.companies WHERE id = p_company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Restore requires the original company record to exist';
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS refad_company_restore_rows (
    table_oid oid NOT NULL,
    row_hash text NOT NULL,
    row_data jsonb NOT NULL,
    PRIMARY KEY (table_oid, row_hash)
  ) ON COMMIT DROP;
  TRUNCATE pg_temp.refad_company_restore_rows;

  FOR v_table IN SELECT key, value FROM jsonb_each(p_backup->'tables')
  LOOP
    v_table_oid := to_regclass(format('public.%I', v_table.key));
    IF v_table_oid IS NULL OR NOT EXISTS (
      WITH RECURSIVE allowed_tables(table_oid) AS (
        SELECT c.oid
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
          AND c.relname <> 'audit_log'
          AND EXISTS (
            SELECT 1 FROM pg_attribute a
            WHERE a.attrelid = c.oid AND a.attname = 'company_id'
              AND a.attnum > 0 AND NOT a.attisdropped
          )
        UNION
        SELECT fk.conrelid
        FROM pg_constraint fk
        JOIN allowed_tables parent ON parent.table_oid = fk.confrelid
        JOIN pg_class child ON child.oid = fk.conrelid
        JOIN pg_namespace child_ns ON child_ns.oid = child.relnamespace
        WHERE fk.contype = 'f' AND child_ns.nspname = 'public'
          AND child.relkind IN ('r', 'p')
          AND child.relname <> 'audit_log'
      )
      SELECT 1 FROM allowed_tables WHERE table_oid = v_table_oid
    ) THEN
      RAISE EXCEPTION 'Backup contains an unsupported table: %', v_table.key;
    END IF;

    IF jsonb_typeof(v_table.value) IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'Invalid backup rows for table: %', v_table.key;
    END IF;

    IF EXISTS (
      SELECT 1 FROM pg_attribute a
      WHERE a.attrelid = v_table_oid AND a.attname = 'company_id'
        AND a.attnum > 0 AND NOT a.attisdropped
    ) AND EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_table.value) AS backup_row(value)
      WHERE backup_row.value->>'company_id' IS DISTINCT FROM p_company_id::text
    ) THEN
      RAISE EXCEPTION 'Backup contains rows for a different company';
    END IF;

    INSERT INTO pg_temp.refad_company_restore_rows(table_oid, row_hash, row_data)
    SELECT v_table_oid,
      md5(value::text),
      platform_internal.redact_company_backup_secrets(value)
    FROM jsonb_array_elements(v_table.value)
    WHERE v_table.key NOT IN ('ai_credentials', 'user_sessions');
  END LOOP;

  PERFORM public.clear_platform_company_data(p_company_id);

  LOOP
    v_progress := 0;
    FOR v_row IN SELECT table_oid, row_hash, row_data FROM pg_temp.refad_company_restore_rows
    LOOP
      SELECT string_agg(format('%I', a.attname), ', ' ORDER BY a.attnum),
        string_agg(format('record_data.%I', a.attname), ', ' ORDER BY a.attnum),
        COALESCE(CASE WHEN bool_or(a.attidentity = 'a') THEN 'OVERRIDING SYSTEM VALUE' ELSE '' END, '')
      INTO v_column_list, v_value_list, v_identity
      FROM pg_attribute a
      WHERE a.attrelid = v_row.table_oid
        AND a.attnum > 0 AND NOT a.attisdropped AND a.attgenerated = ''
        AND a.attname NOT IN (
          'secret', 'api_key_encrypted', 'session_token', 'access_token',
          'refresh_token', 'password', 'password_hash'
        )
        AND v_row.row_data ? a.attname;

      IF v_column_list IS NULL THEN
        RAISE EXCEPTION 'Backup row has no restorable columns for %', v_row.table_oid::regclass;
      END IF;

      BEGIN
        EXECUTE format(
          'INSERT INTO %s (%s) %s
           SELECT %s FROM jsonb_populate_record(NULL::%s, $1) AS record_data',
          v_row.table_oid::regclass, v_column_list, v_identity,
          v_value_list, v_row.table_oid::regclass
        ) USING v_row.row_data;
        GET DIAGNOSTICS v_inserted = ROW_COUNT;
        IF v_inserted > 0 THEN
          v_progress := v_progress + 1;
          v_restored := v_restored + v_inserted;
        END IF;
        DELETE FROM pg_temp.refad_company_restore_rows
        WHERE table_oid = v_row.table_oid AND row_hash = v_row.row_hash;
      EXCEPTION WHEN foreign_key_violation THEN
        NULL;
      END;
    END LOOP;

    EXIT WHEN NOT EXISTS (SELECT 1 FROM pg_temp.refad_company_restore_rows);
    IF v_progress = 0 THEN
      RAISE EXCEPTION 'Backup could not be restored: unresolved references remain';
    END IF;
  END LOOP;

  UPDATE public.companies c SET
    name = source.name,
    slug = source.slug,
    legal_name = source.legal_name,
    tax_id = source.tax_id,
    phone = source.phone,
    email = source.email,
    address = source.address,
    logo_url = source.logo_url,
    currency = source.currency,
    locale = source.locale,
    timezone = source.timezone,
    direction = source.direction,
    owner_id = source.owner_id,
    active_theme_slug = source.active_theme_slug,
    active_custom_theme_id = source.active_custom_theme_id,
    theme_overrides = source.theme_overrides,
    is_active = source.is_active,
    deleted_at = source.deleted_at,
    created_at = source.created_at,
    updated_at = source.updated_at
  FROM jsonb_populate_record(
    NULL::public.companies,
    platform_internal.redact_company_backup_secrets(p_backup->'company')
  ) AS source
  WHERE c.id = p_company_id;

  RETURN jsonb_build_object(
    'restored_rows', v_restored,
    'company_id', p_company_id,
    'excluded', p_backup->'excluded'
  );
END
$$;

DROP FUNCTION IF EXISTS public.delete_platform_company(uuid);

CREATE FUNCTION public.delete_platform_company(p_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_result jsonb;
  v_user_ids uuid[];
BEGIN
  IF NOT auth_is_platform_admin() THEN
    RAISE EXCEPTION 'Platform admin access required';
  END IF;

  SELECT array_agg(u.id) INTO v_user_ids
  FROM public.users u
  WHERE u.company_id = p_company_id;

  v_result := public.clear_platform_company_data(p_company_id);

  PERFORM set_config('app.platform_company_purge', 'on', true);
  DELETE FROM auth.users au
  WHERE au.id = ANY(COALESCE(v_user_ids, ARRAY[]::uuid[]))
    AND NOT EXISTS (SELECT 1 FROM public.platform_admins pa WHERE pa.id = au.id)
    AND NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = au.id)
    AND NOT EXISTS (SELECT 1 FROM public.customers c WHERE c.auth_user_id = au.id);

  DELETE FROM public.companies WHERE id = p_company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Company not found';
  END IF;
  PERFORM set_config('app.platform_company_purge', 'off', true);

  RETURN v_result || jsonb_build_object('company_deleted', true);
END
$$;

REVOKE ALL ON FUNCTION public.platform_company_backup(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION platform_internal.redact_company_backup_secrets(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.clear_platform_company_data(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.restore_platform_company_backup(uuid, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delete_platform_company(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_company_backup(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.clear_platform_company_data(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.restore_platform_company_backup(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_platform_company(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
