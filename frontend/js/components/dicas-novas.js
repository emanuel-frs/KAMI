import { store } from "../state/store.js";
import { getDicasVistas, marcarDicasVistas } from "../api/perfil.js";
import { startTipSequence } from "./tip-sequence.js";

/**
 * Dicas que a pessoa ainda não viu, uma a uma (MAN-05).
 *
 * Até a 1.13 o "visto" era POR TELA (`screen_tips_seen`): uma dica
 * acrescentada depois nunca aparecia pra quem já tinha passado pela
 * tela, e a dica de um elemento que ainda não existia quando a sequência
 * rodou (ex.: a grade de hábitos, com a tela vazia) era perdida — a tela
 * ficava marcada como vista mesmo assim. Agora cada dica tem um `id`
 * (escrito à mão no *-tips.js de cada tela; os de widget vêm de
 * widget-tips.js) e só a dica que APARECEU (ou foi pulada com "pular
 * tudo") é marcada.
 *
 * Regras:
 *   - roda só ao abrir a tela, uma vez por visita (`novaVisitaDeTela`,
 *     chamado pelo app.js a cada troca de tela) — nunca no meio de uma
 *     ação, mesmo que o perfil mude (o subscribe das telas existe pra
 *     disparar logo depois do tour geral);
 *   - quem já tinha visto a tela no esquema antigo fica com as dicas que
 *     existiam até a 1.12 (`ate112` de cada tela) contadas como vistas;
 *   - texto de dica mudou e vale mostrar de novo? troque o `id` dela (e
 *     não ponha o novo em `ate112`) — é o que fez as 4 dicas reescritas
 *     na 1.13 voltarem como novidade;
 *   - quem já viu alguma dica da tela vê as novas com o rótulo
 *     "novidade"; quem nunca viu vê a sequência inteira, sem rótulo.
 *
 * "Rever dicas desta tela" (botão de ajuda) não passa por aqui: mostra
 * tudo e não marca nada.
 */

const avaliadas = new Set();

/** app.js chama a cada troca de tela: a próxima abertura avalia de novo. */
export function novaVisitaDeTela() {
  avaliadas.clear();
}

/** Função pura (testada): os passos ainda não vistos de `tela`. */
export function dicasPendentes(tela, passos, { vistas = [], telas_antigas = [] } = {}, ate112 = []) {
  const vistasSet = new Set(vistas);
  const legado = telas_antigas.includes(tela) ? new Set(ate112) : new Set();
  return passos.filter((p) => !vistasSet.has(`${tela}/${p.id}`) && !legado.has(p.id));
}

/** Função pura: a pessoa já viu alguma dica desta tela antes? */
export function jaViuATela(tela, { vistas = [], telas_antigas = [] } = {}) {
  return telas_antigas.includes(tela) || vistas.some((d) => d.startsWith(`${tela}/`));
}

/**
 * Mostra as dicas novas da tela, se houver.
 *   tela    — chave da tela ('nucleo', 'habitos'…)
 *   passos  — função que monta os passos NA HORA (as de widget dependem
 *             do grid montado)
 *   ate112  — ids que já existiam até a 1.12
 *   antes / depois — ex.: travar e destravar o grid durante a sequência
 */
export async function mostrarDicasNovas({ tela, passos, ate112 = [], antes, depois }) {
  if (avaliadas.has(tela)) return;
  if (!store.get("profile")?.onboarding_completed) return; // o tour geral vem antes
  avaliadas.add(tela);

  let estado;
  try {
    estado = await getDicasVistas();
  } catch (err) {
    // não trava nada — tenta de novo na próxima visita
    console.error(`erro ao checar as dicas já vistas (${tela}):`, err);
    avaliadas.delete(tela);
    return;
  }

  const pendentes = dicasPendentes(tela, passos(), estado, ate112);
  if (pendentes.length === 0) return;

  antes?.();
  const iniciou = startTipSequence(pendentes, {
    rotulo: jaViuATela(tela, estado) ? "novidade" : null,
    onFinish: async ({ mostrados, pulados }) => {
      depois?.();
      const ids = [...mostrados, ...pulados];
      if (ids.length === 0) return; // nenhum elemento na tela — fica pra próxima visita
      try {
        await marcarDicasVistas(ids.map((id) => `${tela}/${id}`));
      } catch (err) {
        // pior caso: as mesmas dicas aparecem na próxima visita
        console.error(`erro ao marcar dicas como vistas (${tela}):`, err);
      }
    },
  });
  if (!iniciou) {
    depois?.();
    avaliadas.delete(tela);
  }
}
