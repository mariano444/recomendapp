import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function publishGalioReview(
  supabase: ReturnType<typeof createClient>,
  reviewId: string,
  status: string,
  paymentId: string,
  paymentLinkId: string,
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
      gp_payment_link_id: paymentLinkId || null,
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

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const fallbackClientId = Deno.env.get("GALIOPAY_CLIENT_ID") || "";
    const fallbackApiKey = Deno.env.get("GALIOPAY_API_KEY") || "";
    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

    const { reviewId, paymentLinkId, proofToken, profileSlug } = await req.json();
    if (!reviewId || !paymentLinkId || !proofToken || !profileSlug) {
      return Response.json({ error: "Faltan reviewId, paymentLinkId, proofToken o profileSlug" }, { status: 400, headers: corsHeaders });
    }

    const profileQuery = supabase.from("profiles").select("id");
    const { data: profile, error: profileError } = /^[0-9a-f-]{36}$/i.test(profileSlug)
      ? await profileQuery.eq("id", profileSlug).maybeSingle()
      : await profileQuery.eq("slug", profileSlug).maybeSingle();

    if (profileError || !profile) {
      return Response.json({ error: "Perfil no encontrado" }, { status: 404, headers: corsHeaders });
    }

    const { data: paymentCredentials } = await supabase
      .from("profile_payment_credentials")
      .select("gp_client_id, gp_api_key")
      .eq("profile_id", profile.id)
      .maybeSingle();

    const clientId = paymentCredentials?.gp_client_id || fallbackClientId;
    const apiKey = paymentCredentials?.gp_api_key || fallbackApiKey;
    if (!clientId || !apiKey) {
      return Response.json({ error: "El perfil no tiene Client ID o API Key configurados" }, { status: 400, headers: corsHeaders });
    }

    const paymentLinkResponse = await fetch(`https://pay.galio.app/api/payment-links/${paymentLinkId}?proof=${encodeURIComponent(proofToken)}`);
    if (!paymentLinkResponse.ok) {
      const detail = await paymentLinkResponse.text();
      return Response.json({ error: detail || "No se pudo validar el payment link" }, { status: 502, headers: corsHeaders });
    }

    const paymentLink = await paymentLinkResponse.json();
    const resolvedPaymentId = String(paymentLink.paymentId || "");
    const linkStatus = String(paymentLink.status || "pending");

    if (!resolvedPaymentId) {
      await publishGalioReview(supabase, reviewId, linkStatus, "", paymentLinkId);
      return Response.json(
        { ok: true, review_id: reviewId, payment_status: linkStatus, payment_id: null, payment_link_id: paymentLinkId },
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const paymentResponse = await fetch(`https://pay.galio.app/api/payments/${resolvedPaymentId}`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "x-client-id": clientId,
        "Content-Type": "application/json",
      },
    });

    if (!paymentResponse.ok) {
      const detail = await paymentResponse.text();
      return Response.json({ error: detail || "No se pudo validar el pago" }, { status: 502, headers: corsHeaders });
    }

    const payment = await paymentResponse.json();
    const status = payment.status || linkStatus || "pending";
    const resolvedReviewId = payment.referenceId || reviewId;

    await publishGalioReview(supabase, resolvedReviewId, status, resolvedPaymentId, paymentLinkId);

    return Response.json(
      { ok: true, review_id: resolvedReviewId, payment_status: status, payment_id: resolvedPaymentId, payment_link_id: paymentLinkId },
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Error inesperado" },
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
