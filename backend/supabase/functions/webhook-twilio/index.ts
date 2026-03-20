// supabase/functions/webhook-twilio/index.ts
// Handles two things:
// 1. TwiML generation for outbound calls (Voice URL of TwiML App)
// 2. Status callbacks for call events (StatusCallback)

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

serve(async (req) => {
  // CORS for preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, content-type",
      },
    });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Parse form data (Twilio sends application/x-www-form-urlencoded)
    const formData = await req.formData();
    const params: Record<string, string> = {};
    for (const [key, value] of formData.entries()) {
      params[key] = value.toString();
    }

    const url = new URL(req.url);
    const path = url.pathname;

    console.log("Twilio webhook:", path, JSON.stringify(params));

    // ── VOICE URL: Generate TwiML for outbound call ──
    // When the Twilio Device connects, Twilio hits this URL to get TwiML instructions
    if (params.To && !params.CallStatus) {
      const to = params.To;
      const callerId = params.CallerId || Deno.env.get("TWILIO_CALLER_ID") || params.From;
      const userId = params.user_id;
      const callLogId = params.call_log_id;

      // Update call log with Twilio Call SID
      if (callLogId) {
        await supabase
          .from("call_logs")
          .update({
            telnyx_call_id: params.CallSid, // reusing column for Twilio CallSid
            status: "initiated",
          })
          .eq("id", callLogId);
      }

      // Return TwiML to dial the number
      const statusCallbackUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/webhook-twilio`;
      const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial callerId="${callerId}" timeout="30"
    action="${statusCallbackUrl}?user_id=${userId || ""}&amp;call_log_id=${callLogId || ""}"
    statusCallback="${statusCallbackUrl}?user_id=${userId || ""}&amp;call_log_id=${callLogId || ""}"
    statusCallbackEvent="initiated ringing answered completed"
    statusCallbackMethod="POST">
    <Number>${to}</Number>
  </Dial>
</Response>`;

      return new Response(twiml, {
        headers: { "Content-Type": "text/xml" },
      });
    }

    // ── STATUS CALLBACK: Handle call state updates ──
    const callStatus = params.CallStatus;
    const callSid = params.CallSid;
    const callDuration = params.CallDuration; // seconds, only on completed
    const userId = url.searchParams.get("user_id") || params.user_id;
    const callLogId = url.searchParams.get("call_log_id") || params.call_log_id;

    if (!callStatus) {
      return new Response("No status", { status: 400 });
    }

    console.log(`Twilio status: ${callStatus}, CallSid: ${callSid}, duration: ${callDuration}`);

    switch (callStatus) {
      case "initiated":
      case "ringing": {
        if (callLogId) {
          await supabase
            .from("call_logs")
            .update({
              telnyx_call_id: callSid,
              status: callStatus === "ringing" ? "ringing" : "initiated",
            })
            .eq("id", callLogId);
        }
        break;
      }

      case "in-progress":
      case "answered": {
        if (callLogId) {
          await supabase
            .from("call_logs")
            .update({
              status: "connected",
              connected_at: new Date().toISOString(),
            })
            .eq("id", callLogId);
        }
        break;
      }

      case "completed": {
        const durationSeconds = parseInt(callDuration || "0", 10);

        if (callLogId && userId) {
          // Get the call log to find the rate
          const { data: callLog } = await supabase
            .from("call_logs")
            .select("rate_per_min, destination_number")
            .eq("id", callLogId)
            .single();

          const ratePerMin = callLog?.rate_per_min || 0;
          const billableSeconds = Math.ceil(durationSeconds / 60) * 60;
          const totalCost = (billableSeconds / 60) * ratePerMin;

          // Update call log
          await supabase
            .from("call_logs")
            .update({
              status: "completed",
              duration_seconds: durationSeconds,
              billable_seconds: billableSeconds,
              total_cost: totalCost,
              ended_at: new Date().toISOString(),
            })
            .eq("id", callLogId);

          // Deduct balance
          if (totalCost > 0) {
            await supabase.rpc("deduct_balance", {
              p_user_id: userId,
              p_amount: totalCost,
              p_call_log_id: callLogId,
              p_description: `Call to ${callLog?.destination_number || "unknown"} (${Math.ceil(durationSeconds / 60)} min)`,
            });
          }
        }
        break;
      }

      case "busy":
      case "no-answer":
      case "failed":
      case "canceled": {
        if (callLogId) {
          const statusMap: Record<string, string> = {
            busy: "busy",
            "no-answer": "no_answer",
            failed: "failed",
            canceled: "failed",
          };
          await supabase
            .from("call_logs")
            .update({
              status: statusMap[callStatus] || "failed",
              ended_at: new Date().toISOString(),
            })
            .eq("id", callLogId);
        }
        break;
      }

      default:
        console.log(`Unhandled status: ${callStatus}`);
    }

    return new Response(JSON.stringify({ received: true }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Webhook error:", err);
    return new Response(`Error: ${err.message}`, { status: 500 });
  }
});
