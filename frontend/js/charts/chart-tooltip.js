/**
 * Tooltip customizado pra elementos de gráfico SVG.
 *
 * Antes disso os gráficos usavam <title> nativo do SVG — funciona, mas
 * quem desenha esse tooltip é o navegador/OS, então ele sai com fonte,
 * cor e borda completamente fora do tema do sistema (ver feedback).
 * Aqui a gente troca por um <div>.chart-tooltip normal, estilizado via
 * CSS igual o resto do app, e movido via mousemove.
 *
 * Uso: os elementos do SVG usam `data-tip="texto"` em vez de <title>,
 * e o container (o wrapper que envolve o <svg>, com position:relative)
 * chama attachChartTooltip(container) uma vez após o innerHTML ser
 * montado.
 */
export function attachChartTooltip(container) {
  let tipEl = container.querySelector(":scope > .chart-tooltip");
  if (!tipEl) {
    tipEl = document.createElement("div");
    tipEl.className = "chart-tooltip";
    container.appendChild(tipEl);
  }

  function targetOf(evt) {
    return evt.target.closest ? evt.target.closest("[data-tip]") : null;
  }

  function move(evt) {
    const rect = container.getBoundingClientRect();
    let x = evt.clientX - rect.left + 12;
    let y = evt.clientY - rect.top - 10;

    const maxX = rect.width - tipEl.offsetWidth - 4;
    if (x > maxX) x = evt.clientX - rect.left - tipEl.offsetWidth - 12;
    if (x < 0) x = 4;
    if (y < 0) y = 4;

    tipEl.style.left = `${x}px`;
    tipEl.style.top = `${y}px`;
  }

  container.addEventListener("mouseover", (evt) => {
    const target = targetOf(evt);
    if (!target) return;
    tipEl.textContent = target.getAttribute("data-tip") || "";
    tipEl.classList.add("visible");
    move(evt);
  });

  container.addEventListener("mousemove", (evt) => {
    if (!tipEl.classList.contains("visible")) return;
    if (!targetOf(evt)) return;
    move(evt);
  });

  container.addEventListener("mouseout", (evt) => {
    const leavingTarget = targetOf(evt);
    if (!leavingTarget) return;
    const enteringTarget = evt.relatedTarget && evt.relatedTarget.closest
      ? evt.relatedTarget.closest("[data-tip]")
      : null;
    if (!enteringTarget) tipEl.classList.remove("visible");
  });
}
