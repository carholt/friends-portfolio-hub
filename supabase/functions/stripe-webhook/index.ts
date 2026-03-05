import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@14.25.0?target=deno";

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const stripeSecret = Deno.env.get("STRIPE_SECRET_KEY");
  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  if (!stripeSecret || !webhookSecret) {
    return new Response("Stripe is not configured", { status: 500 });
  }

  const stripe = new Stripe(stripeSecret, { apiVersion: "2024-04-10" });
  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  try {
    const signature = req.headers.get("stripe-signature");
    if (!signature) return new Response("Missing stripe-signature", { status: 400 });

    const rawBody = await req.text();
    const event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);

    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      const reportId = session.metadata?.report_id;
      const userId = session.metadata?.user_id;
      if (reportId && userId) {
        const pricePaid = session.amount_total ? Number(session.amount_total) / 100 : 0;
        const currency = (session.currency || "usd").toUpperCase();

        await adminClient
          .from("company_ai_report_sales")
          .upsert({
            report_id: reportId,
            user_id: userId,
            price_paid: pricePaid,
            currency,
            payment_id: session.payment_intent?.toString() || session.id,
          }, { onConflict: "report_id,user_id" });
      }
    }

    return new Response("ok", { status: 200 });
  } catch (error) {
    return new Response(error instanceof Error ? error.message : "Webhook error", { status: 400 });
  }
});
