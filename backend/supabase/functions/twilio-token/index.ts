// supabase/functions/twilio-token/index.ts
// Generates Twilio Access Tokens for WebRTC Voice SDK

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function getRequiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function getAllowedOrigin() {
  const appBaseUrl = Deno.env.get("APP_BASE_URL");
  if (!appBaseUrl) return "*";
  return new URL(appBaseUrl).origin;
}

function base64urlEncode(value: string) {
  return btoa(value)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function createSignedPayload(payload: Record<string, unknown>, secret: string) {
  const encoder = new TextEncoder();
  const payloadB64 = base64urlEncode(JSON.stringify(payload));
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signature = await crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    encoder.encode(payloadB64),
  );

  const signatureB64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  return `${payloadB64}.${signatureB64}`;
}

// Twilio JWT helper — we build the token manually since Deno doesn't have the twilio SDK
// Access Token structure: Header.Payload.Signature (JWT)
async function createAccessToken(
  accountSid: string,
  apiKeySid: string,
  apiKeySecret: string,
  identity: string,
  twimlAppSid: string
): Promise<string> {
  const header = {
    typ: "JWT",
    alg: "HS256",
    cty: "twilio-fpa;v=1",
  };

  const now = Math.floor(Date.now() / 1000);
  const payload = {
    jti: `${apiKeySid}-${now}`,
    iss: apiKeySid,
    sub: accountSid,
    exp: now + 3600, // 1 hour
    grants: {
      identity: identity,
      voice: {
        incoming: { allow: true },
        outgoing: {
          application_sid: twimlAppSid,
        },
      },
    },
  };

  const encoder = new TextEncoder();

  function base64url(data: string): string {
    return btoa(data)
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  }

  const headerB64 = base64url(JSON.stringify(header));
  const payloadB64 = base64url(JSON.stringify(payload));
  const signingInput = `${headerB64}.${payloadB64}`;

  // HMAC-SHA256 signature
  const keyData = encoder.encode(apiKeySecret);
  const msgData = encoder.encode(signingInput);

  // Use Web Crypto API for HMAC
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign("HMAC", cryptoKey, msgData);
  const sigB64 = base64url(
    String.fromCharCode(...new Uint8Array(signature))
  );

  return `${headerB64}.${payloadB64}.${sigB64}`;
}

serve(async (req) => {
  // CORS
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": getAllowedOrigin(),
        "Access-Control-Allow-Headers": "authorization, content-type",
      },
    });
  }

  try {
    if (req.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    // Verify the user is authenticated
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response("Unauthorized", { status: 401 });
    }

    const supabase = createClient(
      getRequiredEnv("SUPABASE_URL"),
      getRequiredEnv("SUPABASE_ANON_KEY"),
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response("Unauthorized", { status: 401 });
    }

    // Get Twilio credentials from environment
    const accountSid = getRequiredEnv("TWILIO_ACCOUNT_SID");
    const apiKeySid = getRequiredEnv("TWILIO_API_KEY_SID");
    const apiKeySecret = getRequiredEnv("TWILIO_API_KEY_SECRET");
    const twimlAppSid = getRequiredEnv("TWILIO_TWIML_APP_SID");
    const twilioAuthToken = getRequiredEnv("TWILIO_AUTH_TOKEN");

    // Generate access token
    const token = await createAccessToken(
      accountSid,
      apiKeySid,
      apiKeySecret,
      user.id,
      twimlAppSid
    );

    const callToken = await createSignedPayload(
      {
        sub: user.id,
        exp: Math.floor(Date.now() / 1000) + 300,
      },
      twilioAuthToken,
    );

    return new Response(JSON.stringify({ token, call_token: callToken }), {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": getAllowedOrigin(),
      },
    });
  } catch (err) {
    console.error("Token generation error:", err);
    return new Response(`Error: ${err.message}`, { status: 500 });
  }
});
