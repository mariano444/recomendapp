import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const securityHeaders = {
  "Content-Security-Policy": [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "img-src 'self' data: blob: https:",
    "script-src 'self' https://sdk.mercadopago.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "connect-src 'self' https://*.supabase.co https://api.mercadopago.com https://sdk.mercadopago.com",
    "frame-src https://sdk.mercadopago.com https://www.mercadopago.com https://www.mercadopago.com.ar",
    "frame-ancestors *",
  ].join("; "),
  "Referrer-Policy": "strict-origin-when-cross-origin",
};

type ProfileRow = {
  id: string;
  slug: string;
  nombre: string | null;
  apellido: string | null;
  rol: string | null;
  ciudad: string | null;
  bio: string | null;
  avatar_url: string | null;
  cover_url: string | null;
  share_title: string | null;
  share_subtitle: string | null;
  share_description: string | null;
  share_image_mode: string | null;
};

type RewardRow = {
  id: string;
  title: string | null;
  description: string | null;
  image_url: string | null;
};

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function compactText(value: string, max = 220) {
  const cleaned = value.replace(/\s+/g, " ").trim();
  return cleaned.length > max ? `${cleaned.slice(0, Math.max(0, max - 1)).trim()}…` : cleaned;
}

function getDisplayName(profile: ProfileRow) {
  const fullName = `${profile.nombre || ""} ${profile.apellido || ""}`.replace(/\s+/g, " ").trim();
  return fullName || "Perfil en Recomendapp";
}

function getProfileShareImage(profile: ProfileRow) {
  const mode = String(profile.share_image_mode || "").trim() || "cover";
  if (mode === "none") return "";
  if (mode === "avatar") return profile.avatar_url || profile.cover_url || "";
  return profile.cover_url || profile.avatar_url || "";
}

function buildMeta(profile: ProfileRow, reward: RewardRow | null, shareUrl: string) {
  const displayName = getDisplayName(profile);
  const role = String(profile.rol || "profesional").trim();
  const city = String(profile.ciudad || "Argentina").trim();
  const baseTitle = String(profile.share_title || "").trim() || displayName;
  const subtitle = String(profile.share_subtitle || "").trim();
  const fallbackDescription = String(profile.share_description || "").trim() ||
    String(profile.bio || "").trim() ||
    `${displayName}, ${role} en ${city}. Descubri su perfil y deja una reseña con reconocimiento real en Recomendapp.`;

  if (reward) {
    const rewardTitle = String(reward.title || "Promo especial").trim();
    const rewardDescription = compactText(
      String(reward.description || "").trim() ||
      `Deja tu reseña para ${displayName} y accede a esta promo especial en Recomendapp.`,
    );
    return {
      title: `${rewardTitle} | ${displayName} | Recomendapp`,
      description: rewardDescription,
      image: reward.image_url || getProfileShareImage(profile),
      url: shareUrl,
    };
  }

  return {
    title: subtitle ? `${baseTitle} | ${subtitle} | Recomendapp` : `${baseTitle} | Recomendapp`,
    description: compactText(fallbackDescription),
    image: getProfileShareImage(profile),
    url: shareUrl,
  };
}

function buildHtml(meta: { title: string; description: string; image: string; url: string }) {
  const title = escapeHtml(meta.title);
  const description = escapeHtml(meta.description);
  const image = escapeHtml(meta.image);
  const url = escapeHtml(meta.url);
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<meta name="description" content="${description}">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">
<meta property="og:type" content="website">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${image}">
<meta name="twitter:card" content="${image ? "summary_large_image" : "summary"}">
<meta name="twitter:title" content="${title}">
<meta name="twitter:description" content="${description}">
<meta name="twitter:image" content="${image}">
<link rel="canonical" href="${url}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;0,900;1,400;1,700&family=Instrument+Sans:ital,wght@0,300;0,400;0,500;0,600;0,700;1,400&display=swap" rel="stylesheet">
<script src="https://sdk.mercadopago.com/js/v2"></script>
<link rel="stylesheet" href="/styles.css">
</head>
<body>

<nav class="topnav" id="topnav">
  <div class="logo" data-nav-target="home" role="button" tabindex="0" aria-label="Ir al inicio">
    <div class="logo-gem"></div>
    Recomendapp
  </div>
  <div class="nav-right" id="navRight"></div>
</nav>

<div class="toast-container" id="toastContainer"></div>

<div class="modal-overlay" id="replyModal">
  <div class="modal">
    <h3>Responder reseña</h3>
    <p class="modal-sub">Tu respuesta será visible públicamente en el perfil</p>
    <div id="modalRevPreview" class="modal-rev-preview"></div>
    <div class="field">
      <label class="field-label">Tu respuesta</label>
      <textarea class="field-textarea" id="replyText" placeholder="Escribí tu respuesta..."></textarea>
    </div>
    <div class="modal-actions">
      <button class="btn btn-ghost btn-md" data-action="close-reply-modal">Cancelar</button>
      <button class="btn btn-amber btn-md" data-action="submit-reply">Publicar respuesta</button>
    </div>
  </div>
</div>

<div class="modal-overlay" id="mpConfigModal">
  <div class="modal">
    <h3>Configurar MercadoPago</h3>
    <p class="modal-sub">Ingresá tus credenciales para activar los pagos reales en tu perfil.</p>
    <div class="mp-info-box">
      <span class="icon">Info</span>
      <div>Encontrá tus credenciales en <strong>mercadopago.com.ar</strong> -> Tu cuenta -> Credenciales. Usá las credenciales de <strong>Producción</strong> para pagos reales.</div>
    </div>
    <div class="field">
      <label class="field-label">Public Key</label>
      <input class="field-input" id="mpPublicKeyInput" placeholder="APP_USR-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" type="text">
      <div class="field-hint">Empieza con APP_USR- y es visible en el frontend</div>
    </div>
    <div class="field">
      <label class="field-label">Access Token</label>
      <div class="field-pw-wrap">
        <input class="field-input" id="mpAccessTokenInput" placeholder="APP_USR-xxxxxxxxxxxx" type="password">
        <button class="pw-toggle" data-action="toggle-password" data-target-input="mpAccessTokenInput">Ver</button>
      </div>
      <div class="field-hint">Secreto. Nunca exponerlo en el frontend</div>
    </div>
    <div class="field">
      <label class="field-label">Modo</label>
      <select class="field-select field-input" id="mpModeSelect">
        <option value="sandbox">Sandbox (pruebas)</option>
        <option value="production">Producción (pagos reales)</option>
      </select>
    </div>
    <div class="modal-actions">
      <button class="btn btn-ghost btn-md" data-action="close-mp-modal">Cancelar</button>
      <button class="btn btn-amber btn-md" data-action="save-mp-config">Guardar y activar</button>
    </div>
  </div>
</div>

<div class="modal-overlay" id="imageLightbox">
  <div class="modal modal-image">
    <button class="lightbox-close" data-action="close-image-lightbox">Cerrar</button>
    <div class="lightbox-stage">
      <img id="lightboxImage" alt="Imagen ampliada">
    </div>
  </div>
</div>

<main id="views-root"></main>

<script src="/app.js"></script>
</body>
</html>`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const appUrlFromEnv = Deno.env.get("APP_URL") || "https://recomendapp.netlify.app";
    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

    const reqUrl = new URL(req.url);
    const profileId = reqUrl.searchParams.get("profile_id") || "";
    const requestedView = reqUrl.searchParams.get("view") === "form" ? "form" : "profile";
    const rewardParam = reqUrl.searchParams.get("reward");
    const rewardId = rewardParam && rewardParam !== "none" ? rewardParam : "";

    const fallbackHtml = buildHtml({
      title: "Recomendapp - Reconoce quien te atendio bien",
      description: "Descubri perfiles con recomendaciones visibles, reseñas reales y reconocimiento economico en Recomendapp.",
      image: "",
      url: appUrlFromEnv,
    });

    if (!profileId) {
      return new Response(fallbackHtml, {
        headers: { ...corsHeaders, ...securityHeaders, "Content-Type": "text/html; charset=utf-8" },
      });
    }

    const profileQuery = supabase
      .from("profiles")
      .select("id, slug, nombre, apellido, rol, ciudad, bio, avatar_url, cover_url, share_title, share_subtitle, share_description, share_image_mode");
    const { data: profile, error: profileError } = /^[0-9a-f-]{36}$/i.test(profileId)
      ? await profileQuery.eq("id", profileId).maybeSingle<ProfileRow>()
      : await profileQuery.eq("slug", profileId).maybeSingle<ProfileRow>();

    if (profileError || !profile) {
      return new Response(buildHtml({
        title: "Perfil no encontrado | Recomendapp",
        description: "No pudimos encontrar el perfil compartido.",
        image: "",
        url: appUrlFromEnv,
      }), {
        status: 404,
        headers: { ...corsHeaders, ...securityHeaders, "Content-Type": "text/html; charset=utf-8" },
      });
    }

    let reward: RewardRow | null = null;
    if (requestedView === "form" && rewardId) {
      const { data } = await supabase
        .from("profile_reward_items")
        .select("id, title, description, image_url")
        .eq("profile_id", profile.id)
        .eq("id", rewardId)
        .eq("active", true)
        .maybeSingle<RewardRow>();
      reward = data || null;
    }

    const publicBase = appUrlFromEnv.replace(/\/+$/, "");
    const shareUrl = new URL(`${publicBase}/share/${encodeURIComponent(profile.slug || profile.id)}`);
    if (requestedView === "form") shareUrl.searchParams.set("view", "form");
    if (rewardParam === "none") shareUrl.searchParams.set("reward", "none");
    else if (reward?.id) shareUrl.searchParams.set("reward", reward.id);

    const meta = buildMeta(profile, reward, shareUrl.toString());
    return new Response(buildHtml(meta), {
      headers: { ...corsHeaders, ...securityHeaders, "Content-Type": "text/html; charset=utf-8" },
    });
  } catch (error) {
    console.error("share-profile error", error);
    return new Response("Error interno", {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "text/plain; charset=utf-8" },
    });
  }
});
