/**
 * Seletor de cor do Kami (2.1.0, aparência › cores): matiz, saturação e luz
 * em três réguas + o hex. Existe porque o <input type="color"> abre o
 * diálogo do GTK no Linux (fora do visual do app) e muda de cara em cada
 * sistema — este fica igual em todo lugar.
 *
 * abrirSeletorCor(ancora, cor, { aoMudar, aoFechar }): `aoMudar(hex)` a cada
 * passo (pra prévia ao vivo); `aoFechar(hex)` uma vez, ao sair (Esc, ok,
 * clique fora) — é quando se salva.
 */
import { HEX, deHsl, paraHsl } from "./aparencia.js";
import { t } from "../i18n.js";

let el = null;
let atual = null; // { cor, aoMudar, aoFechar, ancora }

function construir() {
  el = document.createElement("div");
  el.className = "seletor-cor";
  el.setAttribute("role", "dialog");
  el.hidden = true;
  el.innerHTML = `
    <div class="seletor-cor-previa"></div>
    ${["h", "s", "l"].map((c) => `
    <label class="seletor-cor-regua">
      <span>${t(`seletor_cor.${c}`)}</span>
      <input type="range" data-canal="${c}" min="0" max="${c === "h" ? 360 : 100}">
      <output></output>
    </label>`).join("")}
    <input class="seletor-cor-hex" maxlength="7" spellcheck="false" aria-label="${t("seletor_cor.hex")}">
    <div class="form-actions"><button type="button" class="btn sm" data-ok>${t("seletor_cor.ok")}</button></div>`;
  el.querySelectorAll("input[type=range]").forEach((r) =>
    r.addEventListener("input", () => {
      const [h, s, l] = ["h", "s", "l"].map((c) => +el.querySelector(`[data-canal="${c}"]`).value);
      mudar(deHsl(h, s, l), false);
    })
  );
  el.querySelector(".seletor-cor-hex").addEventListener("change", (e) => {
    const v = e.target.value.trim().toLowerCase();
    if (HEX.test(v)) mudar(v, true);
    else e.target.value = atual?.cor || "";
  });
  el.querySelector("[data-ok]").addEventListener("click", () => fecharSeletorCor());
  el.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.stopPropagation(); // não fecha o modal de configurações junto
      fecharSeletorCor();
    }
  });
  document.addEventListener("mousedown", (e) => {
    if (!el.hidden && !el.contains(e.target) && !atual?.ancora?.contains(e.target)) fecharSeletorCor();
  }, true);
}

function mostrar(dosHex) {
  const cor = atual.cor;
  el.querySelector(".seletor-cor-previa").style.background = cor;
  if (dosHex) {
    const hsl = paraHsl(cor);
    ["h", "s", "l"].forEach((c, i) => (el.querySelector(`[data-canal="${c}"]`).value = Math.round(hsl[i])));
  }
  el.querySelectorAll(".seletor-cor-regua").forEach((r) => (r.querySelector("output").textContent = r.querySelector("input").value));
  el.querySelector(".seletor-cor-hex").value = cor;
}

function mudar(cor, dosHex) {
  atual.cor = cor;
  mostrar(dosHex);
  atual.aoMudar?.(cor);
}

export function abrirSeletorCor(ancora, cor, { aoMudar, aoFechar, rotulo } = {}) {
  if (!el) construir();
  if (atual) fecharSeletorCor();
  atual = { cor: HEX.test(cor || "") ? cor.toLowerCase() : "#808080", aoMudar, aoFechar, ancora, inicial: cor };
  // dentro do modal de quem abriu (o clique nele não conta como "fora" do
  // modal, e o foco continua dentro do diálogo)
  const dono = ancora.closest(".modal-backdrop") || document.body;
  if (el.parentNode !== dono) dono.appendChild(el);
  el.setAttribute("aria-label", rotulo || t("seletor_cor.titulo"));
  el.hidden = false;
  const r = ancora.getBoundingClientRect();
  el.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - el.offsetWidth - 8))}px`;
  el.style.top = `${Math.max(8, Math.min(r.bottom + 6, window.innerHeight - el.offsetHeight - 8))}px`;
  mostrar(true);
  el.querySelector('[data-canal="h"]').focus();
}

export function fecharSeletorCor() {
  if (!el || el.hidden || !atual) return;
  const { cor, aoFechar, ancora, inicial } = atual;
  atual = null;
  el.hidden = true;
  if (cor !== inicial) aoFechar?.(cor);
  ancora?.focus?.();
}
