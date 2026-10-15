import test from "node:test";
import assert from "node:assert/strict";
import { withDom } from "./helpers/dom.js";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test(
  "sons (GAM-13): liga/desliga e grupos independentes, 'ouvir' força, buffer montado uma vez",
  withDom("<body></body>", async (dom, t) => {
    // AudioContext falso: conta quantas notas tocaram e quantos buffers
    // foram montados
    let started = 0;
    let built = 0;
    class FakeContext {
      constructor() { this.state = "running"; this.destination = {}; this.currentTime = 0; }
      createBuffer() { built++; return { getChannelData: () => ({ set() {} }) }; }
      createBufferSource() { return { playbackRate: {}, connect: () => ({ connect() {} }), start: () => started++ }; }
      createGain() { return { gain: {}, connect() {} }; }
      resume() {}
    }
    globalThis.AudioContext = FakeContext;
    globalThis.StereoPannerNode = class {};
    t.after(() => {
      delete globalThis.AudioContext;
      delete globalThis.StereoPannerNode;
    });

    const { store } = await import("../../frontend/js/state/store.js");
    const { playSound, soundAllowed, SOUNDS } = await import("../../frontend/js/components/sound.js");

    // som desligado nas configurações: nada toca
    store.set("profile", { som_ativo: false, som_volume: 60, som_progresso: true, som_interface: false, som_avisos: true });
    assert.equal(soundAllowed("conquista"), false);
    await playSound("conquista");
    await wait(300);
    assert.equal(started, 0);

    // ligado: progresso e avisos tocam, interface não (desligada neste perfil)
    store.set("profile", { ...store.get("profile"), som_ativo: true });
    assert.deepEqual(["xp", "aviso", "clique"].map((n) => soundAllowed(n)), [true, true, false]);
    await playSound("conquista");
    await wait(300);
    assert.equal(started, SOUNDS.conquista.notes.length); // uma nota por bipe do arpejo

    // de novo: as notas tocam, mas o buffer de cada uma já estava pronto
    const builtBefore = built;
    playSound("conquista");
    assert.equal(started, SOUNDS.conquista.notes.length * 2);
    assert.equal(built, builtBefore);

    // "ouvir" toca mesmo com o grupo/som desligado
    started = 0;
    store.set("profile", { ...store.get("profile"), som_ativo: false });
    await playSound("clique", { force: true });
    await wait(50);
    assert.equal(started, 1);
    assert.equal(soundAllowed("nao-existe"), false);
  })
);

test(
  "clickSoundFor: cada tipo de controle tem o seu som (GAM-13)",
  withDom(
    `<nav><a class="nav-link" href="#x" id="nav">x</a></nav>
     <button class="btn" id="plain">ok</button>
     <button class="btn primary" id="primary">salvar</button>
     <button class="btn danger" id="danger">apagar</button>
     <button class="cfg-tab" data-tab="perfil" id="tab">perfil</button>
     <button class="ach-filter" aria-pressed="false" id="chip">área</button>
     <label id="checklabel"><input type="checkbox" id="check"> som</label>
     <label for="name" id="textlabel">nome</label><input type="text" id="name">
     <button class="close" data-action="close" id="close">x</button>
     <a href="blob:x" download="a.txt" id="dl">baixar</a>
     <div id="pointer" style="cursor:pointer"><span id="inner">clicável</span></div>
     <p id="text">texto solto</p>
     <button class="btn" id="disabled" disabled>indisponível</button>
     <div class="tabs"><span class="tab" id="spantab">resumo</span></div>
     <div class="nbell-item" id="bell"><span class="nbell-main">aviso</span><small id="bellmeta">ontem</small></div>`,
    async () => {
      const { clickSoundFor } = await import("../../frontend/js/components/sound.js");
      globalThis.getComputedStyle = window.getComputedStyle;
      const s = (id) => clickSoundFor(document.getElementById(id));
      assert.deepEqual(
        ["plain", "primary", "danger", "tab", "chip", "check", "checklabel", "dl", "inner"].map(s),
        ["clique", "confirmar", "perigo", "aba", "alternar", "alternar", "alternar", "download", "clique"]
      );
      // todo botão tem som: nav lateral e fechar também, cada um com o seu
      assert.deepEqual(["nav", "close"].map(s), ["navegar", "fechar"]);
      // sem som: campo de texto, o label dele e texto solto (não são botões)
      assert.deepEqual(["name", "textlabel", "text"].map(s), [null, null, null]);
      // botão desabilitado não faz nada; aba em <span> e contêiner clicável
      // da lista de clickable-a11y.js (fora do proxy) também têm som
      assert.deepEqual(["disabled", "spantab", "bellmeta"].map(s), [null, "aba", "clique"]);
      delete globalThis.getComputedStyle;
    }
  )
);

test(
  "ganchos (GAM-13): clique toca ao pressionar, abrir janela sempre toca, abertura espera o perfil",
  withDom(
    `<button class="btn" id="b">ok</button><div class="modal-backdrop" id="m"></div>`,
    async (dom, t) => {
      const played = [];
      class FakeContext {
        constructor() { this.state = "running"; this.destination = {}; this.currentTime = 0; }
        createBuffer() { return { getChannelData: () => ({ set() {} }) }; }
        createBufferSource() { return { connect() {}, start: () => played.push(1) }; }
        createGain() { return { gain: {}, connect() {} }; }
        resume() {}
      }
      globalThis.AudioContext = FakeContext;
      globalThis.MutationObserver = dom.window.MutationObserver;
      globalThis.getComputedStyle = dom.window.getComputedStyle;
      t.after(() => {
        delete globalThis.AudioContext;
        delete globalThis.MutationObserver;
        delete globalThis.getComputedStyle;
      });

      const { store } = await import("../../frontend/js/state/store.js");
      const sound = await import("../../frontend/js/components/sound.js");
      // o ZzFX já foi carregado (e fica em cache) no teste de cima: troca o contexto dele
      const { ZZFX } = await import("../../frontend/js/vendor/zzfx.js");
      ZZFX.audioContext = new FakeContext();
      store.set("profile", null);
      sound.wireSounds();

      // abertura antes do perfil: espera; com o perfil, toca
      const cancel = sound.playWhenReady("abertura");
      assert.equal(typeof cancel, "function");
      store.set("profile", { som_ativo: true, som_volume: 60, som_progresso: true, som_interface: true, som_avisos: true });
      await wait(20);
      const afterOpening = played.length;
      assert.equal(afterOpening, sound.SOUNDS.abertura.notes.length);

      const b = document.getElementById("b");
      // mouse: toca no pointerdown, o click que vem depois fica quieto
      b.dispatchEvent(new dom.window.MouseEvent("pointerdown", { bubbles: true, button: 0 }));
      assert.equal(played.length, afterOpening + 1);
      b.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, detail: 1 }));
      assert.equal(played.length, afterOpening + 1);
      // teclado (Enter/Espaço → click com detail 0) toca no click
      await wait(70); // passa o dedup
      b.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, detail: 0 }));
      assert.equal(played.length, afterOpening + 2);
      // botão direito não é clique
      b.dispatchEvent(new dom.window.MouseEvent("pointerdown", { bubbles: true, button: 2 }));
      assert.equal(played.length, afterOpening + 2);

      // janela abrindo logo depois de um clique: toca "abrir" mesmo assim
      document.getElementById("m").classList.add("open");
      await wait(0);
      assert.equal(played.length, afterOpening + 2 + sound.SOUNDS.abrir.notes.length);
    }
  )
);

test(
  "motor (GAM-13): saída única, nota liberada ao terminar, no máximo 16 notas de uma vez",
  withDom("<body></body>", async () => {
    const sources = [];
    let gains = 0;
    class FakeContext {
      constructor() { this.state = "running"; this.destination = {}; this.currentTime = 0; }
      createBuffer() { return { getChannelData: () => ({ set() {} }) }; }
      createBufferSource() {
        const src = { stopped: false, disconnected: false, connect() {}, start() {} };
        src.stop = () => (src.stopped = true);
        src.disconnect = () => (src.disconnected = true);
        sources.push(src);
        return src;
      }
      createGain() { gains++; return { context: this, gain: {}, connect() {} }; }
      resume() {}
    }
    const { store } = await import("../../frontend/js/state/store.js");
    const { playSound } = await import("../../frontend/js/components/sound.js");
    const { ZZFX } = await import("../../frontend/js/vendor/zzfx.js");
    ZZFX.audioContext = new FakeContext();
    store.set("profile", { som_ativo: true, som_volume: 60, som_progresso: true, som_interface: true, som_avisos: true });

    // cliques rápidos (a voz da kami é parecida): um nó de volume só
    for (let i = 0; i < 40; i++) playSound("clique");
    assert.equal(gains, 1);
    // passou de 16 notas vivas: as mais antigas são cortadas e liberadas
    const cut = sources.filter((s) => s.stopped);
    assert.equal(cut.length, 40 - 16);
    assert.ok(cut.every((s) => s.disconnected));
    assert.deepEqual(sources.slice(0, 24), cut);

    // nota que terminou sozinha se desliga
    const last = sources.at(-1);
    last.onended();
    assert.equal(last.disconnected, true);
  })
);
