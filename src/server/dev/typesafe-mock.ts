/**
 * Jev determinista para el self-test (mismo espíritu que ai-mock): responde
 * cada pregunta por reglas simples sobre `state.ultimo_mensaje`. Solo existe
 * tras el gate de mocks y cuando TYPESAFE_BASE_URL apunta aquí.
 */
type Q = { type: string; criteria?: Record<string, unknown> | unknown[] };
type State = {
  ultimo_mensaje?: string;
  horarios_ofrecidos?: { id: string; etiqueta: string }[];
  fichas?: { id: string; pregunta: string }[];
  archivos?: { id: string }[];
};

const norm = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

function choice(pick: string, criteria: Record<string, unknown>, confidence = 0.97) {
  const keys = Object.keys(criteria);
  const chosen = keys.includes(pick) ? pick : keys[keys.length - 1]!;
  const rest = keys.length > 1 ? (1 - confidence) / (keys.length - 1) : 0;
  return {
    type: "choice",
    choice: chosen,
    confidence,
    probabilities: Object.fromEntries(keys.map((k) => [k, k === chosen ? confidence : rest])),
  };
}

function intent(t: string): string {
  if (/ignora|instrucciones|prompt/.test(t)) return "fuera_de_tema";
  if (/estafa|porqueria/.test(t)) return "queja_hostil";
  if (/humano|persona real|un asesor/.test(t)) return "pedir_humano";
  if (/cancel|reprogram/.test(t)) return "cancelar_o_cambiar_cita";
  if (/precio|cuanto c|catalogo|lista de/.test(t)) return "pedir_precio_o_catalogo";
  if (/a las \d|primer horario|\d{1,2}:\d{2}/.test(t)) return "elegir_horario";
  if (/cita|agendar|reunion|llamada/.test(t)) return "agendar";
  if (/^(hola|buenas|buen dia)/.test(t)) return "saludo";
  if (/^(ok|gracias|perfecto|listo|dale|ya)\b/.test(t)) return "confirmacion";
  if (/chau|hasta luego|adios/.test(t)) return "despedida";
  if (t.includes("?")) return "pregunta_negocio";
  return "otro";
}

export function typesafeMockAnswers(
  state: State,
  questions: Record<string, Q>
): Record<string, unknown> {
  const t = norm(state.ultimo_mensaje ?? "");
  const out: Record<string, unknown> = {};
  for (const [id, q] of Object.entries(questions)) {
    const criteria = (q.criteria ?? {}) as Record<string, unknown>;
    if (q.type === "noul") {
      const yes =
        (id === "pide_humano" && /humano|persona real|un asesor/.test(t)) ||
        (id === "hostil" && /estafa|porqueria/.test(t)) ||
        (id === "inyeccion" && /ignora|instrucciones|prompt/.test(t));
      out[id] = { type: "noul", noul: yes ? 0.96 : 0.03 };
      continue;
    }
    if (q.type !== "choice") continue;
    if (id === "intencion") out[id] = choice(intent(t), criteria);
    else if (id === "ficha") {
      const words = t.split(/[^a-z0-9]+/).filter((w) => w.length >= 5);
      const hit = (state.fichas ?? []).find((f) => words.some((w) => norm(f.pregunta).includes(w)));
      out[id] = choice(hit?.id ?? "ninguna", criteria);
    } else if (id === "horario") {
      const hit =
        (state.horarios_ofrecidos ?? []).find((h) => {
          const m = h.etiqueta.match(/(\d{1,2}):(\d{2})/);
          return m ? t.includes(`${m[1]}:${m[2]}`) || t.includes(`a las ${Number(m[1])}`) : false;
        }) ?? (/primer/.test(t) ? state.horarios_ofrecidos?.[0] : undefined);
      out[id] = choice(hit?.id ?? "ninguno", criteria);
    } else if (id === "modalidad") {
      out[id] = choice(/llamada/.test(t) ? "llamada" : /oficina|local|tienda|presencial/.test(t) ? "presencial" : "no_dijo", criteria);
    } else if (id === "archivo") {
      out[id] = choice(/precio|catalogo|lista de/.test(t) && state.archivos?.[0] ? state.archivos[0].id : "ninguno", criteria);
    } else out[id] = choice(Object.keys(criteria).pop() ?? "", criteria);
  }
  return out;
}
