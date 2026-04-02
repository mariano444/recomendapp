import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

async function publishGalioReview(
  supabase: ReturnType<typeof createClient>,
  reviewId: string,
  status: string,
  paymentId: string,
) {
  const { data: review, error: reviewError } = await supabase
    .from("reviews")
    .select("id, profile_id, amount_cents, payment_status")
    .eq("id", reviewId)
    .maybeSingle();

  if (reviewError || !review) {
    throw new Error(reviewError?.message || "No se encontro la resena");
  }

  const wasApproved = review.payment_status === "approved";
  const nextStatus = String(status || "pending");

  const { error: updateReviewError } = await supabase
    .from("reviews")
    .update({
      gp_payment_id: paymentId || null,
      payment_status: nextStatus,
      published: nextStatus === "approved",
      updated_at: new Date().toISOString(),
    })
    .eq("id", reviewId);

  if (updateReviewError) {
    throw new Error(updateReviewError.message || "No se pudo actualizar la resena");
  }

  if (nextStatus === "approved" && !wasApproved) {
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("total_earned, review_count")
      .eq("id", review.profile_id)
      .maybeSingle();

    if (profileError || !profile) {
      throw new Error(profileError?.message || "No se encontro el perfil");
    }

    const { error: updateProfileError } = await supabase
      .from("profiles")
      .update({
        total_earned: Number(profile.total_earned || 0) + Number(review.amount_cents || 0),
        review_count: Number(profile.review_count || 0) + 1,
        updated_at: new Date().toISOString(),
      })
      .eq("id", review.profile_id);

    if (updateProfileError) {
      throw new Error(updateProfileError.message || "No se pudo actualizar el perfil");
    }
  }
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

    let body: Record<string, unknown> = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const paymentId = String(body["id"] || "");
    const referenceId = String(body["referenceId"] || "");
    const paymentMethodId = String(body["paymentMethodId"] || "");
    const status = String(body["status"] || "pending");

    await supabase.from("gp_notifications").insert({
      gp_payment_id: paymentId || null,
      reference_id: referenceId || null,
      payment_method_id: paymentMethodId || null,
      status,
      raw_body: body,
      processed: false,
    });

    if (!referenceId) {
      return new Response("OK", { status: 200 });
    }

    await publishGalioReview(supabase, referenceId, status, paymentId);

    await supabase
      .from("gp_notifications")
      .update({ processed: true })
      .eq("gp_payment_id", paymentId);

    return new Response("OK", { status: 200, headers: corsHeaders });
  } catch (error) {
    console.error(error);
    return new Response("OK", { status: 200, headers: corsHeaders });
  }
});
