import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: req.headers.get("Authorization") || "" } },
  });
  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  try {
    const { data: authData } = await userClient.auth.getUser();
    if (!authData.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const portfolioId = body?.portfolio_id;

    if (!portfolioId) {
      return new Response(JSON.stringify({ error: "portfolio_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: canView, error: viewError } = await userClient
      .from("portfolios")
      .select("id")
      .eq("id", portfolioId)
      .maybeSingle();

    if (viewError || !canView) {
      return new Response(JSON.stringify({ error: "Portfolio not found or inaccessible" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { error: refreshError } = await adminClient.rpc("refresh_portfolio_mining_snapshot", {
      _portfolio_id: portfolioId,
    });
    if (refreshError) throw refreshError;

    const { data: generatedInsights, error: insightError } = await adminClient.rpc(
      "generate_portfolio_mining_insights",
      { _portfolio_id: portfolioId },
    );
    if (insightError) throw insightError;

    let { data: dashboard, error: dashboardError } = await adminClient.rpc(
      "get_portfolio_mining_dashboard",
      { portfolio_id: portfolioId },
    );

    if (dashboardError?.code === "PGRST202") {
      const legacyDashboard = await adminClient.rpc("get_portfolio_mining_dashboard", { _portfolio_id: portfolioId });
      dashboard = legacyDashboard.data;
      dashboardError = legacyDashboard.error;
    }

    if (dashboardError) throw dashboardError;

    return new Response(
      JSON.stringify({
        ok: true,
        portfolio_id: portfolioId,
        insight_count: Array.isArray(generatedInsights) ? generatedInsights.length : 0,
        dashboard,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
