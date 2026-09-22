import { JSDOM } from "jsdom";

/**
 * Monta um jsdom e substitui os globals que os módulos de frontend
 * esperam (window/document/Event/KeyboardEvent) durante o teste,
 * restaurando tudo no fim — mesmo padrão manual já usado em
 * custom-select.a11y.test.js, centralizado aqui pra não duplicar em
 * cada arquivo novo que precisa de DOM.
 */
export function withDom(html, fn) {
  return async (t) => {
    const dom = new JSDOM(html, { url: "http://localhost/" });
    const previous = {
      window: globalThis.window,
      document: globalThis.document,
      Event: globalThis.Event,
      KeyboardEvent: globalThis.KeyboardEvent,
    };
    globalThis.window = dom.window;
    globalThis.document = dom.window.document;
    globalThis.Event = dom.window.Event;
    globalThis.KeyboardEvent = dom.window.KeyboardEvent;

    t.after(() => {
      globalThis.window = previous.window;
      globalThis.document = previous.document;
      globalThis.Event = previous.Event;
      globalThis.KeyboardEvent = previous.KeyboardEvent;
      dom.window.close();
    });

    await fn(dom, t);
  };
}
