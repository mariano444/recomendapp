// ═══════════════════════════════════════════════════════════════
//  APLAUSO — Edge Functions para Supabase
//  Dos funciones necesarias:
//    1. mp-create-preference   → crea una preferencia de pago MP
//    2. mp-webhook             → recibe notificaciones de MP
//
//  Estructura de carpetas:
//  supabase/
//  └── functions/
//      ├── mp-create-preference/
//      │   └── index.ts
//      └── mp-webhook/
//          └── index.ts
//
//  Configurar secrets en Supabase Dashboard → Settings → Secrets:
//    MP_ACCESS_TOKEN=APP_USR-xxxxxxxxxxxx
//    MP_PUBLIC_KEY=APP_USR-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
//    MP_MODE=production   (o sandbox)
//    APP_URL=https://aplauso.app
// ═══════════════════════════════════════════════════════════════


// ─────────────────────────────────────────────────────────────
// FUNCIÓN 1: supabase/functions/mp-create-preference/index.ts
// ─────────────────────────────────────────────────────────────
/*

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const MP_ACCESS_TOKEN = Deno.env.get("MP_ACCESS_TOKEN");
  const APP_URL         = Deno.env.get("APP_URL") || "https://aplauso.app";

  if (!MP_ACCESS_TOKEN) {
    return new Response(JSON.stringify({ error: "MP_ACCESS_TOKEN no configurado" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  // Supabase client con service role (para insertar en tablas protegidas)
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const { amount, profileSlug, reviewerName, message } = await req.json();

  if (!amount || amount < 100) {
    return new Response(JSON.stringify({ error: "Monto inválido (mínimo $100)" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  // Obtener el perfil del profesional
  const { data: profile, error: profileErr } = await supabase
    .from("profiles")
    .select("id, nombre, apellido")
    .eq("slug", profileSlug)
    .single();

  if (profileErr || !profile) {
    return new Response(JSON.stringify({ error: "Perfil no encontrado" }), {
      status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  // Crear reseña en estado pending
  const { data: review, error: reviewErr } = await supabase
    .from("reviews")
    .insert({
      profile_id:      profile.id,
      reviewer_nombre: reviewerName || "Anónimo",
      message:         message || "",
      amount_cents:    amount * 100,
      payment_method:  "mercadopago",
      payment_status:  "pending",
      is_anon:         reviewerName === "Anónimo",
      published:       false,
    })
    .select("id")
    .single();

  if (reviewErr) {
    return new Response(JSON.stringify({ error: "Error al crear reseña" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  // Crear preferencia en MercadoPago
  const mpBody = {
    items: [{
      id:          review.id,
      title:       `Reseña para ${profile.nombre} ${profile.apellido}`,
      description: `Recompensa en Aplauso`,
      quantity:    1,
      currency_id: "ARS",
      unit_price:  amount,
    }],
    payer: { name: reviewerName || "Anónimo" },
    external_reference: review.id,
    notification_url: `${Deno.env.get("SUPABASE_URL")}/functions/v1/mp-webhook`,
    back_urls: {
      success: `${APP_URL}?payment=approved&review_id=${review.id}`,
      failure: `${APP_URL}?payment=failed&review_id=${review.id}`,
      pending: `${APP_URL}?payment=pending&review_id=${review.id}`,
    },
    auto_return: "approved",
    metadata: {
      review_id:   review.id,
      profile_id:  profile.id,
      profile_slug: profileSlug,
    },
  };

  const mpRes = await fetch("https://api.mercadopago.com/checkout/preferences", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${MP_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(mpBody),
  });

  if (!mpRes.ok) {
    const mpErr = await mpRes.text();
    console.error("MP error:", mpErr);
    return new Response(JSON.stringify({ error: "Error en MercadoPago", detail: mpErr }), {
      status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  const preference = await mpRes.json();

  // Guardar preferencia en base de datos
  await supabase.from("mp_preferences").insert({
    review_id:           review.id,
    preference_id:       preference.id,
    init_point:          preference.init_point,
    sandbox_init_point:  preference.sandbox_init_point,
    amount_cents:        amount * 100,
    status:              "created",
  });

  // Actualizar review con el preference_id
  await supabase.from("reviews").update({ mp_preference_id: preference.id }).eq("id", review.id);

  const mode = Deno.env.get("MP_MODE") || "sandbox";
  return new Response(JSON.stringify({
    preference_id:  preference.id,
    review_id:      review.id,
    init_point:     mode === "production" ? preference.init_point : preference.sandbox_init_point,
  }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
});

*/


// ─────────────────────────────────────────────────────────────
// FUNCIÓN 2: supabase/functions/mp-webhook/index.ts
// ─────────────────────────────────────────────────────────────
/*

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

serve(async (req) => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const MP_ACCESS_TOKEN = Deno.env.get("MP_ACCESS_TOKEN")!;

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch {}

  const topic    = body.type as string || new URL(req.url).searchParams.get("topic") || "";
  const mpId     = body.data?.id as string || new URL(req.url).searchParams.get("id") || "";

  // Registrar la notificación
  await supabase.from("mp_notifications").insert({
    mp_id:    mpId,
    topic,
    resource: mpId,
    raw_body: body,
    processed: false,
  });

  if (topic !== "payment" && topic !== "merchant_order") {
    return new Response("OK", { status: 200 });
  }

  // Consultar el pago en MP
  const payRes = await fetch(`https://api.mercadopago.com/v1/payments/${mpId}`, {
    headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` }
  });
  if (!payRes.ok) return new Response("Error consultando pago", { status: 502 });

  const payment = await payRes.json();
  const status  = payment.status as string;         // approved | rejected | pending...
  const reviewId = payment.external_reference as string;

  if (!reviewId) return new Response("Sin external_reference", { status: 200 });

  // Publicar la reseña si el pago fue aprobado
  await supabase.rpc("publish_review_on_payment", {
    p_mp_payment_id: String(mpId),
    p_status:        status,
  });

  // Actualizar el mp_payment_id en la reseña
  await supabase.from("reviews")
    .update({ mp_payment_id: String(mpId) })
    .eq("id", reviewId);

  // Marcar notificación como procesada
  await supabase.from("mp_notifications")
    .update({ processed: true })
    .eq("mp_id", mpId);

  return new Response("OK", { status: 200 });
});

*/


// ─────────────────────────────────────────────────────────────
// COMANDOS PARA DESPLEGAR
// ─────────────────────────────────────────────────────────────
/*

# 1. Instalar Supabase CLI
npm install -g supabase

# 2. Loguearse
supabase login

# 3. Vincular proyecto
supabase link --project-ref TU_PROJECT_REF

# 4. Configurar secrets (reemplazá con valores reales)
supabase secrets set MP_ACCESS_TOKEN="APP_USR-xxxxxxxxxxxx"
supabase secrets set MP_PUBLIC_KEY="APP_USR-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
supabase secrets set MP_MODE="production"
supabase secrets set APP_URL="https://aplauso.app"

# 5. Crear las funciones
mkdir -p supabase/functions/mp-create-preference
mkdir -p supabase/functions/mp-webhook

# 6. Copiar el código TypeScript de cada función a los archivos index.ts

# 7. Desplegar
supabase functions deploy mp-create-preference
supabase functions deploy mp-webhook

# 8. Verificar
supabase functions list

# ─────────────────────────────────────────────────────────────
# CONFIGURAR WEBHOOK EN MERCADOPAGO
# ─────────────────────────────────────────────────────────────
# Ir a: mercadopago.com.ar → Tu negocio → Configuración → Notificaciones
# URL del webhook:
#   https://TU_PROJECT_REF.supabase.co/functions/v1/mp-webhook
#
# Eventos a suscribir:
#   ✓ payment
#   ✓ merchant_order
# ─────────────────────────────────────────────────────────────

# ─────────────────────────────────────────────────────────────
# DESPLIEGUE DEL FRONTEND (opciones)
# ─────────────────────────────────────────────────────────────

# OPCIÓN A: Vercel (recomendada)
# 1. Crear cuenta en vercel.com
# 2. Subir aplauso_full_prod.html a un repositorio GitHub
# 3. Conectar el repo en Vercel
# 4. Variables de entorno: no necesarias (el HTML es estático)

# OPCIÓN B: Netlify
# 1. Crear cuenta en netlify.com
# 2. Arrastrar la carpeta en netlify.com/drop

# OPCIÓN C: GitHub Pages
# 1. Crear repo, subir index.html (renombrar aplauso_full_prod.html → index.html)
# 2. Settings → Pages → Deploy from main branch

# OPCIÓN D: Servidor propio (nginx)
# Copiar el archivo a /var/www/html/index.html y configurar nginx

*/
