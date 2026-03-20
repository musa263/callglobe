import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function getRequiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function getCorsHeaders(req: Request) {
  const appBaseUrl = Deno.env.get("APP_BASE_URL");
  const origin = appBaseUrl
    ? new URL(appBaseUrl).origin
    : req.headers.get("origin") ?? "*";

  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "authorization, content-type",
  };
}

function jsonResponse(req: Request, body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...getCorsHeaders(req),
      "Content-Type": "application/json",
    },
  });
}

function isLegacyPromotionalBalance(profile: Record<string, unknown>) {
  return Number(profile.balance ?? 0) === 2.5
    && Number(profile.total_recharged ?? 0) === 0
    && Number(profile.total_spent ?? 0) === 0;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: getCorsHeaders(req) });
  }

  try {
    if (req.method !== "POST") {
      return jsonResponse(req, { error: "Method Not Allowed" }, 405);
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonResponse(req, { error: "Unauthorized" }, 401);
    }

    const authSupabase = createClient(
      getRequiredEnv("SUPABASE_URL"),
      getRequiredEnv("SUPABASE_ANON_KEY"),
      { global: { headers: { Authorization: authHeader } } },
    );

    const {
      data: { user },
      error: authError,
    } = await authSupabase.auth.getUser();

    if (authError || !user) {
      return jsonResponse(req, { error: "Unauthorized" }, 401);
    }

    const adminSupabase = createClient(
      getRequiredEnv("SUPABASE_URL"),
      getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
    );

    const { data: profile, error: profileError } = await adminSupabase
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .single();

    if (profileError || !profile) {
      return jsonResponse(req, { error: "Profile not found" }, 404);
    }

    if (!isLegacyPromotionalBalance(profile)) {
      return jsonResponse(req, { normalized: false, profile });
    }

    const { count, error: transactionError } = await adminSupabase
      .from("transactions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id);

    if (transactionError) {
      throw transactionError;
    }

    if ((count ?? 0) > 0) {
      return jsonResponse(req, { normalized: false, profile });
    }

    const { data: updatedProfile, error: updateError } = await adminSupabase
      .from("profiles")
      .update({
        balance: 0,
        updated_at: new Date().toISOString(),
      })
      .eq("id", user.id)
      .eq("balance", 2.5)
      .eq("total_recharged", 0)
      .eq("total_spent", 0)
      .select("*")
      .single();

    if (updateError || !updatedProfile) {
      throw updateError ?? new Error("Unable to normalize balance");
    }

    return jsonResponse(req, { normalized: true, profile: updatedProfile });
  } catch (err) {
    console.error("Normalize profile error:", err);
    return jsonResponse(req, { error: err.message }, 500);
  }
});
