# Infraestructura de Soci (sin secretos)

Actualizado: 2026-09-03. Los secretos viven en Coolify (variables de la app) y nunca en este repo.

## Coolify
- Panel: `http://2.25.152.115:8000/` · servidor `localhost` (7.8 GB RAM, 2 vCPU, disco 96 GB) · API habilitada.
- Proyecto **Soci**: `project/z6y6xfbinopynygampj8y5cu/environment/j5nuvci1uuolaza37r4bt2s2`.
- Postgres `soci-postgres` · uuid `jilewvv0jz6ofaaxb8grpytn` · imagen `pgvector/pgvector:pg16` · bases `soci` (prod) y `soci_staging`.
- App **soci** (producción) · uuid `lggsp991scbhy7gstufmnk2w` · rama `main` · `https://soci.vibedigital.agency` · volumen `soci-media` → `/data/media` · healthcheck de Coolify desactivado (la imagen no trae curl; el Dockerfile trae el suyo).
- App **soci-staging** · uuid `gfage7bfpteik9o8c5kfh13p` · rama de fase (`phase/N`) · `https://soci-staging.vibedigital.agency` · volumen `soci-staging-media` → `/data/media`.
- Deploy por API: `POST /api/v1/deploy?uuid=<uuid>` con `Authorization: Bearer $COOLIFY_TOKEN` (ver `scripts/deploy.sh`, T0.5).

## DNS (Cloudflare, zona vibedigital.agency)
- `soci` y `soci-staging` → `A 2.25.152.115`, DNS only (sin proxy, para que Let's Encrypt emita el certificado).

## Meta / WhatsApp
- App **Soci by Vibe Digital** · id `28744326765153100` · portfolio "Vibe Digital Agency" (`128442470224455`, sin verificar).
- Webhook único de la app: `https://soci.vibedigital.agency/api/webhooks/wa/<META_WEBHOOK_VERIFY_TOKEN>` suscrito a `messages`, `message_template_status_update` (objeto `whatsapp_business_account`).
- WABA de prueba `2490760061435078` · número de prueba `+1 555-203-1635` · phone_number_id `1283088014894060` · conectado en Soci (org Vibe Digital) con token de System User `soci-system` (id `61594182565566`, sin caducidad).
- Existe una segunda WABA "Vibe - Digital Agency" en el portfolio (número real): revisar antes de conectarla.
- Pendiente global: verificación de negocio, App Review (`whatsapp_business_management`, `whatsapp_business_messaging`), registro como Tech Provider (T6.4).

## Google Cloud
- Proyecto `soci-vibedigital` (cuenta ccarita.hans@gmail.com) · Calendar API habilitada.
- OAuth: app "Soci", externa, **publicada en producción** (sin verificar: aviso + tope 100 usuarios) · scope `https://www.googleapis.com/auth/calendar.events` · dominio autorizado `vibedigital.agency` · home `https://soci.vibedigital.agency` · privacidad `/legal/privacy` · términos `/legal/terms` (páginas por crear en T6.3).
- Cliente web "Soci web" · redirects: `https://soci.vibedigital.agency/api/settings/google/oauth/callback` y `https://soci-staging.vibedigital.agency/api/settings/google/oauth/callback` · `GOOGLE_OAUTH_CLIENT_ID/SECRET` ya en Coolify (prod y staging); los usa T3.7.
- Pendiente: verificación de Google tras T6.3 (dominio en Search Console + video del flujo).

## Organizaciones en Soci
- **Vibe Digital** · dueño Hans · creada 2026-09-03 · `ALLOW_SIGNUP=false` desde entonces (altas futuras por `/admin`, T3.4).
