// supabase/functions/webhook-stripe/index.ts
// Handles Stripe webhook events — adds balance on successful payment

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@13.10.0?target=deno";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, { apiVersion: "2023-10-16" });

serve(async (req) => {
  const body = await req.text();
  const sig = req.headers.get("stripe-signature")!;

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(
      body,
      sig,
      Deno.env.get("STRIPE_WEBHOOK_SECRET")!
    );
  } catch (err) {
    console.error("Webhook signature verification failed:", err.message);
    return new Response(`Webhook Error: ${err.message}`, { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const { user_id, package_id, credit_amount } = session.metadata || {};

    if (!user_id || !credit_amount) {
      console.error("Missing metadata in checkout session");
      return new Response("Missing metadata", { status: 400 });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Add balance using our atomic function
    const { data, error } = await supabase.rpc("add_balance", {
      p_user_id: user_id,
      p_amount: parseFloat(credit_amount),
      p_description: `Recharge — $${session.amount_total! / 100} payment`,
      p_metadata: {
        stripe_session_id: session.id,
        stripe_payment_intent: session.payment_intent,
        package_id: package_id,
      },
    });

    if (error) {
      console.error("Failed to add balance:", error);
      return new Response("Balance update failed", { status: 500 });
    }

    console.log(`Balance added: $${credit_amount} for user ${user_id}. New balance: $${data}`);
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { "Content-Type": "application/json" },
  });
});
