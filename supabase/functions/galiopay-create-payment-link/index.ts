import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

function normalizeCheckoutLabel(value?: string | null) {
  const cleaned = (value || "").replace(/\s+/g, " ").trim();
  return (cleaned || "Recomendapp").slice(0, 60);
}

function getPaymentLinkId(url = "") {
  const match = url.match(/\/payment\/([^?]+)/i);
  return match?.[1] || "";
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const fallbackClientId = Deno.env.get("GALIOPAY_CLIENT_ID") || "";
    const fallbackApiKey = Deno.env.get("GALIOPAY_API_KEY") || "";
    const fallbackMode = Deno.env.get("GALIOPAY_MODE") || "production";
    const appUrlFromEnv = Deno.env.get("APP_URL") || "";
    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

    const { amount, profileSlug, reviewerName, reviewerPhone, reviewerProvince, reviewerLocality, reviewerAvatarUrl, reviewImageUrl, message, appUrl } = await req.json();

    if (!amount || Number(amount) < 100) {
      return Response.json({ error: "Monto invalido. El minimo es $100 ARS." }, { status: 400, headers: corsHeaders });
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("id, slug, nombre, apellido, min_amount, active")
      .eq("slug", profileSlug)
      .single();

    if (profileError || !profile || !profile.active) {
      return Response.json({ error: "Perfil no encontrado o inactivo." }, { status: 404, headers: corsHeaders });
    }

    if (profile.min_amount && Number(amount) < Math.round(profile.min_amount / 100)) {
      return Response.json({ error: "El monto es menor al minimo definido por el perfil." }, { status: 400, headers: corsHeaders });
    }

    const { data: paymentCredentials } = await supabase
      .from("profile_payment_credentials")
      .select("gp_client_id, gp_api_key, gp_mode, gp_checkout_label")
      .eq("profile_id", profile.id)
      .maybeSingle();

    const clientId = paymentCredentials?.gp_client_id || fallbackClientId;
    const apiKey = paymentCredentials?.gp_api_key || fallbackApiKey;
    const galioMode = paymentCredentials?.gp_mode || fallbackMode;
    const checkoutLabel = normalizeCheckoutLabel(paymentCredentials?.gp_checkout_label);

    if (!clientId || !apiKey) {
      throw new Error("Este perfil todavia no configuro sus credenciales de GalioPay");
    }

    const reviewInsert = {
      profile_id: profile.id,
      reviewer_nombre: reviewerName || "Anonimo",
      reviewer_phone: reviewerPhone || null,
      reviewer_province: reviewerProvince || null,
      reviewer_locality: reviewerLocality || null,
      reviewer_avatar_url: reviewerAvatarUrl || null,
      review_image_url: reviewImageUrl || null,
      is_anon: !reviewerName || reviewerName === "Anonimo",
      message: message || "",
      amount_cents: Math.round(Number(amount) * 100),
      payment_method: "galiopay",
      payment_status: "pending",
      published: false,
    };

    const { data: review, error: reviewError } = await supabase
      .from("reviews")
      .insert(reviewInsert)
      .select("id")
      .single();

    if (reviewError || !review) {
      throw new Error(reviewError?.message || "No se pudo crear la resena");
    }

    const originHeader = req.headers.get("origin") || "";
    const refererHeader = req.headers.get("referer") || "";
    const refererUrl = refererHeader ? new URL(refererHeader) : null;
    const returnBase =
      appUrl ||
      (refererUrl ? `${refererUrl.origin}${refererUrl.pathname}` : "") ||
      originHeader ||
      appUrlFromEnv;

    if (!returnBase) {
      throw new Error("Falta configurar APP_URL o enviar appUrl desde el frontend");
    }

    const webhookUrl = `${supabaseUrl}/functions/v1/galiopay-webhook?profile_id=${profile.id}`;
    const backBase = `${returnBase}?provider=galiopay&slug=${encodeURIComponent(profile.slug)}&review_id=${review.id}`;
    const galioPayload = {
      items: [
        {
          title: checkoutLabel,
          quantity: 1,
          unitPrice: Number(amount),
          currencyId: "ARS",
        },
      ],
      referenceId: review.id,
      notificationUrl: webhookUrl,
      sandbox: galioMode !== "production",
      backUrl: {
        success: `${backBase}&payment=approved`,
        failure: `${backBase}&payment=failed`,
      },
    };

    const galioResponse = await fetch("https://pay.galio.app/api/payment-links", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "x-client-id": clientId,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(galioPayload),
    });

    if (!galioResponse.ok) {
      const detail = await galioResponse.text();
      throw new Error(detail || "GalioPay rechazo el payment link");
    }

    const paymentLink = await galioResponse.json();
    const paymentLinkId = getPaymentLinkId(paymentLink.url || "");

    await supabase
      .from("reviews")
      .update({ gp_payment_link_id: paymentLinkId || null })
      .eq("id", review.id);

    return Response.json(
      {
        review_id: review.id,
        payment_link_id: paymentLinkId,
        proof_token: paymentLink.proofToken || "",
        init_point: paymentLink.url,
      },
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Error inesperado" },
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
