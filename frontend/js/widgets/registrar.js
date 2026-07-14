import { getAttributes, registerAction } from "../api/nucleo.js";

/** Form pra registrar uma ação — credita xp num atributo (ver app/actions.py). */
export async function render(el, widget) {
  let attributes;
  try {
    attributes = await getAttributes();
  } catch (err) {
    el.innerHTML = `<div class="empty-state">erro ao carregar categorias: ${err.message}</div>`;
    return;
  }
  const active = attributes.filter((a) => a.is_active);

  el.innerHTML = `
    <div class="field">
      <label>descrição</label>
      <input type="text" class="reg-desc" placeholder="o que você fez?">
    </div>
    <div class="field-row">
      <div class="field">
        <label>categoria</label>
        <select class="reg-cat">
          ${active.map((a) => `<option value="${a.name}">${a.name}</option>`).join("")}
        </select>
      </div>
      <div class="field">
        <label>xp</label>
        <input type="number" class="reg-xp" value="10" min="1">
      </div>
      <div class="field">
        <label>impacto (1-5)</label>
        <input type="number" class="reg-impact" value="3" min="1" max="5">
      </div>
    </div>
    <button class="btn primary reg-submit wg-anchor-bottom">registrar ação</button>
    <div class="reg-msg" style="display:none; color:var(--accent); font-size:10.5px; margin-top:6px;">registrado ✓</div>
    <div class="reg-error" style="display:none; color:var(--red); font-size:10.5px; margin-top:6px;"></div>
  `;

  const descEl = el.querySelector(".reg-desc");
  const catEl = el.querySelector(".reg-cat");
  const xpEl = el.querySelector(".reg-xp");
  const impactEl = el.querySelector(".reg-impact");
  const submitBtn = el.querySelector(".reg-submit");
  const msgEl = el.querySelector(".reg-msg");
  const errorEl = el.querySelector(".reg-error");

  submitBtn.addEventListener("click", async () => {
    const description = descEl.value.trim();
    if (!description) { descEl.focus(); return; }

    submitBtn.disabled = true;
    errorEl.style.display = "none";
    try {
      await registerAction({
        description,
        categories: [catEl.value],
        xp: parseInt(xpEl.value, 10) || 10,
        impact: parseInt(impactEl.value, 10) || 3,
      });
    } catch (err) {
      errorEl.textContent = `erro ao registrar: ${err.message}`;
      errorEl.style.display = "block";
      submitBtn.disabled = false;
      return;
    }
    submitBtn.disabled = false;
    descEl.value = "";
    msgEl.style.display = "block";
    setTimeout(() => (msgEl.style.display = "none"), 1800);

    // outros widgets abertos (attributes/log/priorities) escutam isso pra recarregar
    window.dispatchEvent(new CustomEvent("kami:action-registered"));
  });
}