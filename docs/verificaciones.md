# Verificaciones de Meta y Google: qué es global y qué es por empresa

Regla: **la plataforma (vibedigital) se configura y verifica una sola vez.** Cada empresa que entra después solo autoriza con clics desde Ajustes. Nunca se le pide a una empresa crear apps en Meta ni en Google Cloud.

## Meta / WhatsApp Cloud API

| Nivel | Qué | Cuándo | Quién |
|---|---|---|---|
| **Global (una vez)** | App de Meta de vibedigital con el producto WhatsApp; webhook único `https://soci.vibedigital.agency/api/webhooks/wa/<token>`; permisos `whatsapp_business_management` y `whatsapp_business_messaging` aprobados en App Review; **verificación de negocio** de vibedigital; solicitud de **Tech Provider** para habilitar Embedded Signup. | Fase 0 (se inicia el día 1; App Review y Tech Provider tardan de 1 a 4 semanas). Se usa en producción a partir de T6.4. | Hans (QA guía paso a paso). |
| **Por empresa (cada alta)** | Un *Business Portfolio* de Meta (gratis, lo crea la empresa con su Facebook), un número de teléfono que **no** esté en la app normal de WhatsApp, y aceptar el Embedded Signup desde Ajustes → WhatsApp (3 clics). Su nombre visible (*display name*) lo aprueba Meta en horas. | Al dar de alta la empresa. | La empresa, desde Soci. |
| **Por empresa (opcional)** | Verificación de negocio de la empresa: solo si necesita más de 250 conversaciones iniciadas por ella al día o quiere la marca verificada. | Cuando crezca. | La empresa, en su Business Manager. |

Mientras Tech Provider no esté aprobado (fases 0 a 5): **modo directo**. Cada empresa (empezando por vibedigital) crea su propia app de Meta y pega el token permanente de *System User* en el asistente de Ajustes → WhatsApp. Es lo que Vocero trae hoy y sirve para las primeras empresas piloto.

Costos: recibir y responder dentro de las 24 h es gratis. Meta cobra solo las conversaciones que **la empresa inicia** (plantillas) fuera de esa ventana. Cada empresa paga las suyas con su propio método de pago en su Business Manager; la plataforma no intermedia dinero.

## Google Calendar (agenda)

| Nivel | Qué | Cuándo | Quién |
|---|---|---|---|
| **Global (una vez)** | Un proyecto de Google Cloud de vibedigital con Calendar API activada; pantalla de consentimiento OAuth tipo *Externo*; cliente OAuth web con redirect `https://soci.vibedigital.agency/api/settings/google/oauth/callback`; scope `https://www.googleapis.com/auth/calendar.events`; **publicar la app en producción** (no dejarla en *Testing*: los refresh tokens caducan a los 7 días); enviar a **verificación** (el scope es "sensible"): pide dominio verificado en Search Console, URL de privacidad y términos (T6.3), y un video corto del flujo. | Fase 0 (iniciar el día 1; la verificación tarda de 1 a 6 semanas). El código que lo usa es T3.7. | Hans (QA guía). |
| **Por empresa (cada alta)** | Pulsar "Conectar Google Calendar" en Ajustes → Agenda, elegir su cuenta de Google, aceptar. Soci guarda su refresh token cifrado. Nada más. | Al dar de alta. | La empresa, desde Soci. |

Hasta que Google apruebe la verificación: la app funciona igual pero muestra el aviso "Google no ha verificado esta aplicación" (la empresa pulsa "Avanzado → Ir a Soci") y hay un tope de **100 usuarios** que hayan autorizado. Suficiente para las primeras empresas.

Antes de T3.7 (fases 0 a 2): la agenda usa el modo actual de Vocero, donde cada empresa pega Client ID, Client Secret y refresh token de su propia app de Google Cloud. Solo lo hará vibedigital para la demo; ninguna empresa piloto pasa por eso.

## Proveedores de IA

| Nivel | Qué |
|---|---|
| **Global** | Claves de Anthropic, OpenAI, OpenRouter, etc. de vibedigital en variables de entorno. Cuota por empresa desde el panel `/admin` (T3.4). |
| **Por empresa (opcional)** | La empresa pega su propia clave en Ajustes → IA (BYOK). Entonces sus llamadas no consumen la cuota de la plataforma. |

## Orden recomendado para Hans (día 1)

1. Meta: crear la app en developers.facebook.com → añadir WhatsApp → en *Configuración → Básica* subir icono, política de privacidad (temporal: página de vibedigital.agency) → *Verificación de negocio* en business.facebook.com → pedir permisos `whatsapp_business_management` y `whatsapp_business_messaging` en App Review → solicitar Tech Provider (*WhatsApp → Partner Solutions*). Mientras tanto, para la demo: número de pruebas + token de System User en modo directo.
2. Google: console.cloud.google.com → proyecto `soci-vibedigital` → habilitar *Google Calendar API* → *OAuth consent screen* Externo, nombre "Soci", dominio autorizado `vibedigital.agency` → *Credentials → OAuth client ID (Web)* con el redirect de arriba → *Publish app* → iniciar *Verification*.
3. Pegar en Coolify: `META_APP_SECRET`, y (desde T3.7) `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`.
