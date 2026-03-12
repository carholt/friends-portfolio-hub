-- Mining intelligence system.

CREATE OR REPLACE FUNCTION public.classify_mining_company(_asset_id UUID)
RETURNS public.mining_stage
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _production NUMERIC;
  _resource NUMERIC;
  _stage public.mining_stage;
BEGIN
  SELECT annual_production_oz, resource_size_oz
  INTO _production, _resource
  FROM public.mining_company_profiles
  WHERE asset_id = _asset_id;

  IF _production IS NOT NULL AND _production > 500000 THEN
    _stage := 'major';
  ELSIF _production IS NOT NULL AND _production >= 100000 THEN
    _stage := 'mid_tier';
  ELSIF _production IS NOT NULL AND _production > 0 THEN
    _stage := 'producer';
  ELSIF _resource IS NOT NULL AND _resource > 0 THEN
    _stage := 'developer';
  ELSE
    _stage := 'explorer';
  END IF;

  UPDATE public.mining_company_profiles
  SET stage = _stage
  WHERE asset_id = _asset_id;

  RETURN _stage;
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_mining_valuation_metrics(_asset_id UUID DEFAULT NULL)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.mining_valuation_metrics (asset_id, ev_per_ounce, valuation_rating, created_at, updated_at)
  SELECT
    mcp.asset_id,
    CASE
      WHEN mcp.enterprise_value IS NOT NULL AND mcp.resource_size_oz IS NOT NULL AND mcp.resource_size_oz <> 0
      THEN mcp.enterprise_value / mcp.resource_size_oz
      ELSE NULL
    END,
    CASE
      WHEN mcp.enterprise_value IS NULL OR mcp.resource_size_oz IS NULL OR mcp.resource_size_oz = 0 THEN NULL
      WHEN (mcp.enterprise_value / mcp.resource_size_oz) < 50 THEN 'Deep Value'
      WHEN (mcp.enterprise_value / mcp.resource_size_oz) < 150 THEN 'Value'
      WHEN (mcp.enterprise_value / mcp.resource_size_oz) <= 400 THEN 'Fair'
      ELSE 'Expensive'
    END,
    now(),
    now()
  FROM public.mining_company_profiles mcp
  WHERE _asset_id IS NULL OR mcp.asset_id = _asset_id
  ON CONFLICT (asset_id)
  DO UPDATE SET
    ev_per_ounce = EXCLUDED.ev_per_ounce,
    valuation_rating = EXCLUDED.valuation_rating,
    updated_at = now();
$$;

CREATE OR REPLACE FUNCTION public.refresh_portfolio_mining_snapshot(_portfolio_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _asset_id UUID;
BEGIN
  FOR _asset_id IN
    SELECT DISTINCT h.asset_id
    FROM public.holdings h
    WHERE h.portfolio_id = _portfolio_id
      AND h.quantity <> 0
  LOOP
    PERFORM public.classify_mining_company(_asset_id);
  END LOOP;

  PERFORM public.refresh_mining_valuation_metrics(NULL);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.classify_mining_company(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.refresh_mining_valuation_metrics(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.refresh_portfolio_mining_snapshot(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.classify_mining_company(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.refresh_mining_valuation_metrics(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.refresh_portfolio_mining_snapshot(UUID) TO authenticated, service_role;
