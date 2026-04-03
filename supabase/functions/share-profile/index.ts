import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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

type ShareStats = {
  totalReviews: number;
  topRewardAmount: number;
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

async function fetchRest<T>(supabaseUrl: string, apiKey: string, table: string, params: Record<string, string>) {
  const url = new URL(`${supabaseUrl}/rest/v1/${table}`);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  const response = await fetch(url.toString(), {
    headers: {
      apikey: apiKey,
      Authorization: `Bearer ${apiKey}`,
    },
  });
  if (!response.ok) {
    return { data: null as T | null, error: await response.text() };
  }
  return { data: await response.json() as T, error: null };
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

function buildMeta(profile: ProfileRow, reward: RewardRow | null, stats: ShareStats, shareUrl: string, requestedView: "profile" | "form") {
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
      title: `${rewardTitle} | Promo por dejar tu reseña a ${displayName} | Recomendapp`,
      description: compactText(
        `${rewardDescription} ${stats.totalReviews ? `${stats.totalReviews} reseñas reales ya publicadas.` : "Compartilo y converti una buena experiencia en una reseña visible."}`,
      ),
      image: reward.image_url || getProfileShareImage(profile),
      url: shareUrl,
      imageAlt: `${rewardTitle} en Recomendapp`,
    };
  }

  if (requestedView === "form") {
    return {
      title: `Deja tu reseña para ${displayName} | Recomendapp`,
      description: compactText(
        `${stats.totalReviews ? `${stats.totalReviews} reseñas reales ya publicadas. ` : ""}Completa el formulario y deja una reseña con reconocimiento visible para ${displayName} en Recomendapp.`,
      ),
      image: getProfileShareImage(profile),
      url: shareUrl,
      imageAlt: `Formulario de reseña para ${displayName} en Recomendapp`,
    };
  }

  return {
    title: subtitle ? `${baseTitle} | ${subtitle} | Recomendapp` : `${baseTitle} | Recomendapp`,
    description: compactText(
      stats.totalReviews
        ? `${fallbackDescription} ${stats.totalReviews} reseñas publicadas y reconocimientos de hasta $${stats.topRewardAmount.toLocaleString("es-AR")} visibles en su perfil.`
        : fallbackDescription,
    ),
    image: getProfileShareImage(profile),
    url: shareUrl,
    imageAlt: `${displayName} en Recomendapp`,
  };
}

function buildHtml(meta: { title: string; description: string; image: string; url: string; imageAlt?: string }) {
  const title = escapeHtml(meta.title);
  const description = escapeHtml(meta.description);
  const image = escapeHtml(meta.image);
  const imageAlt = escapeHtml(meta.imageAlt || meta.title);
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
<meta property="og:site_name" content="Recomendapp">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${image}">
<meta property="og:image:alt" content="${imageAlt}">
<meta name="twitter:card" content="${image ? "summary_large_image" : "summary"}">
<meta name="twitter:title" content="${title}">
<meta name="twitter:description" content="${description}">
<meta name="twitter:image" content="${image}">
<meta name="twitter:image:alt" content="${imageAlt}">
<meta name="theme-color" content="#6E97D8">
<link rel="canonical" href="${url}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;0,900;1,400;1,700&family=Instrument+Sans:ital,wght@0,300;0,400;0,500;0,600;0,700;1,400&display=swap" rel="stylesheet">
<script src="https://sdk.mercadopago.com/js/v2"></script>
<link rel="stylesheet" href="/styles.css">
</head>
<body>

<nav class="topnav" id="topnav">
  <div class="logo" onclick="nav('home')">
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
    <div id="modalRevPreview" style="background:var(--surface);border-radius:var(--radius);padding:14px 18px;margin-bottom:18px;font-size:13px;color:var(--text2);line-height:1.6;font-style:italic;"></div>
    <div class="field">
      <label class="field-label">Tu respuesta</label>
      <textarea class="field-textarea" id="replyText" placeholder="Escribí tu respuesta..."></textarea>
    </div>
    <div class="modal-actions">
      <button class="btn btn-ghost btn-md" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-amber btn-md" onclick="submitReply()">Publicar respuesta</button>
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
        <button class="pw-toggle" onclick="togglePw('mpAccessTokenInput',this)">Ver</button>
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
      <button class="btn btn-ghost btn-md" onclick="closeMpModal()">Cancelar</button>
      <button class="btn btn-amber btn-md" onclick="saveMpConfig()">Guardar y activar</button>
    </div>
  </div>
</div>

<div class="modal-overlay" id="imageLightbox">
  <div class="modal modal-image">
    <button class="lightbox-close" onclick="closeImageLightbox()">Cerrar</button>
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
    const supabasePublicKey = Deno.env.get("SUPABASE_ANON_KEY") ||
      Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ||
      "sb_publishable_McWl7xNoHVDbUdaR51OFew_TdJTJw30";
    const appUrlFromEnv = Deno.env.get("APP_URL") || "https://recomendapp.netlify.app";

    const reqUrl = new URL(req.url);
    const profileId = reqUrl.searchParams.get("profile_id") || "";
    const requestedView = reqUrl.searchParams.get("view") === "form" ? "form" : "profile";
    const rewardParam = reqUrl.searchParams.get("reward");
    const rewardId = rewardParam && rewardParam !== "none" ? rewardParam : "";
    const debugMode = reqUrl.searchParams.get("debug") === "1";

    const fallbackHtml = buildHtml({
      title: "Recomendapp - Reconoce quien te atendio bien",
      description: "Descubri perfiles con recomendaciones visibles, reseñas reales y reconocimiento economico en Recomendapp.",
      image: "",
      url: appUrlFromEnv,
    });

    if (!profileId) {
      return new Response(fallbackHtml, {
        headers: { ...corsHeaders, "Content-Type": "text/html; charset=utf-8" },
      });
    }

    const fullProfileSelect = "id,slug,nombre,apellido,rol,ciudad,bio,avatar_url,cover_url,share_title,share_subtitle,share_description,share_image_mode";
    const legacyProfileSelect = "id,slug,nombre,apellido,rol,ciudad,bio,avatar_url,cover_url";
    const profileFilterColumn = /^[0-9a-f-]{36}$/i.test(profileId) ? "id" : "slug";
    let { data: profileRows, error: profileError } = await fetchRest<ProfileRow[]>(
      supabaseUrl,
      supabasePublicKey,
      "profiles",
      {
        select: fullProfileSelect,
        [profileFilterColumn]: `eq.${profileId}`,
        limit: "1",
      },
    );
    if (profileError && /share_title|share_subtitle|share_description|share_image_mode/i.test(profileError)) {
      const fallback = await fetchRest<ProfileRow[]>(
        supabaseUrl,
        supabasePublicKey,
        "profiles",
        {
          select: legacyProfileSelect,
          [profileFilterColumn]: `eq.${profileId}`,
          limit: "1",
        },
      );
      profileRows = fallback.data;
      profileError = fallback.error;
    }
    const profile = profileRows?.[0] || null;

    if (debugMode) {
      return new Response(JSON.stringify({
        profileId,
        profileFilterColumn,
        profileError,
        profileRows,
      }, null, 2), {
        headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
      });
    }

    if (profileError || !profile) {
      return new Response(buildHtml({
        title: "Perfil no encontrado | Recomendapp",
        description: "No pudimos encontrar el perfil compartido.",
        image: "",
        url: appUrlFromEnv,
      }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "text/html; charset=utf-8" },
      });
    }

    let reward: RewardRow | null = null;
    if (requestedView === "form" && rewardId) {
      const rewardResponse = await fetchRest<RewardRow[]>(
        supabaseUrl,
        supabasePublicKey,
        "profile_reward_items",
        {
          select: "id,title,description,image_url",
          profile_id: `eq.${profile.id}`,
          id: `eq.${rewardId}`,
          active: "eq.true",
          limit: "1",
        },
      );
      reward = rewardResponse.data?.[0] || null;
    }

    const [reviewsResponse, topRewardResponse] = await Promise.all([
      fetchRest<Array<{ id: string }>>(
        supabaseUrl,
        supabasePublicKey,
        "reviews",
        {
          select: "id",
          profile_id: `eq.${profile.id}`,
          published: "eq.true",
          payment_status: "eq.approved",
        },
      ),
      fetchRest<Array<{ amount_cents: number | null }>>(
        supabaseUrl,
        supabasePublicKey,
        "reviews",
        {
          select: "amount_cents",
          profile_id: `eq.${profile.id}`,
          published: "eq.true",
          payment_status: "eq.approved",
          order: "amount_cents.desc",
          limit: "1",
        },
      ),
    ]);
    const stats: ShareStats = {
      totalReviews: reviewsResponse.data?.length || 0,
      topRewardAmount: Math.round((topRewardResponse.data?.[0]?.amount_cents || 0) / 100),
    };

    const publicBase = appUrlFromEnv.replace(/\/+$/, "");
    const shareUrl = new URL(`${publicBase}/share/${encodeURIComponent(profile.slug || profile.id)}`);
    if (requestedView === "form") shareUrl.searchParams.set("view", "form");
    if (rewardParam === "none") shareUrl.searchParams.set("reward", "none");
    else if (reward?.id) shareUrl.searchParams.set("reward", reward.id);

    const meta = buildMeta(profile, reward, stats, shareUrl.toString(), requestedView);
    return new Response(buildHtml(meta), {
      headers: { ...corsHeaders, "Content-Type": "text/html; charset=utf-8" },
    });
  } catch (error) {
    console.error("share-profile error", error);
    return new Response("Error interno", {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "text/plain; charset=utf-8" },
    });
  }
});
