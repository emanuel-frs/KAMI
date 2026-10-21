// ORG-05 (P-61/P-70) — o que pode virar notificação do sistema.
import test from "node:test";
import assert from "node:assert/strict";
import { withDom } from "./helpers/dom.js";

function fakeTauri(dom) {
  const enviadas = [];
  dom.window.__TAURI__ = {
    notification: {
      isPermissionGranted: async () => true,
      requestPermission: async () => "granted",
      sendNotification: (n) => enviadas.push(n),
    },
  };
  return enviadas;
}

test(
  "respeita o tipo desligado e esconde o texto quando pedido",
  withDom("<div></div>", async (dom) => {
    const enviadas = fakeTauri(dom);
    const { notificarFora } = await import("../../frontend/js/components/native-notify.js");
    const msg = { title: "kami — remédio", body: "lembrete às 18:00" };

    assert.equal(await notificarFora("lembretes", msg, { notif_fora_lembretes: false }), false);
    assert.equal(enviadas.length, 0);

    await notificarFora("lembretes", msg, { notif_fora_lembretes: true });
    assert.deepEqual(enviadas.at(-1), msg);

    await notificarFora("vencimentos", { title: "kami — vence hoje", body: "hoje: luz" }, { notif_ocultar_texto: true });
    assert.equal(enviadas.at(-1).title, "kami");
    assert.ok(!enviadas.at(-1).body.includes("luz"));

    await notificarFora("eventos", msg, null); // perfil ainda não carregou: tudo ligado
    assert.equal(enviadas.length, 3);
  }),
);
