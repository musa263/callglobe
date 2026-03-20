// supabase/functions/webhook-stripe/index.ts
// Handles Stripe webhook events — adds balance on successful payment

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@13.10.0?target=deno";

function getRequiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

serve(async (req) => {
  const body = await req.text();
  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return new Response("Missing stripe signature", { status: 400 });
  }

  let event: Stripe.Event;

  try {
    const stripe = new Stripe(getRequiredEnv("STRIPE_SECRET_KEY"), { apiVersion: "2023-10-16" });
    event = await stripe.webhooks.constructEventAsync(
      body,
      signature,
      getRequiredEnv("STRIPE_WEBHOOK_SECRET")
    );
  } catch (err) {
    console.error("Webhook signature verification failed:", err.message);
    return new Response(`Webhook Error: ${err.message}`, { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;

    if (session.payment_status !== "paid") {
      return new Response(JSON.stringify({ received: true, ignored: "payment_not_paid" }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    const { user_id, package_id, credit_amount } = session.metadata || {};

    if (!user_id || !credit_amount) {
      console.error("Missing metadata in checkout session");
      return new Response("Missing metadata", { status: 400 });
    }

    const supabase = createClient(
      getRequiredEnv("SUPABASE_URL"),
      getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY")
    );

    const { data, error } = await supabase.rpc("process_stripe_checkout", {
      p_stripe_session_id: session.id,
      p_user_id: user_id,
      p_credit_amount: parseFloat(credit_amount),
      p_payment_amount: Number(session.amount_total ?? 0) / 100,
      p_package_id: package_id,
      p_payment_intent: typeof session.payment_intent === "string"
        ? session.payment_intent
        : session.payment_intent?.id ?? null,
      p_event_id: event.id,
    });

    if (error) {
      console.error("Failed to process checkout:", error);
      return new Response("Balance update failed", { status: 500 });
    }

    console.log("Stripe checkout processed", {
      sessionId: session.id,
      userId: user_id,
      duplicate: data?.duplicate ?? false,
      balance: data?.balance ?? null,
    });
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { "Content-Type": "application/json" },
  });
});
