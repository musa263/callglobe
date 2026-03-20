// supabase/functions/create-checkout/index.ts
// Creates a Stripe Checkout session for recharging balance

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@13.10.0?target=deno";

function getRequiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function getCorsHeaders() {
  return {
    "Access-Control-Allow-Origin": new URL(getRequiredEnv("APP_BASE_URL")).origin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };
}

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...getCorsHeaders(), "Content-Type": "application/json" },
  });
}

function resolveReturnUrl(rawUrl: string | null | undefined, statusParam: "success" | "canceled") {
  const appBaseUrl = new URL(getRequiredEnv("APP_BASE_URL"));
  const fallback = new URL(`/?tab=recharge&${statusParam}=true`, appBaseUrl);

  if (!rawUrl) return fallback.toString();

  try {
    const candidate = new URL(rawUrl);
    if (candidate.origin !== appBaseUrl.origin) return fallback.toString();
    return candidate.toString();
  } catch {
    return fallback.toString();
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: getCorsHeaders() });

  try {
    const stripe = new Stripe(getRequiredEnv("STRIPE_SECRET_KEY"), { apiVersion: "2023-10-16" });
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    // Verify user is authenticated
    const supabase = createClient(
      getRequiredEnv("SUPABASE_URL"),
      getRequiredEnv("SUPABASE_ANON_KEY"),
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const { package_id, success_url, cancel_url } = await req.json();
    if (!package_id) {
      return jsonResponse({ error: "Missing package_id" }, 400);
    }

    // Get package details
    const adminSupabase = createClient(
      getRequiredEnv("SUPABASE_URL"),
      getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY")
    );

    const { data: pkg, error: pkgError } = await adminSupabase
      .from("recharge_packages")
      .select("*")
      .eq("id", package_id)
      .eq("is_active", true)
      .single();

    if (pkgError || !pkg) {
      return jsonResponse({ error: "Package not found" }, 404);
    }

    const successUrl = resolveReturnUrl(success_url, "success");
    const cancelUrl = resolveReturnUrl(cancel_url, "canceled");

    // Create Stripe Checkout session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [
        pkg.stripe_price_id ? {
          price: pkg.stripe_price_id,
          quantity: 1,
        } : {
          price_data: {
            currency: "usd",
            product_data: {
              name: `CallGlobe Recharge — ${pkg.label}`,
              description: pkg.bonus_percent > 0
                ? `$${pkg.amount} + ${pkg.bonus_percent}% bonus = $${pkg.credit} calling credit`
                : `$${pkg.credit} calling credit`,
            },
            unit_amount: Math.round(pkg.amount * 100), // Stripe uses cents
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      success_url: successUrl,
      cancel_url: cancelUrl,
      client_reference_id: user.id,
      customer_email: user.email,
      metadata: {
        user_id: user.id,
        package_id: pkg.id,
        credit_amount: pkg.credit.toString(),
      },
    });

    return jsonResponse({ url: session.url, session_id: session.id });
  } catch (err) {
    console.error("Checkout error:", err);
    return jsonResponse({ error: err.message }, 500);
  }
});
