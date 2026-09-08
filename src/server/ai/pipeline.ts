import { asc, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { moveLeadToStage as moveLeadThroughHistory } from "@/server/leads/stage-history";
import { chatJson, type ChatMessage } from "@/lib/ai";
import { enqueue } from "@/server/jobs/queue";
import { publish } from "@/server/events/bus";
import { isWindowOpen } from "@/server/inbox/window";
import { SendError, sendText } from "@/server/inbox/send";
import {
  agentActionSchema,
  degradeAction,
  resolveStage,
  type AgentActionType,
} from "@/server/ai/actions";
import { matchesHandoffIntent } from "@/server/ai/handoff";
import { buildAgentSystemPrompt } from "@/server/ai/prompts";
import { agendaEnabled } from "@/server/agenda/flag";
import { bookSlot, offerSlots } from "@/server/agenda/agent";
import { getOffers } from "@/server/agenda/offers";
import { getSettings } from "@/server/agenda/settings";
import { hasActiveBooking } from "@/server/agenda/service";
import {
  AFTER_BOOKING_FAREWELL,
  CALL_OFFER_INTRO,
  decideEscalation,
  nextProviderRetry,
  PROVIDER_DOWN_REPLY,
} from "@/server/ai/policy";

/**
 * Turno del agente (FR-021..FR-025).
 *
 * La programación vive en la cola persistente (T1.2, `server/jobs`): una
 * ráfaga de mensajes pospone el único turno pendiente de la conversación, y
 * un redeploy en mitad del retraso humano no pierde la respuesta. Aquí solo
 * queda el candado in-process contra dos turnos simultáneos.
 */

type RunningMap = Map<string, true>;

const globalForAgent = globalThis as unknown as { __agentRunning?: RunningMap };

function runningMap(): RunningMap {
  if (!globalForAgent.__agentRunning) globalForAgent.__agentRunning = new Map();
  return globalForAgent.__agentRunning;
}

/**
 * Corre UN turno si esa conversación no tiene otro en curso. La cola (T1.2)
 * garantiza un solo trabajo pendiente por conversación; esto cubre el hueco
 * entre dos trabajos que vencieron seguidos.
 */
export async function runAgentTurnExclusive(
  conversationId: string
): Promise<"ran" | "busy"> {
  const map = runningMap();
  if (map.has(conversationId)) return "busy";
  map.set(conversationId, true);
  try {
    await runAgentTurn(conversationId);
    return "ran";
  } finally {
    map.delete(conversationId);
  }
}

/**
 * Ejecuta UN turno del agente ahora (el Laboratorio lo llama directo, con
 * debounce 0 y sin pasar por el coalesce).
 */
export async function runAgentTurn(conversationId: string): Promise<void> {
  // La disponibilidad de IA se resuelve por organización dentro de chatJson
  // (Ajustes → IA o plataforma): `not_configured` termina el turno en silencio.

  const db = getDb();
  const convRows = await db
    .select()
    .from(schema.conversation)
    .where(eq(schema.conversation.id, conversationId))
    .limit(1);
  const conversation = convRows[0];
  if (!conversation) return;
  const organizationId = conversation.organizationId;

  // Condiciones de silencio: handoff activo o IA apagada en la conversación.
  if (conversation.handoffAt || !conversation.aiEnabled) return;

  const profileRows = await db
    .select()
    .from(schema.agentProfile)
    .where(eq(schema.agentProfile.organizationId, organizationId))
    .limit(1);
  const profile = profileRows[0];
  if (!profile) return;
  // El toggle global aplica a conversaciones reales; el Laboratorio evalúa el
  // comportamiento configurado aunque el agente aún no esté encendido.
  if (!conversation.isTest && !profile.enabled) return;

  const history = await db
    .select()
    .from(schema.message)
    .where(eq(schema.message.conversationId, conversationId))
    .orderBy(desc(schema.message.createdAt))
    .limit(20);
  history.reverse();
  const lastInbound = [...history].reverse().find((m) => m.direction === "in");
  if (!lastInbound) return;

  // Ventana cerrada: el agente JAMÁS envía texto libre → handoff 'ventana'.
  if (!conversation.isTest && !isWindowOpen(conversation.lastInboundAt)) {
    await applyHandoff(conversationId, organizationId, "ventana");
    return;
  }

  const agenda = agendaEnabled();

  // Patrón de respaldo ANTES del LLM (FR-022). Con la política `cita`, pedir
  // un humano se convierte en ofrecer una llamada agendada: el dueño no vive
  // en el dashboard, y un handoff mudo se ve como "no me respondieron".
  if (lastInbound.text && matchesHandoffIntent(lastInbound.text)) {
    const decision = decideEscalation({
      mode: profile.escalationMode,
      agenda,
      hasActiveBooking: await hasActiveBooking(
        organizationId,
        conversation.contactId
      ).catch(() => false),
      reason: null,
    });
    if (decision.kind === "offer_call") {
      try {
        const turn = await offerSlots({
          organizationId,
          conversationId,
          intro: CALL_OFFER_INTRO,
        });
        await deliverReply(conversation, turn.text);
        return;
      } catch (err) {
        console.error(`[agente] no pude ofrecer la llamada, escalo: ${err}`);
      }
    }
    try {
      await deliverReply(conversation, HANDOFF_FAREWELL);
    } catch (err) {
      console.error("[agente] no se pudo enviar la despedida del handoff:", err);
    }
    await applyHandoff(conversationId, organizationId, "cliente");
    return;
  }

  const kb = await db
    .select()
    .from(schema.kbEntry)
    .where(eq(schema.kbEntry.organizationId, organizationId))
    .orderBy(asc(schema.kbEntry.createdAt));
  const stages = await db
    .select({ id: schema.pipelineStage.id, name: schema.pipelineStage.name })
    .from(schema.pipelineStage)
    .where(eq(schema.pipelineStage.organizationId, organizationId))
    .orderBy(asc(schema.pipelineStage.position));

  // La oferta vigente y la hora actual van al prompt: sin el startUtc exacto el
  // modelo no puede reservar, y sin la fecha no sabe qué día es "mañana".
  let offers: { startUtc: string; label: string }[] = [];
  let now: string | undefined;
  let modalities: ("presencial" | "llamada" | "videollamada")[] | undefined;
  let address: string | null = null;
  if (agenda) {
    try {
      const [settings, current] = await Promise.all([
        getSettings(organizationId),
        getOffers(organizationId, conversationId),
      ]);
      offers = current;
      now = formatNow(new Date(), settings.timezone);
      modalities = settings.modalities;
      address = settings.address;
    } catch (err) {
      console.warn(`[agente] no pude leer la oferta vigente: ${err}`);
    }
  }
  const messages: ChatMessage[] = [
    {
      role: "system",
      content: buildAgentSystemPrompt({
        profile,
        kb,
        stages,
        agenda,
        offers,
        now,
        modalities,
        address,
      }),
    },
    ...history
      .filter((m) => m.text)
      .map((m) => ({
        role: m.direction === "in" ? ("user" as const) : ("assistant" as const),
        content: m.text!,
      })),
  ];

  const result = await chatJson(agentActionSchema(agenda), messages, {
    organizationId,
    kind: "chat",
  });
  if (!result.ok) {
    if (result.error === "not_configured") return;
    console.error(`[agente] fallo del proveedor (raw): ${result.detail}`);
    // Un hipo del proveedor no puede dejar al cliente sin respuesta ni pausar
    // la IA para siempre: se reintenta el turno con espera creciente y solo
    // al agotar los intentos se avisa al cliente y se escala.
    const attempt = bumpRetry(conversationId);
    const delay = nextProviderRetry(attempt);
    if (delay !== null) {
      console.warn(
        `[agente] reintento ${attempt + 1} del turno en ${Math.round(delay / 1000)}s`
      );
      await enqueue({
        organizationId,
        kind: "agent_turn",
        conversationId,
        runAt: new Date(Date.now() + delay),
      });
      return;
    }
    clearRetry(conversationId);
    try {
      await deliverReply(conversation, PROVIDER_DOWN_REPLY);
    } catch (err) {
      console.error("[agente] no pude avisar la caída del proveedor:", err);
    }
    await applyHandoff(conversationId, organizationId, "error");
    return;
  }
  clearRetry(conversationId);

  let action: AgentActionType = result.data;

  // Política de cierre: el modelo quiere escalar, pero con `cita` eso se
  // convierte en ofrecer una llamada, salvo que ya haya cita o el motivo sea
  // de los que sí ameritan parar (cancelar, hostilidad).
  if (action.action === "handoff") {
    const decision = decideEscalation({
      mode: profile.escalationMode,
      agenda,
      hasActiveBooking: await hasActiveBooking(
        organizationId,
        conversation.contactId
      ).catch(() => false),
      reason: action.reason ?? null,
    });
    if (decision.kind === "offer_call") {
      action = { action: "offer_slots", reply: CALL_OFFER_INTRO };
    }
  }

  // 015 — Agenda. Un fallo del motor degrada el turno (el agente responde sin
  // agendar), nunca lo tumba: quedarse callado es peor que no agendar.
  if (action.action === "offer_slots" || action.action === "book_slot") {
    if (!agenda) {
      action = degradeAction(action);
    } else {
      try {
        const turn =
          action.action === "offer_slots"
            ? await offerSlots({
                organizationId,
                conversationId,
                intro: action.reply,
              })
            : await bookSlot({
                organizationId,
                conversationId,
                startUtc: action.startUtc,
                confirmation: action.reply,
                modality: action.modality,
              });
        const booked = action.action === "book_slot" && turn.ok;
        await deliverReply(
          conversation,
          booked ? `${turn.text}\n${AFTER_BOOKING_FAREWELL}` : turn.text
        );
        if (booked) {
          // La cita es el cierre: de aquí en adelante habla el equipo. El lead
          // ya avanzó de etapa dentro del motor de agenda.
          await applyHandoff(conversationId, organizationId, "cita_agendada");
        } else if (turn.ok) {
          publish(organizationId, {
            type: "conversation.updated",
            data: { conversation: { id: conversationId } },
          });
        }
        return;
      } catch (err) {
        console.error(`[agente] el motor de agenda falló: ${err}`);
        action = degradeAction(action);
      }
    }
  }

  if (action.action === "move_stage") {
    const stage = resolveStage(action.stage, stages);
    if (!stage) {
      action = degradeAction(action);
    } else {
      await moveLeadToStage(organizationId, conversation.contactId, stage.id);
      publish(organizationId, {
        type: "conversation.updated",
        data: { conversation: { id: conversationId } },
      });
      if (action.reply) {
        await deliverReply(conversation, action.reply);
      }
      return;
    }
  }

  switch (action.action) {
    case "none":
      return;
    case "reply":
      await deliverReply(conversation, action.text);
      return;
    case "update_lead": {
      await appendLeadNote(organizationId, conversation.contactId, action.note);
      if (action.reply) await deliverReply(conversation, action.reply);
      return;
    }
    case "handoff": {
      if (action.farewell) {
        await deliverReply(conversation, action.farewell);
      }
      await applyHandoff(conversationId, organizationId, "modelo");
      return;
    }
  }
}

/** "viernes 4 de septiembre de 2026, 09:12 (America/Lima)". */
export function formatNow(date: Date, timezone: string): string {
  const text = new Intl.DateTimeFormat("es", {
    timeZone: timezone,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
  return `${text} (${timezone})`;
}

/** Texto fijo al escalar por la regex de respaldo (sin pasar por el modelo). */
const HANDOFF_FAREWELL = "Claro, te paso con un asesor ahora mismo. En un momento te atiende.";

type Conversation = typeof schema.conversation.$inferSelect;

/** Entrega la respuesta: envío real o persistencia sandbox (is_test). */
async function deliverReply(
  conversation: Conversation,
  text: string
): Promise<void> {
  if (conversation.isTest) {
    await persistTestOutbound(conversation, text);
    return;
  }
  try {
    await sendText({
      conversationId: conversation.id,
      organizationId: conversation.organizationId,
      text,
      aiGenerated: true,
    });
  } catch (err) {
    if (err instanceof SendError && err.code === "window_closed") {
      await applyHandoff(conversation.id, conversation.organizationId, "ventana");
      return;
    }
    throw err;
  }
}

/** Mensaje saliente del sandbox: se persiste, JAMÁS toca la API (FR-031). */
async function persistTestOutbound(
  conversation: Conversation,
  text: string
): Promise<void> {
  const db = getDb();
  await db.insert(schema.message).values({
    id: newId("message"),
    organizationId: conversation.organizationId,
    conversationId: conversation.id,
    direction: "out",
    type: "text",
    text,
    status: "sent",
    aiGenerated: true,
    origin: "ai",
  });
  await db
    .update(schema.conversation)
    .set({ lastMessageAt: new Date(), updatedAt: new Date() })
    .where(eq(schema.conversation.id, conversation.id));
}

/** Reintentos del turno por caída del proveedor, por conversación. */
const providerRetries = new Map<string, number>();

function bumpRetry(conversationId: string): number {
  const attempt = providerRetries.get(conversationId) ?? 0;
  providerRetries.set(conversationId, attempt + 1);
  return attempt;
}

function clearRetry(conversationId: string): void {
  providerRetries.delete(conversationId);
}

export async function applyHandoff(
  conversationId: string,
  organizationId: string,
  reason: "cliente" | "modelo" | "error" | "ventana" | "cita_agendada"
): Promise<void> {
  const db = getDb();
  const updated = await db
    .update(schema.conversation)
    .set({ handoffAt: new Date(), handoffReason: reason, updatedAt: new Date() })
    .where(eq(schema.conversation.id, conversationId))
    .returning();
  if (!updated[0]) return;
  publish(organizationId, {
    type: "conversation.updated",
    data: {
      conversation: { id: conversationId, handoffReason: reason },
    },
  });
}

async function moveLeadToStage(
  organizationId: string,
  contactId: string,
  stageId: string
): Promise<void> {
  const db = getDb();
  const rows = await db
    .select({ id: schema.lead.id })
    .from(schema.lead)
    .where(
      scoped(
        schema.lead.organizationId,
        organizationId,
        eq(schema.lead.contactId, contactId)
      )
    )
    .limit(1);
  const leadId = rows[0]?.id;
  if (!leadId) return;

  // Por la puerta única: el agente mueve tarjetas igual que el dueño, y su
  // movimiento tiene que quedar en la bitácora o el embudo mentirá sobre
  // quién hizo avanzar cada lead.
  await moveLeadThroughHistory({
    organizationId,
    leadId,
    toStageId: stageId,
    source: "bot",
    extra: { lastActivityAt: new Date() },
    // El agente no clasifica pérdidas: si su etapa destino resultara ser la
    // perdida, la puerta lo rechaza y el lead se queda donde está — mejor eso
    // que un motivo inventado.
  });
}

async function appendLeadNote(
  organizationId: string,
  contactId: string,
  note: string
): Promise<void> {
  const db = getDb();
  const rows = await db
    .select({ id: schema.contact.id, notes: schema.contact.notes })
    .from(schema.contact)
    .where(eq(schema.contact.id, contactId))
    .limit(1);
  const contact = rows[0];
  if (!contact) return;
  const stamped = `[IA] ${note}`;
  await db
    .update(schema.contact)
    .set({
      notes: contact.notes ? `${contact.notes}\n${stamped}` : stamped,
      updatedAt: new Date(),
    })
    .where(eq(schema.contact.id, contact.id));
}
