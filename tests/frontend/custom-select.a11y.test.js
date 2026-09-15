import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

function withDom(html, fn) {
  return async (t) => {
    const dom = new JSDOM(html, { url: "http://localhost/" });
    const previous = {
      window: globalThis.window,
      document: globalThis.document,
      Event: globalThis.Event,
      KeyboardEvent: globalThis.KeyboardEvent,
      scrollIntoView: dom.window.HTMLElement.prototype.scrollIntoView,
    };
    globalThis.window = dom.window;
    globalThis.document = dom.window.document;
    // o módulo cria `new Event(...)` sem passar pelo objeto `window` (é um
    // ES module solto, não um script rodando dentro do jsdom) — isso
    // resolve pro `Event` global do Node, que não é compatível com os
    // elementos do jsdom. Pra dispatchEvent funcionar, o construtor global
    // durante o teste precisa ser o mesmo realm do document.
    globalThis.Event = dom.window.Event;
    globalThis.KeyboardEvent = dom.window.KeyboardEvent;
    // jsdom não implementa layout, então scrollIntoView não existe —
    // mock inofensivo só pra não estourar dentro do handler de teclado.
    dom.window.HTMLElement.prototype.scrollIntoView = () => {};

    t.after(() => {
      globalThis.window = previous.window;
      globalThis.document = previous.document;
      globalThis.Event = previous.Event;
      globalThis.KeyboardEvent = previous.KeyboardEvent;
      dom.window.close();
    });

    await fn(dom);
  };
}

function fireKey(el, key) {
  const dom = el.ownerDocument.defaultView;
  el.dispatchEvent(new dom.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
}

test(
  "enhanceSelect monta o trigger com o padrão ARIA de combobox",
  withDom(
    `<label for="tm-conta">conta</label>
     <select id="tm-conta">
       <option value="1">Carteira</option>
       <option value="2">Banco X</option>
     </select>`,
    async () => {
      const { enhanceSelect } = await import("../../frontend/js/components/custom-select.js?a11y1");
      const select = document.getElementById("tm-conta");
      enhanceSelect(select);

      const trigger = select.nextElementSibling.querySelector(".csel-trigger");
      assert.equal(trigger.getAttribute("role"), "combobox");
      assert.equal(trigger.getAttribute("aria-haspopup"), "listbox");
      assert.equal(trigger.getAttribute("aria-expanded"), "false");
      assert.ok(trigger.getAttribute("aria-controls"), "trigger deve referenciar a listbox via aria-controls");

      const list = document.getElementById(trigger.getAttribute("aria-controls"));
      assert.equal(list.getAttribute("role"), "listbox");
      const options = list.querySelectorAll('[role="option"]');
      assert.equal(options.length, 2);
      assert.equal(options[0].getAttribute("aria-selected"), "true");
      assert.equal(options[1].getAttribute("aria-selected"), "false");

      // o <label for="tm-conta"> original aponta pro <select> escondido —
      // o trigger precisa ficar ligado nele via aria-labelledby, senão
      // fica sem nome acessível nenhum.
      const label = document.querySelector('label[for="tm-conta"]');
      assert.equal(trigger.getAttribute("aria-labelledby"), label.id);
    }
  )
);

test(
  "setas + Enter navegam e comitam a opção sem tirar o foco do trigger",
  withDom(
    `<select id="dm-status">
       <option value="ok">Em dia</option>
       <option value="atraso">Atrasada</option>
       <option value="quitada">Quitada</option>
     </select>`,
    async () => {
      const { enhanceSelect } = await import("../../frontend/js/components/custom-select.js?a11y2");
      const select = document.getElementById("dm-status");
      let changed = 0;
      select.addEventListener("change", () => changed++);
      enhanceSelect(select);

      const trigger = select.nextElementSibling.querySelector(".csel-trigger");

      fireKey(trigger, "ArrowDown"); // abre a lista, destaca a opção selecionada (index 0)
      assert.equal(trigger.getAttribute("aria-expanded"), "true");

      fireKey(trigger, "ArrowDown"); // desce pra "Atrasada"
      const activeId = trigger.getAttribute("aria-activedescendant");
      const activeOption = document.getElementById(activeId);
      assert.equal(activeOption.dataset.value, "atraso");

      fireKey(trigger, "Enter");
      assert.equal(select.value, "atraso");
      assert.equal(changed, 1);
      assert.equal(trigger.getAttribute("aria-expanded"), "false", "Enter deve fechar a lista depois de comitar");
    }
  )
);

test(
  "Escape fecha a lista sem propagar pro document (não fecha um modal por trás)",
  withDom(
    `<select id="cem-recurrence">
       <option value="none">Não repete</option>
       <option value="weekly">Semanal</option>
     </select>`,
    async () => {
      const { enhanceSelect } = await import("../../frontend/js/components/custom-select.js?a11y3");
      const select = document.getElementById("cem-recurrence");
      enhanceSelect(select);
      const trigger = select.nextElementSibling.querySelector(".csel-trigger");

      let bubbledToDocument = false;
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") bubbledToDocument = true;
      });

      fireKey(trigger, "ArrowDown");
      assert.equal(trigger.getAttribute("aria-expanded"), "true");

      fireKey(trigger, "Escape");
      assert.equal(trigger.getAttribute("aria-expanded"), "false");
      assert.equal(bubbledToDocument, false);
    }
  )
);
