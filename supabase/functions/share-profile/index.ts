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

function getShareImage(profile: Record<string, unknown>) {
  const mode = cleanText(String(profile.share_image_mode || ""), "cover");
  const coverUrl = cleanText(String(profile.cover_url || ""));
  const avatarUrl = cleanText(String(profile.avatar_url || ""));
  if (mode === "none") return "";
  if (mode === "avatar") return avatarUrl || coverUrl;
  return coverUrl || avatarUrl;
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
      .select("*");

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
    const shareTitle = cleanText(profile.share_title || "", displayName);
    const shareSubtitle = cleanText(profile.share_subtitle || "", [role, city].filter(Boolean).join(" | "));
    const shareDescription = cleanText(profile.share_description || "");
    const totalReviews = Number(profile.review_count || 0);
    const highestReward = Math.round(Number(topReview?.amount_cents || 0) / 100);
    const totalEarned = Math.round(Number(profile.total_earned || 0) / 100);
    const profileIdentifier = cleanText(profile.id || profile.slug || "");
    const appProfileUrl = `${appUrl}?slug=${encodeURIComponent(profileIdentifier)}`;
    const sharePageUrl = req.url;
    const shareImage = getShareImage(profile);
    const title = shareSubtitle
      ? `${shareTitle} | ${shareSubtitle} | Recomendapp - Reconoce quien te atendio bien`
      : `${shareTitle} | Recomendapp - Reconoce quien te atendio bien`;
    const description = shareDescription || (bio
      ? `${bio} Especialidad: ${role}. Recomendaciones visibles y reconocimiento real en Recomendapp.`
      : totalReviews
        ? `${displayName}, ${role} en ${city}. Mira ${totalReviews} recomendaciones visibles${highestReward ? ` y reconocimientos de hasta $${highestReward.toLocaleString("es-AR")}` : ""} en Recomendapp.`
        : `${displayName}, ${role} en ${city}. Conoce su perfil profesional y deja una recomendacion con reconocimiento real en Recomendapp.`);

    const imageTags = shareImage
      ? `
    <meta property="og:image" content="${escapeHtml(shareImage)}" />
    <meta property="og:image:secure_url" content="${escapeHtml(shareImage)}" />
    <meta property="og:image:alt" content="${escapeHtml(`Portada de ${displayName} en Recomendapp`)}" />
    <meta name="twitter:image" content="${escapeHtml(shareImage)}" />
`
      : "";
    const coverStyle = shareImage
      ? ` style="background-image:url('${escapeHtml(shareImage)}');background-position:center;background-size:cover;background-repeat:no-repeat"`
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
    <meta property="og:url" content="${escapeHtml(sharePageUrl)}" />
${imageTags}    <meta name="twitter:card" content="${shareImage ? "summary_large_image" : "summary"}" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    <style>
      :root{color-scheme:dark}
      *{box-sizing:border-box}
      body{margin:0;font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;background:radial-gradient(circle at top,#1e293b 0,#0f172a 55%,#020617 100%);color:#e5eefc;min-height:100vh}
      .wrap{max-width:980px;margin:0 auto;padding:24px}
      .card{overflow:hidden;border:1px solid rgba(148,163,184,.18);border-radius:28px;background:rgba(15,23,42,.86);box-shadow:0 24px 80px rgba(2,6,23,.35);backdrop-filter:blur(10px)}
      .hero{position:relative;padding:32px}
      .cover{height:220px;border-radius:20px;background:linear-gradient(135deg,#0ea5e9,#22c55e)}
      .content{padding:0 32px 32px}
      .badge{display:inline-flex;align-items:center;gap:8px;padding:8px 12px;border-radius:999px;background:rgba(34,197,94,.14);color:#86efac;font-size:12px;font-weight:700;letter-spacing:.02em;text-transform:uppercase}
      h1{margin:18px 0 10px;font-size:clamp(30px,5vw,52px);line-height:1.02}
      .sub{margin:0 0 18px;color:#cbd5e1;font-size:18px}
      p{margin:0 0 14px;color:#cbd5e1;line-height:1.6}
      .stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin:24px 0}
      .stat{padding:16px 18px;border-radius:18px;background:rgba(15,23,42,.72);border:1px solid rgba(148,163,184,.14)}
      .stat strong{display:block;font-size:24px;color:#fff}
      .stat span{display:block;margin-top:6px;color:#94a3b8;font-size:13px}
      .actions{display:flex;flex-wrap:wrap;gap:12px;margin-top:16px}
      a{display:inline-flex;align-items:center;justify-content:center;padding:13px 18px;border-radius:999px;text-decoration:none;font-weight:700}
      .primary{background:linear-gradient(135deg,#22c55e,#16a34a);color:#04130a}
      .secondary{background:rgba(148,163,184,.1);border:1px solid rgba(148,163,184,.2);color:#e5eefc}
      @media (max-width: 640px){.wrap{padding:16px}.hero,.content{padding:20px}.cover{height:160px}}
    </style>
  </head>
  <body>
    <div class="wrap">
      <main class="card">
        <section class="hero">
          <div class="cover"${coverStyle}></div>
        </section>
        <section class="content">
          <span class="badge">Perfil publico</span>
          <h1>${escapeHtml(displayName)}</h1>
          <p class="sub">${escapeHtml(role)}${city ? ` | ${escapeHtml(city)}` : ""}</p>
          <p>${escapeHtml(description)}</p>
          <div class="stats">
            <div class="stat"><strong>${totalReviews || 0}</strong><span>Recomendaciones visibles</span></div>
            <div class="stat"><strong>${totalEarned ? `$${totalEarned.toLocaleString("es-AR")}` : "$0"}</strong><span>Reconocimiento acumulado</span></div>
            <div class="stat"><strong>${highestReward ? `$${highestReward.toLocaleString("es-AR")}` : "$0"}</strong><span>Mayor recompensa publicada</span></div>
          </div>
          ${statsLine}
          <div class="actions">
            <a class="primary" href="${escapeHtml(appProfileUrl)}">Abrir perfil completo</a>
            <a class="secondary" href="${escapeHtml(appProfileUrl)}">Dejar una recomendacion</a>
          </div>
        </section>
      </main>
    </div>
  </body>
</html>`;

    return new Response(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "public, max-age=300, s-maxage=900",
      },
    });
  } catch (error) {
    return new Response(error instanceof Error ? error.message : "Error inesperado", { status: 500 });
  }
});
