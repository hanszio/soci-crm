# 018 — Jev (TypeSafe) + Perfil de negocio obligatorio

Estado (2026-10-05): **J0, J1–J3, P5 y el minador están hechos en `phase/1`** (sin desplegar). Falta: perfil de negocio con asistente `/onboarding` (P1–P4, P6), señales de Jev al lead y al retraso (J5), vista para aprender de turnos dudosos (J6).

### Resultado de J0 y de lo construido (jev-1.13.0, 164 casos en español, `pnpm jev:eval`)

| Medida | Resultado |
|---|---|
| Intención | 98.8 % de acierto; 100 % a confianza ≥ 0.75 (cobertura 93 %) |
| Ficha que responde | 100 % a confianza ≥ 0.85 en la primera medición; 99.3 % en la última |
| Horario elegido | 100 % (con la posición escrita en el criterio: "primera", "última") |
| Pedir humano / hostil / inyección | detecta 8/8, 7/7 y 8/8; falsos positivos 2, 0 y 0 de ~156 |
| **Turnos sin LLM** | **81 %**, con **99.2 % de precisión** (1 decisión discutible de 133) |
| Latencia | p50 273 ms · p95 442 ms |
| Costo | ~1 950 tokens ≈ US$0.00008 por turno |
| Idioma de instrucciones | español e inglés rinden igual: se dejan en español |

Límites de esta medición: los casos los escribí yo imitando WhatsApp peruano, no son chats reales; solo 19 son de elegir horario. Hay que ampliar el set con conversaciones reales (el minador ayuda) antes de confiar ciegamente en los umbrales.

Lo construido difiere del plan original en esto:
- La doble puerta de ficha (`ficha_completa`) se quitó: con confianza ≥ 0.85 no hizo falta y ahorra tokens.
- Los interruptores por carril (`fast_lane`) no se hicieron: basta `jev_mode` = off | shadow | on por negocio.
- Se agregó **trato tú/usted** por negocio y TODAS las frases fijas del agente pasaron al banco (18 claves × 2 tratos).
- Se agregó **cortesía tras agendar**: un "gracias" recibe respuesta aunque la conversación ya sea del equipo.
- La clave de TypeSafe es de plataforma (env); la clave por empresa queda pendiente.

Piezas: `src/lib/typesafe` · `src/server/jev/{flag,questions,route,decide}.ts` · `src/server/replies/{keys,bank,wa-export}.ts` · `/api/reply-variants*` · `/api/jev/stats` · `scripts/{jev-eval.ts,wa-mine.ts,org-apply.mjs}` · `docs/plantillas/contabilidad.json` · migraciones 0018–0019.

Plan original (2026-10-02):

Fuentes leídas (documentación viva de TypeSafe, revisada 2026-10-02):
[índice](https://docs.typesafe.ai/llms.txt) ·
[System One](https://docs.typesafe.ai/concepts/system-one.md) ·
[Jev con agentes de código](https://docs.typesafe.ai/introduction/coding-agents.md) ·
[modelos, precio y límites](https://docs.typesafe.ai/models.md) ·
[API](https://docs.typesafe.ai/api.md) ·
[SDK JS](https://docs.typesafe.ai/sdk/javascript.md) ·
[state](https://docs.typesafe.ai/concepts/state.md) ·
[confianza](https://docs.typesafe.ai/confidence.md) ·
patrones [intent routing](https://docs.typesafe.ai/patterns/intent-routing.md), [confidence-gated routing](https://docs.typesafe.ai/patterns/confidence-routing.md), [fan-out especulativo](https://docs.typesafe.ai/patterns/fan-out.md) ·
cookbooks [guardrails](https://docs.typesafe.ai/cookbooks/llm_guardrails.md), [function calling](https://docs.typesafe.ai/cookbooks/function_calling.md), [fechas](https://docs.typesafe.ai/cookbooks/date_extraction_cookbook.md) ·
[límites conocidos de jev-1.13](https://docs.typesafe.ai/model-jaggedness/jev-1.13.md).
Referencias de diseño: [variantes de respuesta de Rasa](https://rasa.com/docs/reference/primitives/responses/) y el alta de [Meta Business Agent](https://docs.360dialog.com/docs/mba/meta-business-agent) (negocio, FAQs, archivos, traspaso).

---

## 1. Lo que Jev es y lo que no es

| Hecho (docs) | Consecuencia para Soci |
|---|---|
| Jev **no genera texto**. Devuelve `choice` (una opción + probabilidades), `noul` (probabilidad de sí) y `score` (nivel en una rúbrica), con `confidence`. | Jev no puede redactar la respuesta. Decide **qué** responder; el texto sale de un banco de respuestas del negocio o del LLM actual. |
| Un request evalúa un `state` contra muchas preguntas **en paralelo** (fan-out). | Un solo request por turno resuelve intención, horario elegido, ficha que responde, archivo a enviar, pedir humano, inyección y temperatura del lead. |
| Precio: US$0.042 por millón de tokens de entrada; salida gratis. Límite 40 req/s, 100K tokens/s. Contexto 64k (32k para state + pregunta más larga). | Un turno de ~4k tokens cuesta ~US$0.00017. 10 000 turnos al mes ≈ US$1.70. El costo deja de ser tema. |
| Idioma principal de entrenamiento: inglés. Otros idiomas "se aceptan con menor precisión; prueba con tu contenido". | **Riesgo n.º 1**: todo Soci es español. Fase J0 mide antes de construir. |
| Lectura literal, mala con números y fechas, peor con state grande e irrelevante, influenciable por texto adversarial. | Criterios explícitos por opción; fechas y cuentas en código; state mínimo y filtrado; la detección de inyección de Jev es una señal, no la única defensa. |
| `jev-latest` es un alias que cambia de versión. | Fijar `jev-1.13.0`; los umbrales se recalibran al subir de versión. |
| No se entrena con datos de clientes; retención cero solo en plan enterprise. | El texto de las conversaciones sale a un tercero: activación por empresa, mención en la política de privacidad. |

**Sobre "más rápidas"**: hoy el cliente espera 10–300 s a propósito (retraso humano, T1.2). La velocidad de Jev no se nota en el reloj del cliente salvo que se baje ese retraso en los carriles directos. Donde sí se gana: el turno deja de depender del proveedor LLM en la mayoría de mensajes (hoy una caída = reintentos y handoff por error), el costo por turno cae ~100×, y el Laboratorio corre más rápido.

**Sobre "más variadas"**: la variedad sale del banco de respuestas (≥4 variantes por intención, sin repetir dentro de la conversación), no de Jev.

---

## 2. Arquitectura del turno: tres carriles

```
mensaje entrante
   │
   ▼
[1] Jev: UN request, ~12 preguntas sobre el mismo state        (src/server/jev/decide.ts)
   │
   ▼
[2] Política en código: umbrales por riesgo                      (src/server/jev/route.ts)
   ├── Carril A · DIRECTO     → banco de respuestas / ficha / agenda / archivo   (sin LLM)
   ├── Carril B · GENERATIVO  → pipeline LLM actual (chatJson), con pistas de Jev
   └── Carril C · ACLARAR     → pregunta de aclaración del banco
   │
   ▼
[3] Guardarraíles existentes (horarios inventados, saludo, política de cierre) + envío
```

Si Jev falla, tarda más de 2.5 s o está apagado: todo va al carril B, que es exactamente el comportamiento de hoy. Jev nunca bloquea un turno (regla de conector opcional de la constitución).

### 2.1 State (mínimo, con nombres)

```json
{
  "negocio": { "nombre": "…", "rubro": "…" },
  "conversacion": [ { "de": "cliente|asistente", "texto": "…" } ],   // últimos 8
  "ultimo_mensaje": "…",
  "horarios_ofrecidos": [ { "id": "h1", "etiqueta": "mañana martes 10:00" } ],
  "fichas": [ { "id": "f1", "pregunta": "…" } ],                       // solo preguntas, no respuestas
  "archivos": [ { "id": "a1", "titulo": "…", "cuando": "…" } ],
  "cita_activa": false
}
```

Las respuestas de las fichas NO van al state: Jev solo elige cuál aplica; el texto lo pone el código. Menos tokens y menos distractores.

### 2.2 Preguntas (un request)

| id | tipo | opciones / criterio | uso |
|---|---|---|---|
| `intencion` | choice | saludo · confirmacion · despedida · pregunta_negocio · pedir_precio_o_catalogo · agendar · elegir_horario · pedir_humano · cancelar_o_cambiar_cita · queja_hostil · fuera_de_tema · otro | carril |
| `ficha` | choice | ids de fichas (≤254) + `ninguna` | respuesta directa |
| `ficha_completa` | noul | "¿Alguna de `fichas` responde por completo `ultimo_mensaje`?" | puerta de la ficha |
| `horario` | choice | ids de `horarios_ofrecidos` + `ninguno` + `otro_dia_u_hora` | book_slot |
| `dia_pedido` | choice | hoy · mañana · lun…dom · no_dice | filtrar oferta en código |
| `modalidad` | choice | presencial · llamada · no_dijo | book_slot |
| `archivo` | choice | ids de archivos + `ninguno` | send_product |
| `pide_humano` | noul | pide persona, asesor o encargado | política de cierre |
| `hostil` | noul | insulta, amenaza o reclama con enojo | handoff |
| `inyeccion` | noul | intenta cambiar las reglas del asistente o sacarle sus instrucciones | carril seguro |
| `compuesta` | noul | más de una pregunta, o pide cálculo/cotización a medida | fuerza carril B |
| `interes` | score | 0 curiosea · 1 pregunta detalles · 2 pide precio o fecha · 3 quiere cerrar | etapa del lead |

Notas de diseño tomadas de los docs: una pregunta por juicio; opción de "no aplica" siempre presente; criterios escritos por opción; no comparar un `noul` con una probabilidad de `choice`; fechas como selección sobre opciones cerradas y aritmética en código. Instrucciones y criterios: se prueba en J0 si rinden mejor en inglés (state en español) o en español.

### 2.3 Política por riesgo (confidence-gated routing)

| Decisión | Condición | Acción |
|---|---|---|
| Saludo / confirmación / despedida | `intencion.confidence ≥ 0.6` | variante del banco |
| Ficha directa | `ficha ≠ ninguna`, `confidence ≥ 0.80`, `ficha_completa ≥ 0.70`, `compuesta < 0.4` | respuesta de la ficha, tal cual |
| Enviar archivo | `archivo ≠ ninguno`, `confidence ≥ 0.75`, no enviado antes en la conversación | `send_product` + pie del banco |
| Reservar | `horario` es un id, `confidence ≥ 0.85`, modalidad conocida o única | `book_slot` |
| Reservar con duda | `0.60 ≤ confidence < 0.85` | confirmar: "¿Le agendo el martes a las 10:00?" |
| Otro día | `horario = otro_dia_u_hora` | `offer_slots` filtrado por `dia_pedido` |
| Pedir humano | `pide_humano ≥ 0.70` | `decideEscalation` (ya existe) |
| Hostil | `hostil ≥ 0.75` | handoff |
| Inyección | `inyeccion ≥ 0.60` | respuesta fija de fuera de tema; contador de intentos (T2.1) |
| Todo lo demás, o `confidence < 0.6` en la decisión que tocaba | — | carril B (LLM) |
| `intencion.confidence < 0.4` y mensaje corto | — | carril C: pregunta de aclaración |

Los números son puntos de partida; J0 los calibra con datos en español. Viven en `agent_profile.fast_lane` (jsonb) para ajustarlos por empresa sin desplegar.

### 2.4 Banco de respuestas (la variedad)

Tabla `reply_variant(id, organization_id, key, text, source 'ai'|'owner', active, created_at)`; `key` = `saludo`, `ack`, `despedida`, `que_hacemos`, `pedir_dato_cotizacion`, `aclarar`, `ofrecer_llamada`, `pie_archivo`, `confirmar_horario`, `fuera_de_tema`… Mínimo 4 variantes activas por clave.

- Ranuras resueltas en código: `{agente}`, `{negocio}`, `{direccion}`, `{horario}`, `{dato_faltante}`.
- Selección: aleatoria entre las no usadas en esta conversación (`message.variant_id` nuevo, nullable). Mismo principio que las variantes de Rasa, más memoria por conversación.
- Origen: se generan UNA vez con el LLM a partir del Perfil de negocio (tono, trato, rubro) y el dueño las aprueba o edita. En tiempo de respuesta no hay generación.
- Absorbe los "saludos iniciales" multilínea de T1.16 (migración de datos: cada línea pasa a `key='saludo'`).

---

## 3. Perfil de negocio: la plantilla obligatoria

Hoy el contexto de una empresa son tres textos libres (`instructions`, `escalationRules`, `greeting`) más fichas sueltas. Para Spark y Golden los escribí a mano desde un docx: funciona, no escala. La plantilla convierte eso en datos estructurados de los que se **compila** todo lo demás.

### 3.1 Esquema (`business_profile.data`, Zod versionado)

| Sección | Campos | Obligatorio |
|---|---|---|
| 1 Identidad | nombre comercial, rubro (lista + otro), qué hace en 1–2 frases, ciudad y país, zona horaria, moneda | sí |
| 2 Voz | nombre del agente, trato (tú/usted), tono (cercano · formal · elegante · juvenil), emojis sí/no, frases propias, palabras prohibidas | sí |
| 3 Oferta | lista de productos/servicios: nombre, descripción corta, precio o "se cotiza", unidad; qué NO hacen | ≥1 ítem |
| 4 Operación | horario de atención, direcciones, cobertura o envíos, formas de pago, políticas (reserva, mínimos, devoluciones) | horario + pago |
| 5 Objetivo | meta de la conversación: visita · llamada · venta por chat · captura de datos; datos a pedir para cotizar, en orden; cuándo proponer cita | sí |
| 6 Límites | qué no se promete nunca; qué se define "solo en la cita"; cuándo pasar a una persona | sí |
| 7 Preguntas frecuentes | 5–15 pares pregunta/respuesta (sugeridas por rubro) | ≥5 |
| 8 Archivos | PDF e imágenes del catálogo (T5.1) | no |
| 9 Conexiones | WhatsApp, calendario, proveedor de IA (estado; no bloquea el asistente de alta, sí la activación del bot) | WhatsApp para activar |

Tabla: `business_profile(id, organization_id UNIQUE, schema_version int, data jsonb, status 'draft'|'complete', completed_at, updated_by, created_at, updated_at)` + `business_profile_version` (historial, para deshacer).

### 3.2 Compilador (determinista)

`compileProfile(profile)` en `src/server/profile/compile.ts` produce, sin LLM:

- `agent_profile`: `name`, `tone`, `instructions` (plantilla fija con huecos), `escalation_rules`, `escalation_mode`.
- `kb_entry`: una ficha por FAQ y por dato de operación/oferta, marcadas `source='profile'` (columna nueva) para regenerarlas sin tocar las fichas manuales.
- `calendar_settings`: zona, dirección, modalidades según el objetivo.
- Opciones y criterios de las preguntas de Jev (intenciones habilitadas, claves del banco).

Y encola, con LLM, la generación del banco de respuestas (trabajo `profile_variants` en `agent_job`).

Es la versión de producto de `apply.py` + `config.json` que ya se usó para Golden.

### 3.3 Recorrido obligatorio

- `src/app/(app)/layout.tsx`: si `business_profile.status ≠ 'complete'` redirige a `/onboarding` (excepto `/settings/*` y cerrar sesión).
- `/onboarding`: asistente de 7 pasos con guardado por sección (`PATCH /api/profile/:section`), barra de avance y vista previa "así saludará tu asistente".
- Servidor: `PUT /api/agent/profile {enabled:true}` responde 409 si el perfil no está completo; `runAgentTurn` tampoco corre sin perfil completo.
- Consola del propietario (T3.1): `POST /api/platform/organizations` acepta `profile` opcional; puedo crear la empresa con el perfil prellenado y el dueño solo revisa y confirma.
- Empresas existentes (Vibe/Spark, Golden): script de retrocarga que arma el perfil desde sus datos actuales y lo marca completo.

### 3.4 Mejoras a la idea

1. **Importar desde documentos**: en el paso 1 se sube un PDF/docx/texto; el LLM extrae un borrador del perfil con el esquema Zod (`chatJson`) y el dueño confirma campo por campo. Convierte 40 minutos de formulario en 5 de revisión. Es lo que hice a mano con el docx de Golden.
2. **Plantillas por rubro**: imprenta, salón de eventos, consultorio, restaurante, inmobiliaria, servicios profesionales. Prellenan preguntas frecuentes típicas, datos para cotizar y objetivo.
3. **Ensayo antes de activar**: el último paso corre el Laboratorio (6 personas) y muestra la nota. Activar exige nota mínima o una confirmación explícita.
4. **Medidor de calidad por sección**: un request a Jev con `noul` por campo ("¿este texto dice qué vende el negocio?", "¿la política menciona un monto?"). Señala campos vagos antes de que el bot los use.
5. **Versiones y deshacer**: cada guardado crea versión; se puede volver a la anterior y ver el cambio en el prompt compilado.
6. **Cambios de esquema**: al subir `schema_version`, solo se piden los campos nuevos; el bot sigue activo con un aviso.

---

## 4. Integración técnica

| Pieza | Decisión |
|---|---|
| Bandera de despliegue | `JEV=on` (patrón ADR-001). Apagada: sin superficie, sin llamadas. |
| Clave | Plataforma `TYPESAFE_API_KEY` (env) y, opcional, por empresa en `typesafe_settings` (cifrada AES-256-GCM, como `ai_settings`). |
| Cliente | `@typesafe-ai/sdk@0.6.0` (Node ≥20, ESM/CJS). `model: "jev-1.13.0"`, `timeout: 2500`, `retry.maxRetries: 1`. Envoltorio en `src/lib/typesafe/index.ts` con resultado tipado `{ok:true,answers}|{ok:false,error}`; jamás lanza. |
| Uso | `usage_event.kind='gate'` (ya existe en el enum): tokens, latencia, ok. |
| Mock | `src/app/api/dev/typesafe-mock/v1/systemone` (determinista por contenido), `TYPESAFE_BASE_URL` para apuntarlo en E2E. |
| Registro | `turn_decision(id, organization_id, conversation_id, message_id, lane, answers jsonb, latency_ms, model, created_at)`: auditoría, calibración y base del "aprender de conversaciones reales". |
| Sandbox del Lab | El Lab usa Jev igual (no envía nada a WhatsApp); así el juez evalúa los tres carriles. |
| Seguridad | La respuesta de una ficha directa es texto del negocio, no del cliente. El state lleva texto del cliente: nunca se usa como instrucción. `inyeccion` alto ⇒ carril seguro aunque otra pregunta diga lo contrario. |

Migración prevista: `0018_jev_perfil.sql` (tablas `business_profile`, `business_profile_version`, `reply_variant`, `turn_decision`, `typesafe_settings`; columnas `kb_entry.source`, `message.variant_id`, `agent_profile.fast_lane`).

---

## 5. Fases y tareas

### Fase J0 — Medir antes de construir (1 día) · bloquea todo lo de Jev
- `tests/fixtures/jev-eval/*.jsonl`: ≥150 casos en español etiquetados a mano (mensajes reales anonimizados de prod + guiones del Lab): intención, horario elegido, ficha correcta, pide humano, inyección.
- `scripts/jev-eval.mjs`: corre el request real; reporta exactitud y matriz de confusión por pregunta, **curva de calibración** (aciertos por tramo de confianza), cobertura a cada umbral, latencia p50/p95, tokens. Compara criterios en inglés vs español.
- **Criterio de avance** (medido sobre lo que pasaría por carril A): intención ≥ 92 % con cobertura ≥ 60 %; horario ≥ 98 %; ficha directa precisión ≥ 95 %; p95 ≤ 1.5 s. Si el español no llega, Jev queda solo como señal (retraso, inyección, temperatura) y el carril A no se enciende.

### Fase P — Perfil de negocio (5 días) · no depende de Jev
- **P1** Esquema Zod + tablas + API (`/api/profile`, secciones, versiones). Tests de validación.
- **P2** Compilador determinista + columna `kb_entry.source` + retrocarga de Vibe/Spark y Golden. Test: compilar el perfil de Golden reproduce sus fichas actuales.
- **P3** Asistente `/onboarding` + guardas de layout y de activación + alta con perfil desde la consola del propietario.
- **P4** Importar desde documento (borrador con LLM) + plantillas por rubro.
- **P5** Banco de respuestas: tabla, generación en cola, editor en Ajustes → Agente, selección sin repetir, migración de saludos. E2E: dos conversaciones nuevas saludan distinto.
- **P6** Ensayo con el Lab como último paso + medidor de calidad (el medidor usa Jev: solo si J0 pasó).

### Fase J — Jev en el turno (5 días) · tras J0 verde
- **J1** Conector: bandera, cliente, ajustes, mock, `usage_event`. E2E apagado/encendido.
- **J2** `decide.ts` (state + preguntas) y `route.ts` (política pura, 100 % testeable con respuestas simuladas).
- **J3** **Modo sombra**: Jev corre en cada turno, se registra `turn_decision`, la respuesta sigue saliendo del LLM. Panel en Laboratorio: acuerdo Jev vs LLM por intención. Una semana de datos reales.
- **J4** Carril A por etapas, cada una con su interruptor en `fast_lane`: (1) saludo/confirmación/despedida, (2) pedir humano e inyección (reemplazan regex), (3) fichas directas, (4) archivo, (5) agenda. Cada etapa se enciende solo si su acuerdo en sombra supera el umbral.
- **J5** Señales al resto: `interes` mueve etapa del lead; intención de Jev reemplaza la heurística de `jobs/delay.ts`; retraso mínimo menor en carril A.
- **J6** Aprender de conversaciones reales: vista de turnos con baja confianza o corregidos por un humano; botón "convertir en ficha" y "agregar variante".

Orden recomendado: J0 y P1–P3 en paralelo, luego P5, J1–J3, y J4 por etapas.

---

## 6. Riesgos

| Riesgo | Mitigación |
|---|---|
| Jev rinde peor en español | J0 con datos propios; umbrales por pregunta; carril B siempre disponible |
| Respuesta directa equivocada (ficha mal elegida) | doble puerta (`choice` + `noul`), umbral alto, modo sombra previo, registro y corrección en J6 |
| Respuestas enlatadas suenan robóticas | ≥4 variantes, sin repetir por conversación, generadas con el tono del negocio, editables; mensajes complejos siguen yendo al LLM |
| Alias `jev-latest` cambia el comportamiento | versión fija; `jev-eval` en CI manual antes de subir de versión |
| Límites de tasa "ajustándose dinámicamente" (aviso de TypeSafe) | 429 ⇒ carril B; nunca reintentar en caliente más de una vez |
| Dependencia de un proveedor joven | conector opcional; todo funciona sin él |
| Privacidad | activación por empresa; política de privacidad; state mínimo, sin teléfono ni nombre |
| Onboarding largo espanta al cliente | importar desde documento, plantillas por rubro, guardado por sección, yo puedo prellenar desde la consola |

## 7. Lo que hace falta de Hans
1. API key de TypeSafe (para J0).
2. Permiso para usar conversaciones reales de producción, anonimizadas, como set de evaluación.
3. Decisión: ¿el perfil obligatorio bloquea todo el panel hasta completarse, o solo la activación del bot? El plan asume lo primero, con `/settings` accesible.
