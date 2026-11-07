/**
 * EST-03 (P-195): menu recolhível. Com pouca largura (zoom alto, janela em
 * meia tela) o menu da esquerda ocupava um terço da tela e as telas
 * ficavam inutilizáveis. Até 940px de largura (em px do CSS, então o zoom
 * conta) ele sai do lado e vira um botão na barra de título que o abre
 * por cima, como num tablet: fecha ao escolher uma tela, com Esc ou
 * clicando fora, e fechado sai da ordem do Tab (inert).
 *
 * 940 e não 960: a janela tem 960px de largura mínima, então em 100% o
 * menu nunca recolhe; numa tela de 1366, recolhe a partir de 150%.
 */
import { icon } from "./icons.js";

export const LARGURA_RECOLHE = 940;

export function wireMenuRecolhivel() {
  const botao = document.getElementById("btn-menu");
  const menu = document.getElementById("sidebar");
  if (!botao || !menu || typeof window.matchMedia !== "function") return;
  botao.insertAdjacentHTML("beforeend", icon("menu", { size: 14 }));
  const fundo = document.createElement("div");
  fundo.className = "menu-fundo";
  menu.after(fundo);

  const mq = window.matchMedia(`(max-width: ${LARGURA_RECOLHE}px)`);
  let aberto = false;

  const aplicar = () => {
    const recolhido = mq.matches;
    document.body.classList.toggle("menu-recolhido", recolhido);
    document.body.classList.toggle("menu-aberto", recolhido && aberto);
    botao.hidden = !recolhido;
    botao.setAttribute("aria-expanded", String(recolhido && aberto));
    menu.toggleAttribute("inert", recolhido && !aberto);
  };
  const abrir = () => {
    aberto = true;
    aplicar();
    (menu.querySelector(".nav-link.active") || menu.querySelector(".nav-link"))?.focus();
  };
  const fechar = ({ devolverFoco = true } = {}) => {
    if (!aberto) return;
    aberto = false;
    aplicar();
    if (devolverFoco) botao.focus();
  };

  botao.addEventListener("click", () => (aberto ? fechar() : abrir()));
  fundo.addEventListener("click", () => fechar());
  // escolheu uma tela, o assistente, as notificações ou as configurações:
  // o menu sai da frente. A ajuda não: o menu dela abre preso ao botão.
  menu.addEventListener("click", (e) => {
    if (!aberto || e.target.closest("#btn-open-help")) return;
    if (e.target.closest(".nav-link, .sidebar-footer-actions button")) fechar({ devolverFoco: false });
  });
  menu.addEventListener("keydown", (e) => {
    if (aberto && e.key === "Enter" && e.target.closest(".nav-link")) fechar({ devolverFoco: false });
  });
  document.addEventListener("keydown", (e) => {
    if (aberto && e.key === "Escape") {
      e.stopPropagation();
      fechar();
    }
  }, true);
  mq.addEventListener("change", () => {
    aberto = false;
    aplicar();
  });
  aplicar();
}
