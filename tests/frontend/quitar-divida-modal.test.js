// P-13 (CONF-04) — modal de quitar dívida (modals/quitar-divida-modal.js).
import test from "node:test";
import assert from "node:assert/strict";
import { withDom } from "./helpers/dom.js";

const ACCOUNTS = [
  { id: "cartao", nome: "Cartão", bankNome: "Banco", possui_saldo: false, possui_credito: true },
  { id: "corrente", nome: "Corrente", bankNome: "Banco", possui_saldo: true, possui_credito: false },
  { id: "misto", nome: "Misto", bankNome: "Outro", possui_saldo: true, possui_credito: true },
];

function setup(dom, t) {
  globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
  dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  t.after(() => delete globalThis.requestAnimationFrame);
}

test(
  "sugere a primeira conta com saldo (não o cartão) e devolve a escolha",
  withDom("<body></body>", async (dom, t) => {
    setup(dom, t);
    const { openQuitarDividaModal } = await import("../../frontend/js/modals/quitar-divida-modal.js");
    const result = openQuitarDividaModal({ debt: { description: "empréstimo", amount: 300 }, accounts: ACCOUNTS });
    const doc = dom.window.document;
    assert.equal(doc.querySelector("#qdm-conta").value, "corrente");
    assert.match(doc.querySelector("#qdm-info").textContent, /empréstimo — R\$ 300,00/);
    doc.querySelector('#quitar-divida-modal [data-action="confirm"]').click();
    assert.deepEqual(await result, { conta_id: "corrente", forma_pagamento: null });
  })
);

test(
  "'nenhuma conta' quita sem lançar saída; conta com saldo e crédito pede a forma",
  withDom("<body></body>", async (dom, t) => {
    setup(dom, t);
    const { openQuitarDividaModal } = await import("../../frontend/js/modals/quitar-divida-modal.js");
    const doc = dom.window.document;

    let result = openQuitarDividaModal({ debt: { description: "x", amount: 1 }, accounts: ACCOUNTS });
    doc.querySelector("#qdm-conta").value = "";
    doc.querySelector('#quitar-divida-modal [data-action="confirm"]').click();
    assert.deepEqual(await result, { conta_id: null, forma_pagamento: null });

    result = openQuitarDividaModal({ debt: { description: "x", amount: 1 }, accounts: ACCOUNTS });
    const sel = doc.querySelector("#qdm-conta");
    sel.value = "misto";
    sel.dispatchEvent(new dom.window.Event("change"));
    assert.equal(doc.querySelector("#qdm-forma-field").style.display, "block");
    doc.querySelector("#qdm-forma").value = "credito";
    doc.querySelector('#quitar-divida-modal [data-action="confirm"]').click();
    assert.deepEqual(await result, { conta_id: "misto", forma_pagamento: "credito" });
  })
);

test(
  "cancelar devolve null (o widget recarrega e o select volta pra 'aberta')",
  withDom("<body></body>", async (dom, t) => {
    setup(dom, t);
    const { openQuitarDividaModal } = await import("../../frontend/js/modals/quitar-divida-modal.js");
    const result = openQuitarDividaModal({ debt: { description: "x", amount: 1 }, accounts: ACCOUNTS });
    dom.window.document.querySelector('#quitar-divida-modal [data-action="cancel"]').click();
    assert.equal(await result, null);
  })
);
