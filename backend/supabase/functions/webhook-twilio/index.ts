// supabase/functions/webhook-twilio/index.ts
// Twilio Voice webhook:
// 1. Generates TwiML for outbound calls from the JS Voice SDK
// 2. Processes signed Twilio status callbacks for call lifecycle updates

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type TwilioParams = Record<string, string>;
let warnedAboutMissingTwilioAuthToken = false;
let detectedCallLogSchema: "provider" | "legacy" | null = null;

function getRequiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function xmlResponse(xml: string, status = 200) {
  return new Response(xml, {
    status,
    headers: { "Content-Type": "text/xml; charset=utf-8" },
  });
}

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function hangupResponse(message?: string) {
  const messageNode = message ? `<Say>${escapeXml(message)}</Say>` : "";
  return xmlResponse(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${messageNode}
  <Hangup />
</Response>`);
}

function parseIdentity(fromValue: string | undefined) {
  if (!fromValue?.startsWith("client:")) return null;
  return fromValue.slice("client:".length);
}

function normalizeCountryCode(value: string | undefined) {
  if (!value) return null;
  const normalized = value.toUpperCase().replace(/[^A-Z]/g, "");
  return normalized.length === 2 ? normalized : null;
}

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

async function computeTwilioSignature(url: string, params: TwilioParams, authToken: string) {
  const payload = Object.keys(params)
    .sort((a, b) => a.localeCompare(b))
    .reduce((acc, key) => `${acc}${key}${params[key]}`, url);

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(authToken),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );

  const signature = await crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    new TextEncoder().encode(payload),
  );

  return btoa(String.fromCharCode(...new Uint8Array(signature)));
}

async function verifyTwilioSignature(req: Request, params: TwilioParams) {
  const authToken = Deno.env.get("TWILIO_AUTH_TOKEN");
  if (!authToken) {
    if (!warnedAboutMissingTwilioAuthToken) {
      console.warn("TWILIO_AUTH_TOKEN is not set. Skipping Twilio webhook signature verification.");
      warnedAboutMissingTwilioAuthToken = true;
    }
    return true;
  }

  const signature = req.headers.get("x-twilio-signature");
  if (!signature) return false;

  const expectedSignature = await computeTwilioSignature(
    req.url,
    params,
    authToken,
  );

  return timingSafeEqual(signature, expectedSignature);
}

async function readTwilioParams(req: Request) {
  const params: TwilioParams = {};
  const contentType = req.headers.get("content-type") ?? "";

  if (req.method === "POST" && contentType.includes("application/x-www-form-urlencoded")) {
    const formData = await req.formData();
    for (const [key, value] of formData.entries()) {
      params[key] = value.toString();
    }
    return params;
  }

  const url = new URL(req.url);
  url.searchParams.forEach((value, key) => {
    params[key] = value;
  });

  return params;
}

async function resolveRate(
  supabase: ReturnType<typeof createClient>,
  destinationNumber: string,
  requestedCountryCode: string | null,
) {
  if (requestedCountryCode) {
    const { data: requestedRate } = await supabase
      .from("call_rates")
      .select("country_code, country_name, dial_code, rate_per_min")
      .eq("country_code", requestedCountryCode)
      .eq("is_active", true)
      .maybeSingle();

    if (requestedRate && destinationNumber.startsWith(requestedRate.dial_code)) {
      return requestedRate;
    }
  }

  const { data: rates, error } = await supabase
    .from("call_rates")
    .select("country_code, country_name, dial_code, rate_per_min")
    .eq("is_active", true);

  if (error) throw error;

  return [...(rates ?? [])]
    .sort((a, b) => b.dial_code.length - a.dial_code.length)
    .find((rate) => destinationNumber.startsWith(rate.dial_code)) ?? null;
}

async function detectCallLogSchema(supabase: ReturnType<typeof createClient>) {
  if (detectedCallLogSchema) {
    return detectedCallLogSchema;
  }

  const { error } = await supabase
    .from("call_logs")
    .select("provider_call_id")
    .limit(1);

  if (!error) {
    detectedCallLogSchema = "provider";
    return detectedCallLogSchema;
  }

  if (error.code === "42703") {
    detectedCallLogSchema = "legacy";
    return detectedCallLogSchema;
  }

  throw error;
}

async function persistCallLog(
  supabase: ReturnType<typeof createClient>,
  providerCallId: string,
  payload: Record<string, unknown>,
) {
  const callLogSchema = await detectCallLogSchema(supabase);

  if (callLogSchema === "provider") {
    const { error } = await supabase
      .from("call_logs")
      .upsert(
        {
          ...payload,
          provider_call_id: providerCallId,
        },
        { onConflict: "provider_call_id" },
      );

    return { callLogSchema, error };
  }

  const { data: existingCallLog, error: existingCallLogError } = await supabase
    .from("call_logs")
    .select("id")
    .eq("telnyx_call_id", providerCallId)
    .maybeSingle();

  if (existingCallLogError) {
    return { callLogSchema, error: existingCallLogError };
  }

  if (existingCallLog?.id) {
    const { error } = await supabase
      .from("call_logs")
      .update({
        ...payload,
        telnyx_call_id: providerCallId,
      })
      .eq("id", existingCallLog.id);

    return { callLogSchema, error };
  }

  const { error } = await supabase
    .from("call_logs")
    .insert({
      ...payload,
      telnyx_call_id: providerCallId,
    });

  return { callLogSchema, error };
}

async function updateCallLogStatus(
  supabase: ReturnType<typeof createClient>,
  providerCallId: string,
  payload: Record<string, unknown>,
) {
  const callLogSchema = await detectCallLogSchema(supabase);
  const callIdColumn = callLogSchema === "provider" ? "provider_call_id" : "telnyx_call_id";

  const { error } = await supabase
    .from("call_logs")
    .update(payload)
    .eq(callIdColumn, providerCallId);

  return { callLogSchema, error };
}

async function finalizeLegacyCompletedCall(
  supabase: ReturnType<typeof createClient>,
  providerCallId: string,
  durationSeconds: number,
  endedAt: string,
) {
  const safeDurationSeconds = Number.isNaN(durationSeconds) ? 0 : Math.max(durationSeconds, 0);
  const { data: callLog, error: callLogError } = await supabase
    .from("call_logs")
    .select("id, user_id, destination_number, rate_per_min, status, total_cost, ended_at")
    .eq("telnyx_call_id", providerCallId)
    .maybeSingle();

  if (callLogError) {
    return { success: false, error: callLogError.message };
  }

  if (!callLog) {
    return { success: false, error: "Call log not found" };
  }

  if (callLog.status === "completed" && callLog.ended_at) {
    return {
      success: true,
      duplicate: true,
      call_log_id: callLog.id,
      total_cost: callLog.total_cost,
    };
  }

  const billableSeconds = safeDurationSeconds > 0
    ? Math.ceil(safeDurationSeconds / 60) * 60
    : 0;
  const totalCost = billableSeconds > 0
    ? Number((((billableSeconds / 60) * Number(callLog.rate_per_min ?? 0)).toFixed(4)))
    : 0;

  let chargeResult: Record<string, unknown> = { success: true };
  if (totalCost > 0) {
    const { data, error } = await supabase.rpc("deduct_balance", {
      p_user_id: callLog.user_id,
      p_amount: totalCost,
      p_call_log_id: callLog.id,
      p_description: `Call to ${callLog.destination_number || "unknown"} (${Math.ceil(safeDurationSeconds / 60)} min)`,
    });

    if (error) {
      chargeResult = { success: false, error: error.message };
    } else {
      chargeResult = (data as Record<string, unknown>) ?? { success: true };
    }
  }

  await supabase
    .from("call_logs")
    .update({
      status: "completed",
      duration_seconds: safeDurationSeconds,
      billable_seconds: billableSeconds,
      total_cost: totalCost,
      ended_at: endedAt,
    })
    .eq("id", callLog.id);

  return {
    ...(chargeResult ?? { success: true }),
    duplicate: false,
    call_log_id: callLog.id,
    total_cost: totalCost,
  };
}

async function handleVoiceRequest(
  supabase: ReturnType<typeof createClient>,
  params: TwilioParams,
) {
  const providerCallId = params.CallSid;
  const destinationNumber = params.destination ?? params.Destination ?? params.To;
  const userId = parseIdentity(params.From);
  const selectedCountryCode = normalizeCountryCode(params.country_code);

  if (!providerCallId || !destinationNumber || !userId) {
    return hangupResponse("Unable to place this call.");
  }

  const rate = await resolveRate(supabase, destinationNumber, selectedCountryCode);
  if (!rate) {
    return hangupResponse("Unsupported destination.");
  }

  const ratePerMinute = Number(rate.rate_per_min ?? 0);
  if (!Number.isFinite(ratePerMinute) || ratePerMinute <= 0) {
    return hangupResponse("Destination unavailable.");
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("balance")
    .eq("id", userId)
    .single();

  if (profileError || !profile) {
    console.error("Profile lookup failed", { userId, error: profileError });
    return hangupResponse("Account not found.");
  }

  const balance = Number(profile.balance ?? 0);
  const maxWholeMinutes = Math.floor(balance / ratePerMinute);

  const callLogPayload = {
    user_id: userId,
    destination_number: destinationNumber,
    destination_country: rate.country_name,
    destination_country_code: rate.country_code,
    rate_per_min: rate.rate_per_min,
    status: maxWholeMinutes > 0 ? "initiated" : "failed",
    metadata: {
      provider: "twilio",
      twilio_from: params.From ?? null,
      requested_country_code: selectedCountryCode,
      failure_reason: maxWholeMinutes > 0 ? null : "insufficient_balance",
    },
  };

  const { error: callLogError } = await persistCallLog(
    supabase,
    providerCallId,
    callLogPayload,
  );

  if (callLogError) {
    console.error("Failed to persist call log", { providerCallId, error: callLogError });
    return hangupResponse("Unable to place this call.");
  }

  if (maxWholeMinutes < 1) {
    return hangupResponse("Insufficient balance.");
  }

  const statusCallbackUrl = `${getRequiredEnv("SUPABASE_URL")}/functions/v1/webhook-twilio`;
  const callerId = getRequiredEnv("TWILIO_CALLER_ID");

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial callerId="${escapeXml(callerId)}" timeout="30" timeLimit="${maxWholeMinutes * 60}" answerOnBridge="true" statusCallback="${escapeXml(statusCallbackUrl)}" statusCallbackEvent="initiated ringing answered completed" statusCallbackMethod="POST">
    <Number>${escapeXml(destinationNumber)}</Number>
  </Dial>
</Response>`;

  return xmlResponse(twiml);
}

async function handleStatusCallback(
  supabase: ReturnType<typeof createClient>,
  params: TwilioParams,
) {
  const callStatus = params.CallStatus;
  const callbackCallId = params.CallSid;
  const providerCallId = params.ParentCallSid || callbackCallId;

  if (!callStatus || !providerCallId) {
    return new Response("Missing call status", { status: 400 });
  }

  switch (callStatus) {
    case "initiated":
    case "ringing": {
      await updateCallLogStatus(supabase, providerCallId, {
        status: callStatus === "ringing" ? "ringing" : "initiated",
      });
      break;
    }

    case "answered":
    case "in-progress": {
      await updateCallLogStatus(supabase, providerCallId, {
        status: "connected",
        connected_at: new Date().toISOString(),
      });
      break;
    }

    case "completed": {
      const durationSeconds = Number.parseInt(params.CallDuration || "0", 10);
      const endedAt = new Date().toISOString();
      const callLogSchema = await detectCallLogSchema(supabase);
      const { data, error } = callLogSchema === "provider"
        ? await supabase.rpc("process_completed_call", {
          p_provider_call_id: providerCallId,
          p_duration_seconds: Number.isNaN(durationSeconds) ? 0 : durationSeconds,
          p_ended_at: endedAt,
        })
        : { data: await finalizeLegacyCompletedCall(supabase, providerCallId, durationSeconds, endedAt), error: null };

      if (error) {
        console.error("Failed to finalize completed call", { providerCallId, callbackCallId, error });
      } else if (data?.success === false) {
        console.error("Completed call finalized with billing error", {
          providerCallId,
          callbackCallId,
          result: data,
        });
      }

      break;
    }

    case "busy":
    case "no-answer":
    case "failed":
    case "canceled": {
      const statusMap: Record<string, string> = {
        busy: "busy",
        "no-answer": "no_answer",
        failed: "failed",
        canceled: "failed",
      };

      await updateCallLogStatus(supabase, providerCallId, {
        status: statusMap[callStatus] ?? "failed",
        ended_at: new Date().toISOString(),
      });
      break;
    }

    default:
      console.log(`Unhandled Twilio status: ${callStatus}`);
  }

  return jsonResponse({ received: true });
}

serve(async (req) => {
  try {
    const params = await readTwilioParams(req);
    const signatureValid = await verifyTwilioSignature(req, params);

    if (!signatureValid) {
      console.error("Rejected Twilio webhook with invalid signature");
      return new Response("Forbidden", { status: 403 });
    }

    const supabase = createClient(
      getRequiredEnv("SUPABASE_URL"),
      getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
    );

    if (params.To && !params.CallStatus) {
      return await handleVoiceRequest(supabase, params);
    }

    return await handleStatusCallback(supabase, params);
  } catch (err) {
    console.error("Twilio webhook error:", err);
    return new Response(`Error: ${err.message}`, { status: 500 });
  }
});
