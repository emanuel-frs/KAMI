import { icon } from "./icons.js";

/**
 * Motor genérico de dicas contextuais por tela (etapa 5,
 * plano-onboarding-kami.md).
 *
 * Escurece a tela inteira exceto o elemento em destaque, mostra um
 * balão de texto apontando pra ele, e obriga o usuário a avançar
 * passo a passo — clicar fora não dispensa nada. A única saída
 * antecipada é "pular tudo", sempre visível no balão.
 *
 * Técnica de recorte: em vez de um único overlay com clip-path/
 * box-shadow (frágil no WebKitGTK do Tauri — já tivemos um bug real
 * de renderização de gradiente sub-pixel nesse motor, ver base.css),
 * uso 4 retângulos de sombreamento (topo/baixo/esquerda/direita) ao
 * redor do rect do alvo. O "buraco" no meio simplesmente não tem
 * nenhum elemento — cliques ali passam direto pro elemento real, o
 * que é exatamente o que o passo de interação real (advanceOn:
 * "interact") precisa, e os 4 retângulos bloqueiam clique em
 * qualquer outro lugar da tela sem precisar de nenhum recurso CSS
 * exótico.
 *
 * Genérico de propósito — não é específico do Núcleo. Cada tela
 * (financas.js, aprendizado.js etc., quando a etapa 5 for expandida
 * pra elas) importa e chama startTipSequence com sua própria lista de
 * passos. O botão de ajuda (etapa 6, "rever dicas desta tela") também
 * vai reusar isso, chamando de novo sem mexer no flag de "visto".
 *
 * Formato de cada passo:
 *   {
 *     selector: string,     // CSS selector do elemento a destacar
 *     text: string,         // texto do balão
 *     advanceOn: "button" | "interact",  // default: "button"
 *     onEnter: () => void,  // opcional, roda antes de posicionar o
 *                            // destaque neste passo (ex: trocar de aba
 *                            // numa tela com abas fixas — sem isso, um
 *                            // passo que aponta pra dentro de uma aba
 *                            // escondida (display:none) calcularia um
 *                            // retângulo 0x0 com getBoundingClientRect).
 *                            // Idempotente por natureza do caso de uso
 *                            // (chamar de novo numa aba já ativa não
 *                            // faz nada), então é seguro incluir em
 *                            // todo passo de um grupo, não só no
 *                            // primeiro.
 * }
 * "interact": em vez do botão genérico "próximo", a sequência avança
 * quando o usuário clica no próprio elemento em destaque (o clique
 * também chega no elemento normalmente — não fazemos
 * preventDefault/stopPropagation).
 */

let active = null; // estado da sequência em andamento (só uma por vez)

function buildDom() {
  const root = document.createElement("div");
  root.className = "tip-seq-root";
  root.innerHTML = `
    <div class="tip-shade tip-shade--top"></div>
    <div class="tip-shade tip-shade--bottom"></div>
    <div class="tip-shade tip-shade--left"></div>
    <div class="tip-shade tip-shade--right"></div>
    <div class="tip-highlight"></div>
    <div class="tip-balloon">
      <div class="tip-balloon-head">
        <span class="tip-step-label"></span>
        <span class="tip-skip" data-action="skip">pular tudo</span>
      </div>
      <p class="tip-text"></p>
      <div class="tip-balloon-foot">
        <span class="tip-interact-hint">toque no elemento em destaque para continuar</span>
        <button type="button" class="btn sm primary tip-next-btn">
          próximo ${icon("arrow-right", { size: 12 })}
        </button>
      </div>
    </div>
  `;
  document.body.appendChild(root);
  // bloqueia clique nos 4 retângulos de sombra (sem dispensar nada, só
  // absorve o clique — o "buraco" do meio não tem elemento, então
  // cliques ali já passam direto sem precisar de handler nenhum)
  root.querySelectorAll(".tip-shade").forEach((el) => el.addEventListener("click", (e) => e.stopPropagation()));
  root.querySelector('[data-action="skip"]').addEventListener("click", () => finish());
  root.querySelector(".tip-next-btn").addEventListener("click", () => advance());
  return root;
}

function titlebarHeight() {
  // janela frameless (ver base.css: .titlebar) — window.innerHeight/
  // getBoundingClientRect já incluem essa faixa no topo da viewport,
  // então sem descontar isso o balão pode ficar preso embaixo da
  // titlebar customizada (mesmo problema do clamp genérico: sobra
  // "espaço" na conta, mas é espaço ocupado pela titlebar, não
  // realmente livre). Lida via CSS var em vez de valor fixo pra não
  // duplicar o número de base.css.
  const raw = getComputedStyle(document.documentElement).getPropertyValue("--titlebar-h");
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : 0;
}

function positionAll() {
  if (!active) return;
  const { root, steps, index } = active;
  const step = steps[index];
  const target = document.querySelector(step.selector);
  if (!target) {
    // elemento sumiu do DOM entre passos (ex: layout mudou) — pula
    // esse passo silenciosamente em vez de travar a sequência
    advance();
    return;
  }
  active.currentTarget = target;

  const rect = target.getBoundingClientRect();
  const pad = 6; // respiro entre o card e o recorte
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const x1 = Math.max(0, rect.left - pad);
  const y1 = Math.max(0, rect.top - pad);
  const x2 = Math.min(vw, rect.right + pad);
  const y2 = Math.min(vh, rect.bottom + pad);

  const top = root.querySelector(".tip-shade--top");
  const bottom = root.querySelector(".tip-shade--bottom");
  const left = root.querySelector(".tip-shade--left");
  const right = root.querySelector(".tip-shade--right");
  const hl = root.querySelector(".tip-highlight");

  top.style.cssText = `top:0; left:0; right:0; height:${y1}px;`;
  bottom.style.cssText = `top:${y2}px; left:0; right:0; bottom:0;`;
  left.style.cssText = `top:${y1}px; left:0; width:${x1}px; height:${y2 - y1}px;`;
  right.style.cssText = `top:${y1}px; left:${x2}px; right:0; height:${y2 - y1}px;`;
  hl.style.cssText = `top:${y1}px; left:${x1}px; width:${x2 - x1}px; height:${y2 - y1}px;`;

  // balão: embaixo do alvo se couber, senão em cima, senão o lado com
  // mais espaço — sempre preso dentro da viewport (vertical e
  // horizontalmente). Antes decidíamos "embaixo" só pela distância do
  // alvo até a borda (spaceBelow > 160 || y1 < 160), o que ignorava a
  // altura real do balão: um alvo grande e alto (ex: #cal-grid do
  // Calendário, que ocupa quase a tela toda) tem y1 pequeno, então
  // caía sempre em "showBelow" mesmo sem espaço nenhum sobrando abaixo
  // — o balão saía por baixo da viewport. Agora medimos a altura real
  // (offsetHeight, já com o texto e a largura deste passo aplicados) e
  // sempre encaixamos (clamp) o `top` dentro de [titlebar + 12, vh -
  // altura - 12] — o limite de cima usa a altura real da titlebar
  // customizada (titlebarHeight()), não um valor fixo, senão o balão
  // ficava colado embaixo dela quando "em cima" era escolhido perto do
  // topo da janela (bug reportado depois do primeiro fix).
  const balloon = root.querySelector(".tip-balloon");
  const bw = Math.min(340, vw - 24);
  balloon.style.width = `${bw}px`;
  const bx = Math.min(Math.max(12, rect.left), vw - bw - 12);
  balloon.style.left = `${bx}px`;
  balloon.style.bottom = "";
  balloon.style.top = "0px"; // posição provisória só pra medir a altura real do conteúdo
  const bh = balloon.offsetHeight;

  const spaceBelow = vh - y2;
  const spaceAbove = y1 - titlebarHeight();
  const fitsBelow = spaceBelow >= bh + 20;
  const fitsAbove = spaceAbove >= bh + 20;
  // prefere embaixo quando cabe; senão em cima quando cabe; se nenhum
  // dos dois cabe de verdade (alvo maior que a viewport útil), fica do
  // lado com mais espaço mesmo que o balão acabe sobrepondo um pouco
  // o destaque — sempre melhor que vazar pra fora da tela.
  const showBelow = fitsBelow || (!fitsAbove && spaceBelow >= spaceAbove);
  balloon.classList.toggle("tip-balloon--above", !showBelow);

  let by = showBelow ? y2 + 10 : y1 - 10 - bh;
  const topMin = titlebarHeight() + 12;
  by = Math.max(topMin, Math.min(by, vh - bh - 12));
  balloon.style.top = `${by}px`;
}

function renderStep() {
  if (!active) return;
  const { root, steps, index } = active;
  const step = steps[index];
  const total = steps.length;
  const isLast = index === total - 1;
  const isInteract = step.advanceOn === "interact";

  root.querySelector(".tip-step-label").textContent = `${index + 1} / ${total}`;
  root.querySelector(".tip-text").textContent = step.text;

  step.onEnter?.();

  const nextBtn = root.querySelector(".tip-next-btn");
  const hint = root.querySelector(".tip-interact-hint");
  nextBtn.style.display = isInteract ? "none" : "";
  hint.style.display = isInteract ? "" : "none";
  if (!isInteract) {
    nextBtn.innerHTML = isLast ? `${icon("check", { size: 12 })} entendi` : `próximo ${icon("arrow-right", { size: 12 })}`;
  }

  positionAll();
  // positionAll() pode ter avançado a sequência de novo (elemento deste
  // passo sumiu do DOM) — se o índice mudou, uma chamada recursiva a
  // renderStep() já cuidou do passo novo; não continua usando as
  // variáveis (step/isInteract) desse passo que não existe mais.
  if (!active || active.index !== index) return;

  if (isInteract) {
    const target = active.currentTarget;
    if (target) {
      const onInteract = () => advance();
      target.addEventListener("click", onInteract, { once: true });
      active.interactCleanup = () => target.removeEventListener("click", onInteract);
    }
  }
}

function tick() {
  if (!active) return;
  positionAll();
  // positionAll() pode ter chamado advance() -> finish() (ex: elemento
  // sumiu do DOM no meio da sequência) e zerado `active` — reconfere
  // antes de reagendar, senão quebra tentando ler active.rafId de null
  if (!active) return;
  active.rafId = requestAnimationFrame(tick);
}

function advance() {
  if (!active) return;
  active.interactCleanup?.();
  active.interactCleanup = null;
  active.index++;
  if (active.index >= active.steps.length) {
    finish();
  } else {
    renderStep();
  }
}

function finish() {
  if (!active) return;
  const { root, onFinish, rafId } = active;
  active.interactCleanup?.();
  cancelAnimationFrame(rafId);
  root.remove();
  active = null;
  onFinish?.();
}

/**
 * Inicia a sequência. `steps` é filtrada pra só os elementos que
 * existem no DOM agora — se nenhum existir, chama onFinish() direto
 * sem mostrar nada (ex: usuário mexeu no grid antes de a sequência
 * rodar e removeu todos os widgets alvo).
 */
export function startTipSequence(steps, { onFinish } = {}) {
  if (active) return; // já tem uma sequência rodando — não empilha
  const resolved = steps.filter((s) => document.querySelector(s.selector));
  if (resolved.length === 0) {
    onFinish?.();
    return;
  }

  const root = buildDom();

  active = {
    root,
    steps: resolved,
    index: 0,
    onFinish,
    rafId: null,
    currentTarget: null,
    interactCleanup: null,
  };

  renderStep();
  // reposiciona a cada frame enquanto a sequência estiver na tela —
  // cobre resize de janela, scroll (main.page é overflow-y:auto, então
  // scroll não borbulha até window) e reflow assíncrono do conteúdo dos
  // widgets, sem precisar decidir de antemão qual causa vai acontecer
  active.rafId = requestAnimationFrame(tick);
}

/** Encerra a sequência ativa imediatamente, se houver uma — usado por segurança em unmount() de página. */
export function cancelActiveTipSequence() {
  if (active) finish();
}
