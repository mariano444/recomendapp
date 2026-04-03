import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

function buildAppViewUrl(appBase: string, profile: ProfileRow, reward: RewardRow | null, requestedView: string) {
  const appUrl = new URL(appBase);
  appUrl.searchParams.set("slug", profile.slug || profile.id);
  if (requestedView === "form") {
    appUrl.searchParams.set("view", "form");
    if (reward?.id) appUrl.searchParams.set("reward", reward.id);
  }
  return appUrl.toString();
}

function buildHtml(meta: { title: string; description: string; image: string; url: string }, appViewUrl: string) {
  const title = escapeHtml(meta.title);
  const description = escapeHtml(meta.description);
  const image = escapeHtml(meta.image);
  const url = escapeHtml(meta.url);
  const appUrl = escapeHtml(appViewUrl);
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
<meta http-equiv="refresh" content="0; url=${appUrl}">
</head>
<body>
<main>
  <h1>${title}</h1>
  <p>${description}</p>
  <p><a href="${appUrl}">Abrir perfil en Recomendapp</a></p>
</main>
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
    }, appUrlFromEnv);

    if (!profileId) {
      return new Response(fallbackHtml, {
        headers: { ...corsHeaders, "Content-Type": "text/html; charset=utf-8" },
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
        }, appUrlFromEnv), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "text/html; charset=utf-8" },
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
    const appViewUrl = buildAppViewUrl(publicBase, profile, reward, requestedView);
    return new Response(buildHtml(meta, appViewUrl), {
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
