// I18N-02: os testes do frontend rodam com o dicionário português carregado
// (no app quem carrega é i18n.js::carregarIdioma, por fetch). Entra em todo
// arquivo de teste pelo --import do package.json; quem testa outro idioma
// troca com usarDicionarios() no próprio teste.
import { readFileSync } from "node:fs";
import { usarDicionarios } from "../../../frontend/js/i18n.js";

const PT = JSON.parse(readFileSync(new URL("../../../frontend/i18n/pt.json", import.meta.url), "utf8"));
usarDicionarios("pt", PT);
