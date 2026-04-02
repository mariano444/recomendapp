# Aplauso Prod

Proyecto preparado para usar Supabase en producción con este frontend estático:

- URL: `https://avwqmeberbjadrrlvaaa.supabase.co`
- Publishable key: `sb_publishable_McWl7xNoHVDbUdaR51OFew_TdJTJw30`

## Archivos

- `index.html`: frontend listo para desplegar como sitio estático
- `schema.sql`: esquema SQL para Supabase
- `supabase/functions/mp-create-preference/index.ts`: crea preferencias de MercadoPago
- `supabase/functions/mp-confirm-return/index.ts`: confirma pagos de reseñas al volver de MercadoPago
- `supabase/functions/mp-create-media-unlock/index.ts`: crea pagos para desbloquear contenido privado
- `supabase/functions/mp-confirm-media-return/index.ts`: confirma desbloqueos al volver de MercadoPago
- `supabase/functions/mp-webhook/index.ts`: procesa webhooks de MercadoPago
- `supabase/functions/galiopay-create-payment-link/index.ts`: crea payment links de GalioPay
- `supabase/functions/galiopay-confirm-return/index.ts`: confirma pagos de reseÃ±as al volver de GalioPay
- `supabase/functions/galiopay-webhook/index.ts`: procesa webhooks de GalioPay
- `supabase/galiopay-migration.sql`: migraciÃ³n incremental para sumar GalioPay sobre una base ya creada

## Qué falta para dejarlo online real

1. Ejecutar `schema.sql` en Supabase SQL Editor.
2. Configurar secrets en Supabase:
   - `MP_ACCESS_TOKEN`
   - `MP_MODE=production`
   - `GALIOPAY_CLIENT_ID`
   - `GALIOPAY_API_KEY`
   - `GALIOPAY_MODE=production`
   - `APP_URL`
3. Desplegar las funciones:
   - `supabase functions deploy mp-create-preference`
   - `supabase functions deploy mp-confirm-return`
   - `supabase functions deploy mp-create-media-unlock`
   - `supabase functions deploy mp-confirm-media-return`
   - `supabase functions deploy mp-webhook`
   - `supabase functions deploy galiopay-create-payment-link`
   - `supabase functions deploy galiopay-confirm-return`
   - `supabase functions deploy galiopay-webhook`
4. Publicar `index.html` en tu hosting estático.
5. En MercadoPago, configurar el webhook apuntando a:
   - `https://avwqmeberbjadrrlvaaa.supabase.co/functions/v1/mp-webhook`
6. En GalioPay, configurar el webhook apuntando a:
   - `https://avwqmeberbjadrrlvaaa.supabase.co/functions/v1/galiopay-webhook`

## Foto de perfil y portada

Para guardar imágenes necesitás crear un bucket público llamado `profile-media` en Supabase Storage y agregar la columna `cover_url` si tu tabla ya existe:

```sql
alter table public.profiles add column if not exists cover_url text;
```

Bucket sugerido:

- nombre: `profile-media`
- público: sí

## Si no deja crear o ingresar

Revisá estas 3 cosas en este orden:

1. Que hayas ejecutado completo `schema.sql` en el SQL Editor de Supabase.
2. En `Authentication > Providers > Email`, desactivar `Confirm email` si querés entrar apenas te registrás.
3. En `Authentication > URL Configuration`, cargar la URL real donde vas a publicar `index.html` en `Site URL` y `Redirect URLs`.

## Importante

Sin credenciales de producción de MercadoPago y sin acceso al proyecto Supabase para ejecutar SQL/deploy, el flujo de cobro real no puede quedar operativo desde este entorno local.
