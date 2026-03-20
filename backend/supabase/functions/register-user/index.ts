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
    "Access-Control-Allow-Headers": "content-type",
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

function normalizeEmail(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function normalizeName(value: unknown, email: string) {
  if (typeof value === "string" && value.trim()) {
    return value.trim().slice(0, 120);
  }

  return email.split("@")[0]?.slice(0, 120) || "CallGlobe User";
}

function validateEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: getCorsHeaders(req) });
  }

  try {
    if (req.method !== "POST") {
      return jsonResponse(req, { error: "Method Not Allowed" }, 405);
    }

    const body = await req.json().catch(() => null);
    const email = normalizeEmail(body?.email);
    const password = typeof body?.password === "string" ? body.password : "";
    const fullName = normalizeName(body?.full_name, email);

    if (!validateEmail(email)) {
      return jsonResponse(req, { error: "Enter a valid email address." }, 400);
    }

    if (password.length < 8) {
      return jsonResponse(req, { error: "Password must be at least 8 characters." }, 400);
    }

    const adminSupabase = createClient(
      getRequiredEnv("SUPABASE_URL"),
      getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      },
    );

    const { data, error } = await adminSupabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: fullName,
      },
    });

    if (error) {
      const message = error.message || "Unable to create account.";
      const normalizedMessage = message.toLowerCase();

      if (
        normalizedMessage.includes("already registered")
        || normalizedMessage.includes("already been registered")
        || normalizedMessage.includes("user already exists")
      ) {
        return jsonResponse(req, { error: "An account with this email already exists. Log in instead." }, 409);
      }

      return jsonResponse(req, { error: message }, 400);
    }

    return jsonResponse(req, {
      user_id: data.user?.id,
      email: data.user?.email,
    });
  } catch (err) {
    console.error("Register user error:", err);
    return jsonResponse(req, { error: err.message }, 500);
  }
});
