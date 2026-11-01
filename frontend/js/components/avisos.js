import { listAvisos, avisoNotificado } from "../api/avisos.js";
import { fmtMoney, fmtDataCompacta } from "./format.js";
import { notificarFora } from "./native-notify.js";
import { setPendingFocus } from "./pending-focus.js";
import { navigateTo } from "./navigate.js";
import { store } from "../state/store.js";
import { t } from "../i18n.js";

/**
 * components/avisos.js — avisos proativos (IA-06).
 *
 * As regras rodam no backend (app/avisos.py), sem IA: aqui só o agendador,
 * o texto padrão de cada aviso (P-134) e o que os botões do sino fazem.
 *
 *   - checa ao abrir o app e a cada 6 h (P-133); o sino checa de novo ao
 *     abrir, então um aviso que deixou de valer (conta paga) já some;
 *   - "conta sem saldo" também vira notificação do sistema, pela chave de
 *     vencimentos e na hora dos avisos (P-146), uma vez por conta+mês (o
 *     backend guarda que já notificou);
 *   - o badge do sino conta a última lista (sem rodar as regras a cada
 *     recontagem).
 */

const CHECK_MS = 6 * 60 * 60_000;
const HORA_MS = 5 * 60_000; // olha se já deu a hora da notificação
let ultimos = [];
let timers = [];
let rodando = false;

export const avisosAtuais = () => ultimos;

function avisarMudou() {
  window.dispatchEvent(new CustomEvent("kami:avisos-mudaram"));
}

/** Roda as regras e guarda a lista. Falha calada (PIN travado, backend fora). */
export async function checarAvisos() {
  if (rodando) return ultimos;
  rodando = true;
  try {
    ultimos = await listAvisos();
    avisarMudou();
    notificarSeDeuAHora();
  } catch {
    /* tenta na próxima */
  } finally {
    rodando = false;
  }
  return ultimos;
}

/** Tira da lista guardada (dispensado/silenciado pelo sino). */
export function tirarAviso(id) {
  ultimos = ultimos.filter((a) => a.id !== id);
  avisarMudou();
}

function quando(dias) {
  if (dias <= 0) return t("avisos.quando.hoje");
  if (dias === 1) return t("avisos.quando.amanha");
  return t("avisos.quando.em", { n: dias });
}

function nomeDoAlvo(a) {
  return a.regra === "atributo_esquecido" ? t(`atributo.${a.nome}`) : a.nome;
}

/** Texto padrão do aviso: { titulo, detalhe }. */
export function textoAviso(a) {
  const v = a.vars || {};
  const nome = nomeDoAlvo(a);
  switch (a.regra) {
    case "categoria_acima":
      return {
        titulo: t("avisos.categoria_acima.titulo", { categoria: nome }),
        detalhe: t("avisos.categoria_acima.detalhe", { valor_mes: fmtMoney(v.valor_mes), pct: v.pct, valor_anterior: fmtMoney(v.valor_anterior) }),
      };
    case "conta_sem_saldo":
      return {
        titulo: t("avisos.conta_sem_saldo.titulo", { conta: nome, quando: quando(v.dias) }),
        detalhe: v.conta_carteira
          ? t("avisos.conta_sem_saldo.detalhe_conta", { valor: fmtMoney(v.valor), valor_saldo: fmtMoney(v.valor_saldo), conta: v.conta_carteira })
          : t("avisos.conta_sem_saldo.detalhe", { valor: fmtMoney(v.valor), valor_saldo: fmtMoney(v.valor_saldo) }),
      };
    case "meta_parada":
      return {
        titulo: t("avisos.meta_parada.titulo", { meta: nome }),
        detalhe: t(v.aporte ? "avisos.meta_parada.detalhe" : "avisos.meta_parada.detalhe_nunca", { n: v.dias }),
      };
    case "atributo_esquecido":
      return {
        titulo: t("avisos.atributo_esquecido.titulo", { atributo: nome, n: v.dias }),
        detalhe: t("avisos.atributo_esquecido.detalhe"),
      };
    case "trilha_parada":
      return {
        titulo: t("avisos.trilha_parada.titulo", { trilha: nome }),
        detalhe: t(v.concluiu ? "avisos.trilha_parada.detalhe" : "avisos.trilha_parada.detalhe_nunca", { n: v.dias }),
      };
    default:
      return { titulo: nome, detalhe: "" };
  }
}

/** A pergunta que o "perguntar ao assistente" deixa pronta (P-134). */
export function perguntaAviso(a) {
  const v = a.vars || {};
  const nome = nomeDoAlvo(a);
  const vars = {
    categoria_acima: { categoria: nome, pct: v.pct, valor_mes: fmtMoney(v.valor_mes), valor_anterior: fmtMoney(v.valor_anterior) },
    conta_sem_saldo: { conta: nome, valor: fmtMoney(v.valor), data: v.data ? fmtDataCompacta(v.data) : "", valor_saldo: fmtMoney(v.valor_saldo) },
    meta_parada: { meta: nome, n: v.dias },
    atributo_esquecido: { atributo: nome, n: v.dias },
    trilha_parada: { trilha: nome, n: v.dias },
  }[a.regra];
  return vars ? t(`avisos.${a.regra}.pergunta`, vars) : nome;
}

/** [abrir]: a tela do item (com foco nele quando a tela sabe focar). */
export function abrirAlvo(a) {
  const destino = {
    categoria_acima: ["financas"],
    conta_sem_saldo: ["financas", "conta_fixa"],
    meta_parada: ["metas", "meta"],
    atributo_esquecido: ["nucleo"],
    trilha_parada: ["aprendizado", "trilha"],
  }[a.regra];
  if (!destino) return;
  const [tela, foco] = destino;
  if (foco) setPendingFocus(foco, a.alvo_id);
  navigateTo(tela);
}

// P-146: "conta sem saldo" sai do app na hora dos avisos (padrão 9h)
function notificarSeDeuAHora() {
  const perfil = store.get("profile");
  const [h, m] = (perfil?.avisos_hora || "09:00").split(":").map(Number);
  const agora = new Date();
  if (agora.getHours() * 60 + agora.getMinutes() < h * 60 + m) return;
  for (const a of ultimos) {
    if (a.regra !== "conta_sem_saldo" || a.notificado) continue;
    a.notificado = true;
    const { titulo, detalhe } = textoAviso(a);
    notificarFora("vencimentos", { title: `kami — ${titulo}`, body: detalhe }, perfil);
    avisoNotificado(a.id).catch(() => {});
  }
}

export function startAvisosAgendador() {
  if (timers.length) return;
  checarAvisos();
  timers = [setInterval(checarAvisos, CHECK_MS), setInterval(notificarSeDeuAHora, HORA_MS)];
}
