import { executarAntesDeFechar } from "./antes-de-fechar.js";
import { abrirCaptura } from "./captura.js";
import { sendNativeNotification } from "./native-notify.js";
import { t } from "../i18n.js";

/**
 * components/bandeja.js — o lado do frontend da bandeja (ORG-05; Rust em
 * src-tauri/src/janela.rs). Três eventos:
 *   kami://captura    menu da bandeja › captura rápida → abre o Alt+Q
 *   kami://sair       menu da bandeja › sair → salva o pendente (nota
 *                     aberta…) e pede a saída de verdade
 *   kami://escondido  o ✕ escondeu o kami na bandeja → na PRIMEIRA vez,
 *                     uma notificação explicando onde ele foi (P-67)
 * Fora do Tauri (navegador em dev) não faz nada.
 */

const AVISO_KEY = "kami-bandeja-avisado-v1";

export function wireBandeja() {
  const tauri = window.__TAURI__;
  if (!tauri?.event?.listen) return;
  tauri.event.listen("kami://captura", () => abrirCaptura());
  tauri.event.listen("kami://sair", async () => {
    await executarAntesDeFechar();
    tauri.core.invoke("janela_sair");
  });
  tauri.event.listen("kami://escondido", () => {
    try {
      if (localStorage.getItem(AVISO_KEY)) return;
      localStorage.setItem(AVISO_KEY, "1");
    } catch {
      /* sem storage: avisa toda vez, sem problema */
    }
    sendNativeNotification({
      title: t("bandeja.o_kami_continua_na_bandeja"),
      body: t("bandeja.os_lembretes_seguem_funcionando_pra"),
    });
  });
}
