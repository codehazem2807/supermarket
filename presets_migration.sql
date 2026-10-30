BEGIN;

CREATE TABLE IF NOT EXISTS public.presets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE NOT NULL,
  name text NOT NULL,
  name_en text,
  description text,
  icon text,
  color text,
  settings jsonb DEFAULT '{}'::jsonb,
  is_builtin boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.company_presets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  preset_slug text NOT NULL,
  applied_at timestamptz DEFAULT now(),
  applied_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

INSERT INTO public.presets (slug, name, name_en, description, icon, color, settings, is_builtin) VALUES
  ('small_supermarket', 'سوبرماركت صغير', 'Small Supermarket',
   'محل واحد، كاشير واحد، مخزن واحد', 'store', '#14B8A6',
   '{"branches":1,"registers":1,"warehouses":1,"users":3,"features":["pos","inventory","reports"]}'::jsonb, true),
  ('chain', 'سلسلة فروع', 'Chain',
   '2-10 فروع، تعدد كاشير، تحويلات بين الفروع', 'building-2', '#3b82f6',
   '{"branches":"2-10","registers":"multi","warehouses":"multi","users":"unlimited","features":["pos","inventory","reports","transfers","accounting"]}'::jsonb, true),
  ('hypermarket', 'هايبر ماركت', 'Hypermarket',
   'ميزان، PLU، باركود، تنبؤات، تعدد مخازن', 'warehouse', '#8b5cf6',
   '{"branches":"unlimited","registers":"multi","warehouses":"multi","users":"unlimited","features":["pos","inventory","reports","transfers","accounting","forecasting","scale","plu","barcode"]}'::jsonb, true)
ON CONFLICT (slug) DO NOTHING;

ALTER TABLE public.presets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_presets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS presets_read ON public.presets;
CREATE POLICY presets_read ON public.presets FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS company_presets_all ON public.company_presets;
CREATE POLICY company_presets_all ON public.company_presets FOR ALL
  USING (company_id = auth_company_id() OR auth_is_platform_admin())
  WITH CHECK (company_id = auth_company_id() OR auth_is_platform_admin());

GRANT SELECT ON public.presets TO authenticated;

DROP FUNCTION IF EXISTS public.apply_preset_to_company(uuid, text);

CREATE OR REPLACE FUNCTION public.apply_preset_to_company(
  p_company_id uuid,
  p_preset_slug text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_preset public.presets%ROWTYPE;
  v_feature text;
  v_applied_at timestamptz := now();
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT auth_is_platform_admin() AND p_company_id IS DISTINCT FROM auth_company_id() THEN
    RAISE EXCEPTION 'Company access denied';
  END IF;

  IF NOT auth_has_permission('company.preset_apply') THEN
    RAISE EXCEPTION 'Permission denied: company.preset_apply';
  END IF;

  SELECT * INTO v_preset
  FROM public.presets
  WHERE slug = p_preset_slug;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown preset: %', p_preset_slug;
  END IF;

  UPDATE public.feature_flags
  SET is_enabled = false,
      config = COALESCE(config, '{}'::jsonb)
        || jsonb_build_object('preset_managed', true, 'preset_slug', v_preset.slug)
  WHERE company_id = p_company_id
    AND config->>'preset_managed' = 'true';

  FOR v_feature IN
    SELECT DISTINCT jsonb_array_elements_text(
      CASE
        WHEN jsonb_typeof(v_preset.settings->'features') = 'array'
          THEN v_preset.settings->'features'
        ELSE '[]'::jsonb
      END
    )
  LOOP
    INSERT INTO public.feature_flags(company_id, flag_key, is_enabled, config)
    VALUES (
      p_company_id,
      v_feature,
      true,
      jsonb_build_object('preset_managed', true, 'preset_slug', v_preset.slug)
    )
    ON CONFLICT (company_id, flag_key)
    DO UPDATE SET
      is_enabled = true,
      config = COALESCE(feature_flags.config, '{}'::jsonb) || EXCLUDED.config;
  END LOOP;

  INSERT INTO public.company_presets(company_id, preset_slug, applied_at, applied_by)
  VALUES (p_company_id, v_preset.slug, v_applied_at, auth.uid());

  INSERT INTO public.feature_flags(company_id, flag_key, is_enabled, config)
  VALUES (
    p_company_id,
    'preset.applied',
    true,
    jsonb_build_object(
      'slug', v_preset.slug,
      'applied_at', v_applied_at,
      'applied_by', auth.uid(),
      'settings', COALESCE(v_preset.settings, '{}'::jsonb)
    )
  )
  ON CONFLICT (company_id, flag_key)
  DO UPDATE SET
    is_enabled = EXCLUDED.is_enabled,
    config = EXCLUDED.config;
END
$$;

REVOKE ALL ON FUNCTION public.apply_preset_to_company(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_preset_to_company(uuid, text) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
