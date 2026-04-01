import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function cleanText(value: string, fallback = "") {
  return (value || "").replace(/\s+/g, " ").trim() || fallback;
}

serve(async (req) => {
  try {
    const url = new URL(req.url);
    const profileId = cleanText(url.searchParams.get("profile_id") || url.searchParams.get("id") || "");
    const profileSlug = cleanText(url.searchParams.get("slug") || "");
    const appUrl = cleanText(Deno.env.get("APP_URL") || "", "https://recomendapp.netlify.app");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

    if (!profileId && !profileSlug) {
      return new Response("Falta profile_id o slug", { status: 400 });
    }

    const baseQuery = supabase
      .from("profiles")
      .select("id, slug, nombre, apellido, role, city, bio, review_count, total_earned, avatar_url, cover_url, active");

    const profileResponse = profileId
      ? await baseQuery.eq("id", profileId).maybeSingle()
      : await baseQuery.eq("slug", profileSlug).maybeSingle();

    const profile = profileResponse.data;
    if (profileResponse.error || !profile || profile.active === false) {
      return new Response("Perfil no encontrado", { status: 404 });
    }

    const { data: topReview } = await supabase
      .from("reviews")
      .select("amount_cents")
      .eq("profile_id", profile.id)
      .eq("published", true)
      .eq("payment_status", "approved")
      .order("amount_cents", { ascending: false })
      .limit(1)
      .maybeSingle();

    const displayName = cleanText([profile.nombre, profile.apellido].filter(Boolean).join(" "), "Perfil");
    const role = cleanText(profile.role || "", "Profesional");
    const city = cleanText(profile.city || "", "Argentina");
    const bio = cleanText(profile.bio || "");
    const totalReviews = Number(profile.review_count || 0);
    const highestReward = Math.round(Number(topReview?.amount_cents || 0) / 100);
    const totalEarned = Math.round(Number(profile.total_earned || 0) / 100);
    const appProfileUrl = `${appUrl}?slug=${encodeURIComponent(profile.id || profile.slug)}`;
    const shareImage = cleanText(profile.cover_url || profile.avatar_url || "");
    const title = `${displayName} | ${role} | Recomendapp - Reconoce quien te atendio bien`;
    const description = bio
      ? `${bio} Especialidad: ${role}. Recomendaciones visibles y reconocimiento real en Recomendapp.`
      : totalReviews
        ? `${displayName}, ${role} en ${city}. Mira ${totalReviews} recomendaciones visibles${highestReward ? ` y reconocimientos de hasta $${highestReward.toLocaleString("es-AR")}` : ""} en Recomendapp.`
        : `${displayName}, ${role} en ${city}. Conoce su perfil profesional y deja una recomendacion con reconocimiento real en Recomendapp.`;

    const imageTags = shareImage
      ? `
    <meta property="og:image" content="${escapeHtml(shareImage)}" />
    <meta property="og:image:secure_url" content="${escapeHtml(shareImage)}" />
    <meta property="og:image:alt" content="${escapeHtml(`Portada de ${displayName} en Recomendapp`)}" />
    <meta name="twitter:image" content="${escapeHtml(shareImage)}" />
`
      : "";

    const statsLine = totalReviews || totalEarned || highestReward
      ? `<p>${totalReviews ? `${totalReviews} recomendaciones visibles` : "Perfil activo"}${totalEarned ? ` | $${totalEarned.toLocaleString("es-AR")} reconocidos` : ""}${highestReward ? ` | hasta $${highestReward.toLocaleString("es-AR")} por recomendacion` : ""}</p>`
      : "<p>Perfil compartido desde Recomendapp.</p>";

    const html = `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <meta name="robots" content="index,follow,max-image-preview:large" />
    <meta name="theme-color" content="#0f172a" />
    <link rel="canonical" href="${escapeHtml(appProfileUrl)}" />
    <meta property="og:locale" content="es_AR" />
    <meta property="og:site_name" content="Recomendapp" />
    <meta property="og:type" content="website" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:url" content="${escapeHtml(appProfileUrl)}" />
${imageTags}    <meta name="twitter:card" content="${shareImage ? "summary_large_image" : "summary"}" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    <meta http-equiv="refresh" content="0; url=${escapeHtml(appProfileUrl)}" />
    <script>window.location.replace(${JSON.stringify(appProfileUrl)});</script>
    <style>
      body{margin:0;font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;background:#0f172a;color:#e5eefc;display:grid;place-items:center;min-height:100vh;padding:24px}
      main{max-width:640px;background:rgba(15,23,42,.82);border:1px solid rgba(148,163,184,.2);border-radius:24px;padding:28px;box-shadow:0 24px 80px rgba(2,6,23,.35);backdrop-filter:blur(10px)}
      h1{margin:0 0 10px;font-size:clamp(28px,4vw,42px);line-height:1.05}
      p{margin:0 0 12px;color:#cbd5e1;line-height:1.55}
      a{display:inline-flex;align-items:center;justify-content:center;margin-top:10px;padding:12px 18px;border-radius:999px;background:linear-gradient(135deg,#22c55e,#16a34a);color:#04130a;text-decoration:none;font-weight:700}
    </style>
  </head>
  <body>
    <main>
      <h1>${escapeHtml(displayName)}</h1>
      <p>${escapeHtml(role)}${city ? ` | ${escapeHtml(city)}` : ""}</p>
      <p>${escapeHtml(description)}</p>
      ${statsLine}
      <a href="${escapeHtml(appProfileUrl)}">Abrir perfil</a>
    </main>
  </body>
</html>`;

    return new Response(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "public, max-age=60, s-maxage=300",
      },
    });
  } catch (error) {
    return new Response(error instanceof Error ? error.message : "Error inesperado", { status: 500 });
  }
});
