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

    const { reviewId, paymentId, profileSlug } = await req.json();
    if (!reviewId || !paymentId || !profileSlug) {
      return Response.json({ error: "Faltan reviewId, paymentId o profileSlug" }, { status: 400, headers: corsHeaders });
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

    const paymentResponse = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
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
      p_mp_payment_id: String(paymentId),
    });

    return Response.json(
      { ok: true, review_id: resolvedReviewId, payment_status: status },
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Error inesperado" },
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
