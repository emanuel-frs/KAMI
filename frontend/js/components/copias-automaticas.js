import { verificarBackups } from "../api/backups.js";
import { showToast } from "./toast.js";

/**
 * Cópias automáticas do banco (CONF-08) — o lado do app aberto.
 *
 * O backend já confere a cópia semanal ao subir, mas o Kami pode ficar
 * dias aberto na bandeja (ORG-05): então o app pede a conferência um
 * pouco depois de abrir e de INTERVALO em INTERVALO. Só uma cópia sai por
 * semana (a regra é do backend — pedir de novo não custa nada).
 *
 * Se a pasta extra (pendrive, HD externo...) estiver há mais de 30 dias
 * sem receber cópia, avisa uma vez por sessão.
 */
const PRIMEIRA = 60 * 1000; // não disputa com a abertura do app
const INTERVALO = 6 * 60 * 60 * 1000;

let avisou = false;
let timer = null;

async function conferir() {
  let status;
  try {
    status = await verificarBackups();
  } catch {
    return; // backend fora ou bloqueado pelo PIN — tenta na próxima
  }
  if (status.extra_atrasada && !avisou) {
    avisou = true;
    showToast({
      title: "cópia na pasta extra atrasada",
      message: "faz mais de 30 dias que o kami não consegue copiar o banco pra sua pasta extra (pendrive ou disco desconectado?)",
      iconName: "triangle-alert",
      variant: "aviso",
      duration: 0,
      actions: [
        {
          label: "ver cópias",
          onClick: async () => {
            const { openConfiguracoesModal } = await import("../modals/configuracoes-modal.js");
            openConfiguracoesModal("backup");
            return true;
          },
        },
      ],
    });
  }
}

export function iniciarCopiasAutomaticas() {
  if (timer) return;
  timer = setTimeout(function rodada() {
    conferir();
    timer = setTimeout(rodada, INTERVALO);
  }, PRIMEIRA);
}
