// ORG-05 — dia de um lembrete que vem só com a hora (modals/lembrete-modal.js).
import test from "node:test";
import assert from "node:assert/strict";
import { withDom } from "./helpers/dom.js";

test(
  "só com a hora: hoje se ainda não passou, amanhã se já passou — inclusive depois das 23h",
  withDom("<body></body>", async () => {
    const { diaDaHora } = await import("../../frontend/js/modals/lembrete-modal.js");
    const as = (h, m) => new Date(2026, 9, 23, h, m);
    assert.equal(diaDaHora("23:08", as(23, 6)), "2026-10-23"); // o caso do e2e
    assert.equal(diaDaHora("23:30", as(23, 10)), "2026-10-23");
    assert.equal(diaDaHora("09:00", as(23, 10)), "2026-10-24"); // já passou
    assert.equal(diaDaHora("23:06", as(23, 6)), "2026-10-24"); // o minuto de agora já não dispara
    assert.equal(diaDaHora("18:00", as(8, 0)), "2026-10-23");
    assert.equal(diaDaHora("00:15", new Date(2026, 9, 31, 23, 50)), "2026-11-01"); // vira o mês
  })
);
