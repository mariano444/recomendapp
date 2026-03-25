import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
    const reviewId = payment.external_reference || payment.metadata?.review_id;
    const status = payment.status || "pending";

    if (reviewId) {
      await supabase.rpc("publish_review_payment", {
        p_review_id: reviewId,
        p_status: status,
        p_mp_payment_id: String(paymentId),
      });
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
