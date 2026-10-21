import { dispararLembretes, adiarLembrete, dispensarLembrete } from "../api/lembretes.js";
import { showToast } from "./toast.js";
import { notificarFora } from "./native-notify.js";
import { store } from "../state/store.js";

/**
 * components/lembretes-agendador.js — dispara os lembretes (ORG-05).
 *
 * A cada CHECK_MS pergunta ao backend (POST /api/lembretes/disparar) o que
 * venceu; o backend já marca como pendente (sino) e pula pra próxima
 * ocorrência, então duas checagens nunca disparam o mesmo lembrete.
 *
 *   - na hora: aviso dentro do app com "adiar 10 min / 1 h / amanhã" e
 *     "ok" (P-64) + notificação do sistema, se ligada em configurações;
 *   - "que passaram" (app fechado, P-65): sem barulho um por um — um aviso
 *     só dizendo quantos, e eles ficam no sino.
 *
 * Com o PIN travado a API responde "bloqueado": a checagem só falha
 * calada e tenta de novo depois (o lembrete continua vencido no backend
 * e dispara assim que destravar).
 */

const CHECK_MS = 30_000;
let timer = null;
let rodando = false;
// aviso aberto de cada lembrete (id -> fechar), pra o sino poder fechar o
// aviso quando a pessoa resolve por lá
const avisosAbertos = new Map();

export function fecharAvisoDoLembrete(id) {
  avisosAbertos.get(id)?.();
  avisosAbertos.delete(id);
}

function avisarMudou() {
  window.dispatchEvent(new CustomEvent("kami:lembretes-mudaram"));
}

function quandoTexto(l) {
  const [, hora] = (l.pendente_quando || "").split("T");
  return hora ? `às ${hora}` : "";
}

/** As ações do aviso — também usadas pelo sino (notificacoes-modal.js). */
export const ADIAMENTOS = [
  { rotulo: "10 min", quanto: { minutos: 10 } },
  { rotulo: "1 h", quanto: { minutos: 60 } },
  { rotulo: "amanhã", quanto: { amanha: true } },
];

// devolve true: o toast fecha (ver toast.js — ação só fecha se pedir)
async function adiar(id, quanto) {
  try {
    await adiarLembrete(id, quanto);
  } finally {
    avisarMudou();
  }
  return true;
}

function avisoNaHora(l) {
  fecharAvisoDoLembrete(l.id);
  const fechar = showToast({
    title: l.titulo,
    message: `lembrete ${quandoTexto(l)}${l.vinculo ? ` · ${l.vinculo.nome}` : ""}`,
    iconName: "bell-ring",
    duration: 0, // fica até a pessoa responder; fechar no ✕ deixa no sino
    actions: [
      ...ADIAMENTOS.map((a) => ({ label: `adiar ${a.rotulo}`, onClick: () => adiar(l.id, a.quanto) })),
      {
        label: "ok",
        onClick: async () => {
          await dispensarLembrete(l.id).catch(() => {});
          avisarMudou();
          return true;
        },
      },
    ],
  });
  avisosAbertos.set(l.id, fechar);
  notificarFora("lembretes", { title: `kami — ${l.titulo}`, body: `lembrete ${quandoTexto(l)}` }, store.get("profile"));
}

export async function checarLembretes() {
  if (rodando) return;
  rodando = true;
  try {
    const disparados = await dispararLembretes();
    if (!disparados.length) return;
    const naHora = disparados.filter((l) => !l.atrasado);
    const passaram = disparados.filter((l) => l.atrasado);
    naHora.forEach(avisoNaHora);
    if (passaram.length) {
      const titulo = passaram.length === 1 ? "1 lembrete passou" : `${passaram.length} lembretes passaram`;
      showToast({
        title: titulo,
        message: passaram.length === 1 ? passaram[0].titulo : "enquanto o kami estava fechado — estão no sino",
        iconName: "bell-ring",
        duration: 10000,
        onClick: async () => (await import("../modals/notificacoes-modal.js")).openNotificacoesModal(),
      });
    }
    avisarMudou();
  } catch {
    /* travado pelo PIN ou backend fora: tenta na próxima */
  } finally {
    rodando = false;
  }
}

export function startLembretesAgendador() {
  if (timer) return;
  checarLembretes();
  timer = setInterval(checarLembretes, CHECK_MS);
}
