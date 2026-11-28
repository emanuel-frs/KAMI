// 2.1.0 — seletor de cor do Kami (components/seletor-cor.js).
import test from "node:test";
import assert from "node:assert/strict";
import { withDom } from "./helpers/dom.js";

test(
  "réguas e hex mudam a cor ao vivo; fechar entrega a cor final uma vez; Esc fecha",
  withDom('<body><div class="modal-backdrop"><button id="a">cor</button></div></body>', async (dom) => {
    const { abrirSeletorCor, fecharSeletorCor } = await import("../../frontend/js/components/seletor-cor.js");
    const ancora = document.getElementById("a");
    const mudancas = [];
    const finais = [];
    abrirSeletorCor(ancora, "#FF0000", { aoMudar: (c) => mudancas.push(c), aoFechar: (c) => finais.push(c), rotulo: "fundo" });
    const el = document.querySelector(".seletor-cor");
    assert.equal(el.parentNode, document.querySelector(".modal-backdrop"), "fica dentro do modal de quem abriu");
    assert.equal(el.hidden, false);
    assert.equal(el.getAttribute("aria-label"), "fundo");
    assert.equal(el.querySelector('[data-canal="h"]').value, "0");
    assert.equal(el.querySelector(".seletor-cor-hex").value, "#ff0000");

    // matiz 120 → verde
    const h = el.querySelector('[data-canal="h"]');
    h.value = "120";
    h.dispatchEvent(new dom.window.Event("input"));
    assert.equal(mudancas.at(-1), "#00ff00");

    // hex inválido volta; válido entra
    const hex = el.querySelector(".seletor-cor-hex");
    hex.value = "azul";
    hex.dispatchEvent(new dom.window.Event("change"));
    assert.equal(hex.value, "#00ff00");
    hex.value = "#0000FF";
    hex.dispatchEvent(new dom.window.Event("change"));
    assert.equal(mudancas.at(-1), "#0000ff");

    el.querySelector("[data-ok]").click();
    assert.equal(el.hidden, true);
    assert.deepEqual(finais, ["#0000ff"]);
    fecharSeletorCor(); // fechar de novo não entrega nada
    assert.deepEqual(finais, ["#0000ff"]);

    // abrir e sair sem mudar: nada a salvar
    abrirSeletorCor(ancora, "#123456", { aoFechar: (c) => finais.push(c) });
    el.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    assert.equal(el.hidden, true);
    assert.deepEqual(finais, ["#0000ff"]);

    // clique fora fecha
    abrirSeletorCor(ancora, "#123456", {});
    document.body.dispatchEvent(new dom.window.MouseEvent("mousedown", { bubbles: true }));
    assert.equal(el.hidden, true);
  })
);
