import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@14.25.0?target=deno";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const stripeSecret = Deno.env.get("STRIPE_SECRET_KEY");
  const unlockPrice = Number(Deno.env.get("REPORT_UNLOCK_PRICE") || "0");
  const generationPrice = Number(Deno.env.get("REPORT_GENERATION_PRICE") || "0");
  const currency = (Deno.env.get("REPORT_CURRENCY") || "usd").toLowerCase();

  if (!stripeSecret) {
    return new Response(JSON.stringify({ error: "STRIPE_SECRET_KEY is not configured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (unlockPrice <= 0) {
    return new Response(JSON.stringify({ error: "REPORT_UNLOCK_PRICE must be > 0" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const stripe = new Stripe(stripeSecret, { apiVersion: "2024-04-10" });
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

    const { report_id, success_url, cancel_url } = await req.json();
    if (!report_id || !success_url || !cancel_url) {
      return new Response(JSON.stringify({ error: "report_id, success_url and cancel_url are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: report, error: reportError } = await adminClient
      .from("company_ai_reports")
      .select("id,asset_id,status")
      .eq("id", report_id)
      .maybeSingle();

    if (reportError || !report) throw new Error(reportError?.message || "Report not found");

    const { data: hasAccess, error: accessError } = await adminClient.rpc("user_has_access_to_report", {
      _user_id: authData.user.id,
      _report_id: report_id,
    });
    if (accessError) throw accessError;
    if (hasAccess) {
      return new Response(JSON.stringify({ already_unlocked: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      success_url,
      cancel_url,
      payment_method_types: ["card"],
      metadata: {
        report_id,
        user_id: authData.user.id,
      },
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency,
            unit_amount: Math.round(unlockPrice * 100),
            product_data: {
              name: "AI Company Report Unlock",
              description: `Unlock company AI report ${report_id}`,
            },
          },
        },
      ],
    });

    return new Response(JSON.stringify({ checkout_url: session.url, unlock_price: unlockPrice, generation_price: generationPrice, currency }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
