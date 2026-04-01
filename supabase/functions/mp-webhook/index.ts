import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const fallbackMpAccessToken = Deno.env.get("MP_ACCESS_TOKEN") || "";
    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

    let body: Record<string, unknown> = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const url = new URL(req.url);
    const topic = String(body["type"] || body["topic"] || url.searchParams.get("topic") || "");
    const resourceId = String((body as any).data?.id || body["data.id"] || url.searchParams.get("id") || "");
    const profileId = url.searchParams.get("profile_id") || "";

    await supabase.from("mp_notifications").insert({
      mp_id: resourceId || null,
      topic,
      resource: resourceId || null,
      raw_body: body,
      processed: false,
    });

    if (!resourceId || (topic !== "payment" && topic !== "merchant_order")) {
      return new Response("OK", { status: 200 });
    }

    let mpAccessToken = fallbackMpAccessToken;

    if (profileId) {
      const { data: paymentCredentials } = await supabase
        .from("profile_payment_credentials")
        .select("mp_access_token")
        .eq("profile_id", profileId)
        .maybeSingle();

      if (paymentCredentials?.mp_access_token) {
        mpAccessToken = paymentCredentials.mp_access_token;
      }
    }

    if (!mpAccessToken) {
      return new Response("Falta Access Token para este perfil", { status: 500 });
    }

    let paymentId = resourceId;

    if (topic === "merchant_order") {
      const merchantOrderResponse = await fetch(`https://api.mercadopago.com/merchant_orders/${resourceId}`, {
        headers: {
          Authorization: `Bearer ${mpAccessToken}`,
        },
      });

      if (!merchantOrderResponse.ok) {
        return new Response("No se pudo validar la merchant order", { status: 502 });
      }

      const merchantOrder = await merchantOrderResponse.json();
      paymentId = String(merchantOrder.payments?.find((payment: { id?: string | number }) => payment?.id)?.id || "");
      if (!paymentId) {
        return new Response("Merchant order sin pagos asociados", { status: 200 });
      }
    }

    const paymentResponse = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: {
        Authorization: `Bearer ${mpAccessToken}`,
      },
    });

    if (!paymentResponse.ok) {
      return new Response("No se pudo validar el pago", { status: 502 });
    }

    const payment = await paymentResponse.json();
    const flowType = payment.metadata?.flow_type || "review";
    const reviewId = payment.external_reference || payment.metadata?.review_id;
    const unlockId = payment.external_reference || payment.metadata?.unlock_id;
    const status = payment.status || "pending";

    if (flowType === "media_unlock" && unlockId) {
      const { error: unlockError } = await supabase.rpc("mark_media_unlock_paid", {
        p_unlock_id: unlockId,
        p_status: status,
        p_mp_payment_id: String(paymentId),
      });
      if (unlockError) {
        console.error("mark_media_unlock_paid error", unlockError);
        return new Response("No se pudo actualizar el desbloqueo", { status: 500 });
      }
    } else if (reviewId) {
      let { error: publishError } = await supabase.rpc("publish_review_payment", {
        p_review_id: reviewId,
        p_status: status,
        p_mp_payment_id: String(paymentId),
      });
      if (publishError && /publish_review_payment|schema cache/i.test(publishError.message || "")) {
        try {
          await publishReviewPaymentFallback(supabase, String(reviewId), String(status), String(paymentId));
          publishError = null;
        } catch (fallbackError) {
          console.error("publish_review_payment fallback error", fallbackError);
          return new Response("No se pudo publicar la reseña", { status: 500 });
        }
      }
      if (publishError) {
        console.error("publish_review_payment error", publishError);
        return new Response("No se pudo publicar la reseña", { status: 500 });
      }
    }

    await supabase
      .from("mp_notifications")
      .update({ processed: true })
      .eq("mp_id", resourceId);

    return new Response("OK", { status: 200 });
  } catch (error) {
    console.error(error);
    return new Response("Webhook error", { status: 500 });
  }
});
