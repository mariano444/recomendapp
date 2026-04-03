import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function publishReviewPaymentFallback(
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
      mp_payment_id: paymentId || null,
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
    const fallbackMpAccessToken = Deno.env.get("MP_ACCESS_TOKEN") || "";
    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

    const { reviewId, paymentId, merchantOrderId, profileSlug } = await req.json();
    if (!reviewId || (!paymentId && !merchantOrderId) || !profileSlug) {
      return Response.json({ error: "Faltan reviewId, paymentId/merchantOrderId o profileSlug" }, { status: 400, headers: corsHeaders });
    }

    const profileQuery = supabase
      .from("profiles")
      .select("id");
    const { data: profile, error: profileError } = /^[0-9a-f-]{36}$/i.test(profileSlug)
      ? await profileQuery.eq("id", profileSlug).maybeSingle()
      : await profileQuery.eq("slug", profileSlug).maybeSingle();

    if (profileError || !profile) {
      return Response.json({ error: "Perfil no encontrado" }, { status: 404, headers: corsHeaders });
    }

    let mpAccessToken = fallbackMpAccessToken;
    const { data: paymentCredentials } = await supabase
      .from("profile_payment_credentials")
      .select("mp_access_token")
      .eq("profile_id", profile.id)
      .maybeSingle();

    if (paymentCredentials?.mp_access_token) {
      mpAccessToken = paymentCredentials.mp_access_token;
    }

    if (!mpAccessToken) {
      return Response.json({ error: "El perfil no tiene Access Token configurado" }, { status: 400, headers: corsHeaders });
    }

    let resolvedPaymentId = paymentId ? String(paymentId) : "";

    if (!resolvedPaymentId && merchantOrderId) {
      const merchantOrderResponse = await fetch(`https://api.mercadopago.com/merchant_orders/${merchantOrderId}`, {
        headers: {
          Authorization: `Bearer ${mpAccessToken}`,
        },
      });

      if (!merchantOrderResponse.ok) {
        const detail = await merchantOrderResponse.text();
        return Response.json({ error: detail || "No se pudo validar la merchant order" }, { status: 502, headers: corsHeaders });
      }

      const merchantOrder = await merchantOrderResponse.json();
      resolvedPaymentId = String(merchantOrder.payments?.find((payment: { id?: string | number }) => payment?.id)?.id || "");
    }

    if (!resolvedPaymentId) {
      return Response.json({ error: "No se encontro un paymentId asociado al pago" }, { status: 400, headers: corsHeaders });
    }

    const paymentResponse = await fetch(`https://api.mercadopago.com/v1/payments/${resolvedPaymentId}`, {
      headers: {
        Authorization: `Bearer ${mpAccessToken}`,
      },
    });

    if (!paymentResponse.ok) {
      const detail = await paymentResponse.text();
      return Response.json({ error: detail || "No se pudo validar el pago" }, { status: 502, headers: corsHeaders });
    }

    const payment = await paymentResponse.json();
    const status = payment.status || "pending";
    const resolvedReviewId = payment.external_reference || payment.metadata?.review_id || reviewId;

    let { error: publishError } = await supabase.rpc("publish_review_payment", {
      p_review_id: resolvedReviewId,
      p_status: status,
      p_mp_payment_id: resolvedPaymentId,
    });

    if (publishError && /publish_review_payment|schema cache/i.test(publishError.message || "")) {
      try {
        await publishReviewPaymentFallback(supabase, resolvedReviewId, status, resolvedPaymentId);
        publishError = null;
      } catch (fallbackError) {
        return Response.json(
          { error: fallbackError instanceof Error ? fallbackError.message : "No se pudo publicar la resena" },
          { status: 500, headers: corsHeaders },
        );
      }
    }

    if (publishError) {
      return Response.json(
        { error: publishError.message || "No se pudo publicar la reseña" },
        { status: 500, headers: corsHeaders },
      );
    }

    return Response.json(
      { ok: true, review_id: resolvedReviewId, payment_status: status, payment_id: resolvedPaymentId },
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Error inesperado" },
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
