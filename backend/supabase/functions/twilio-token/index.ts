// supabase/functions/twilio-token/index.ts
// Generates Twilio Access Tokens for WebRTC Voice SDK

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, content-type",
      },
    });
  }

  try {
    // Verify the user is authenticated
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response("Unauthorized", { status: 401 });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response("Unauthorized", { status: 401 });
    }

    // Get Twilio credentials from environment
    const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID")!;
    const apiKeySid = Deno.env.get("TWILIO_API_KEY_SID")!;
    const apiKeySecret = Deno.env.get("TWILIO_API_KEY_SECRET")!;
    const twimlAppSid = Deno.env.get("TWILIO_TWIML_APP_SID")!;

    // Generate access token
    const token = await createAccessToken(
      accountSid,
      apiKeySid,
      apiKeySecret,
      user.id,
      twimlAppSid
    );

    return new Response(JSON.stringify({ token }), {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (err) {
    console.error("Token generation error:", err);
    return new Response(`Error: ${err.message}`, { status: 500 });
  }
});
