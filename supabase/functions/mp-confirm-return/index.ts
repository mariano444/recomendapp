import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("id")
      .eq("slug", profileSlug)
      .single();

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

    await supabase.rpc("publish_review_payment", {
      p_review_id: resolvedReviewId,
      p_status: status,
      p_mp_payment_id: resolvedPaymentId,
    });

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
