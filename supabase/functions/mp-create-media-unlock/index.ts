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
    const { mediaItemId, profileSlug, appUrl } = await req.json();

    if (!mediaItemId || !profileSlug) {
      return Response.json({ error: "Faltan mediaItemId o profileSlug" }, { status: 400, headers: corsHeaders });
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("id, slug, active")
      .eq("slug", profileSlug)
      .single();

    if (profileError || !profile || !profile.active) {
      return Response.json({ error: "Perfil no encontrado o inactivo." }, { status: 404, headers: corsHeaders });
    }

    const { data: mediaItem, error: mediaError } = await supabase
      .from("profile_media_items")
      .select("id, title, price_cents, visibility, active")
      .eq("id", mediaItemId)
      .eq("profile_id", profile.id)
      .single();

    if (mediaError || !mediaItem || !mediaItem.active) {
      return Response.json({ error: "Contenido no encontrado o inactivo." }, { status: 404, headers: corsHeaders });
    }

    if (mediaItem.visibility !== "private") {
      return Response.json({ error: "Este contenido ya es publico y no requiere desbloqueo." }, { status: 400, headers: corsHeaders });
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

    const { data: unlock, error: unlockError } = await supabase
      .from("media_unlocks")
      .insert({
        media_item_id: mediaItem.id,
        profile_id: profile.id,
        amount_cents: mediaItem.price_cents || 0,
        payment_status: "pending",
      })
      .select("id")
      .single();

    if (unlockError || !unlock) {
      throw new Error(unlockError?.message || "No se pudo crear el desbloqueo");
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

    const webhookUrl = `${supabaseUrl}/functions/v1/mp-webhook?profile_id=${profile.id}`;
    const backBase = `${returnBase}?slug=${encodeURIComponent(profile.slug)}&unlock_id=${unlock.id}&media_item_id=${mediaItem.id}&media=1`;

    const mpPayload = {
      items: [
        {
          id: mediaItem.id,
          title: "Desbloquear imagen",
          description: mediaItem.title || "Acceso a contenido privado",
          quantity: 1,
          currency_id: "ARS",
          unit_price: Math.round((mediaItem.price_cents || 0) / 100),
        },
      ],
      statement_descriptor: "RESENA",
      binary_mode: true,
      external_reference: unlock.id,
      notification_url: webhookUrl,
      back_urls: {
        success: `${backBase}&payment=approved`,
        failure: `${backBase}&payment=failed`,
        pending: `${backBase}&payment=pending`,
      },
      auto_return: "approved",
      metadata: {
        unlock_id: unlock.id,
        media_item_id: mediaItem.id,
        profile_id: profile.id,
        profile_slug: profile.slug,
        flow_type: "media_unlock",
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

    await supabase
      .from("media_unlocks")
      .update({ mp_preference_id: preference.id })
      .eq("id", unlock.id);

    return Response.json(
      {
        unlock_id: unlock.id,
        media_item_id: mediaItem.id,
        preference_id: preference.id,
        init_point:
          effectiveMpMode === "production"
            ? preference.init_point
            : (preference.sandbox_init_point || preference.init_point),
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
