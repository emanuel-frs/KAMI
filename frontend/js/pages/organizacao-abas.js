/**
 * Organização — a ordem das abas é da pessoa (2026-11): segurar e arrastar
 * uma aba muda a ordem, e Shift+←/→ na aba focada faz o mesmo pelo
 * teclado. A primeira aba é a que abre ao entrar na tela. A ordem fica no
 * perfil (`org_abas`, ids separados por vírgula), então vai junto no
 * backup e não depende do armazenamento do navegador.
 *
 * `ordemDasAbas` e `moverAba` são puras (testadas sem DOM); `ligarAbas`
 * cuida do mouse e do teclado na barra `.tabs`.
 */
import { announce } from "../components/a11y.js";
import { t } from "../i18n.js";

export const ABAS = ["notas", "entrada", "github", "email", "links"];
const LIMIAR_PX = 6; // o quanto o mouse anda antes de virar arrasto (abaixo disso é clique)

/** A ordem salva, sem id desconhecido nem repetido; o que faltar vai pro fim. */
export function ordemDasAbas(salva) {
  const lista = typeof salva === "string" ? salva.split(",").map((s) => s.trim()) : Array.isArray(salva) ? salva : [];
  const vistas = [...new Set(lista.filter((id) => ABAS.includes(id)))];
  return [...vistas, ...ABAS.filter((id) => !vistas.includes(id))];
}

/** Nova lista com a aba `id` na posição `para` (limitada às pontas). */
export function moverAba(ordem, id, para) {
  const de = ordem.indexOf(id);
  if (de === -1) return [...ordem];
  const alvo = Math.max(0, Math.min(ordem.length - 1, para));
  const nova = ordem.filter((x) => x !== id);
  nova.splice(alvo, 0, id);
  return nova;
}

const ordemDoDom = (barra) => [...barra.querySelectorAll(".tab[data-tab]")].map((el) => el.dataset.tab);

/**
 * Liga arrastar e Shift+←/→ na barra de abas. `aoMudar(ordem)` grava a
 * ordem nova (a barra já está na ordem certa quando ele é chamado).
 * Devolve uma função que desliga tudo.
 */
export function ligarAbas(barra, { aoMudar }) {
  let arrasto = null; // { el, x0, ativo }
  let engolirClique = false;

  const anunciar = (id) => {
    const ordem = ordemDoDom(barra);
    announce(t("organizacao.aba_movida", { pos: ordem.indexOf(id) + 1, total: ordem.length }));
  };

  const onPointerDown = (e) => {
    const el = e.target.closest(".tab[data-tab]");
    if (!el || e.button !== 0) return;
    arrasto = { el, x0: e.clientX, ativo: false, antes: ordemDoDom(barra).join(",") };
  };

  const onPointerMove = (e) => {
    if (!arrasto) return;
    if (!arrasto.ativo) {
      if (Math.abs(e.clientX - arrasto.x0) < LIMIAR_PX) return;
      arrasto.ativo = true;
      arrasto.el.classList.add("tab--arrastando");
      document.body.classList.add("kami-dragging");
    }
    // a aba vai pra antes da primeira vizinha cujo meio está à direita do mouse
    const outras = [...barra.querySelectorAll(".tab[data-tab]")].filter((el) => el !== arrasto.el);
    const depois = outras.find((el) => {
      const r = el.getBoundingClientRect();
      return e.clientX < r.left + r.width / 2;
    });
    if (depois) {
      if (arrasto.el.nextElementSibling !== depois) barra.insertBefore(arrasto.el, depois);
    } else if (barra.lastElementChild !== arrasto.el) {
      barra.appendChild(arrasto.el);
    }
  };

  const onPointerUp = () => {
    if (!arrasto) return;
    const { el, ativo, antes } = arrasto;
    arrasto = null;
    if (!ativo) return; // foi clique: o handler de clique troca a aba
    el.classList.remove("tab--arrastando");
    document.body.classList.remove("kami-dragging");
    engolirClique = true; // soltar o mouse dispara um clique na aba: não é troca de aba
    setTimeout(() => { engolirClique = false; }, 0);
    const ordem = ordemDoDom(barra);
    if (ordem.join(",") !== antes) {
      anunciar(el.dataset.tab);
      aoMudar(ordem);
    }
  };

  const onClickCaptura = (e) => {
    if (engolirClique && e.target.closest(".tab[data-tab]")) {
      e.stopImmediatePropagation();
      e.preventDefault();
      engolirClique = false;
    }
  };

  const onKeydown = (e) => {
    const el = e.target.closest?.(".tab[data-tab]");
    if (!el || !e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    // antes do clickable-a11y (que trata ←/→ sem Shift como "ir pra aba")
    e.preventDefault();
    e.stopPropagation();
    const ordem = ordemDoDom(barra);
    const nova = moverAba(ordem, el.dataset.tab, ordem.indexOf(el.dataset.tab) + (e.key === "ArrowRight" ? 1 : -1));
    if (nova.join(",") === ordem.join(",")) return;
    for (const id of nova) barra.appendChild(barra.querySelector(`.tab[data-tab="${id}"]`));
    el.focus();
    anunciar(el.dataset.tab);
    aoMudar(nova);
  };

  barra.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  barra.addEventListener("click", onClickCaptura, true);
  barra.addEventListener("keydown", onKeydown);
  return () => {
    barra.removeEventListener("pointerdown", onPointerDown);
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    barra.removeEventListener("click", onClickCaptura, true);
    barra.removeEventListener("keydown", onKeydown);
    document.body.classList.remove("kami-dragging");
  };
}
