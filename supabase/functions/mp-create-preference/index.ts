import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const fallbackMpAccessToken = Deno.env.get("MP_ACCESS_TOKEN");
    const appUrlFromEnv = Deno.env.get("APP_URL") || "";
    const fallbackMpMode = Deno.env.get("MP_MODE") || "production";
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);
    const { amount, profileSlug, reviewerName, message, appUrl } = await req.json();

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
      .select("mp_access_token, mp_mode")
      .eq("profile_id", profile.id)
      .maybeSingle();

    const mpAccessToken = paymentCredentials?.mp_access_token || fallbackMpAccessToken;
    const effectiveMpMode = paymentCredentials?.mp_mode || fallbackMpMode;

    if (!mpAccessToken) {
      throw new Error("Este perfil todavia no configuro su Access Token de MercadoPago");
    }

    const reviewInsert = {
      profile_id: profile.id,
      reviewer_nombre: reviewerName || "Anonimo",
      is_anon: !reviewerName || reviewerName === "Anonimo",
      message: message || "",
      amount_cents: Math.round(Number(amount) * 100),
      payment_method: "mercadopago",
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
    const returnBase = appUrl || (refererUrl ? `${refererUrl.origin}${refererUrl.pathname}` : "") || originHeader || appUrlFromEnv;

    if (!returnBase) {
      throw new Error("Falta configurar APP_URL o enviar appUrl desde el frontend");
    }

    const webhookUrl = `${supabaseUrl}/functions/v1/mp-webhook?profile_id=${profile.id}`;
    const backBase = `${returnBase}?slug=${encodeURIComponent(profile.slug)}&review_id=${review.id}`;

    const mpPayload = {
      items: [
        {
          id: review.id,
          title: `Aplauso para ${profile.nombre} ${profile.apellido || ""}`.trim(),
          description: "Aplauso con resena publicada al aprobarse el pago",
          quantity: 1,
          currency_id: "ARS",
          unit_price: Number(amount),
        },
      ],
      payer: {
        name: reviewerName || "Anonimo",
      },
      external_reference: review.id,
      notification_url: webhookUrl,
      back_urls: {
        success: `${backBase}&payment=approved`,
        failure: `${backBase}&payment=failed`,
        pending: `${backBase}&payment=pending`,
      },
      auto_return: "approved",
      metadata: {
        review_id: review.id,
        profile_id: profile.id,
        profile_slug: profile.slug,
      },
    };

    const mpResponse = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${mpAccessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(mpPayload),
    });

    if (!mpResponse.ok) {
      const detail = await mpResponse.text();
      throw new Error(detail || "MercadoPago rechazo la preferencia");
    }

    const preference = await mpResponse.json();

    await supabase.from("mp_preferences").insert({
      review_id: review.id,
      preference_id: preference.id,
      init_point: preference.init_point,
      sandbox_init_point: preference.sandbox_init_point,
      amount_cents: Math.round(Number(amount) * 100),
      status: "created",
    });

    await supabase
      .from("reviews")
      .update({ mp_preference_id: preference.id })
      .eq("id", review.id);

    return Response.json(
      {
        review_id: review.id,
        preference_id: preference.id,
        init_point: effectiveMpMode === "production" ? preference.init_point : (preference.sandbox_init_point || preference.init_point),
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
