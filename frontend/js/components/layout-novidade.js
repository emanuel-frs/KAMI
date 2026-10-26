/**
 * Aviso de layout novo (P-23, LAY-02/05).
 *
 * Quando o layout padrão das telas melhora numa versão nova (versão em
 * app/widgets.py LAYOUT_PADRAO_VERSAO), quem já usa o app continua com o
 * layout antigo — que pode ter buracos e widgets mal encaixados. Uma vez,
 * na abertura, este aviso pergunta se quer aplicar o padrão novo nas telas
 * que estão diferentes. Aplicar devolve os layouts de antes, e o toast
 * seguinte oferece desfazer. "agora não" não pergunta de novo; fechar no ✕
 * pergunta na próxima abertura.
 */
import { getNovidadeLayout, responderNovidadeLayout, saveLayout } from "../api/dashboard.js";
import { showToast } from "./toast.js";
import { localeAtual, t } from "../i18n.js";

// "núcleo, finanças e carreira" no jeito do idioma
function listar(telas) {
  const nomes = telas.map((tela) => t(`nav.${tela}`));
  return new Intl.ListFormat(localeAtual(), { type: "conjunction" }).format(nomes);
}

export async function oferecerLayoutNovo({ recarregarTela }) {
  let novidade;
  try {
    novidade = await getNovidadeLayout();
  } catch {
    return; // sem backend agora: pergunta na próxima abertura
  }
  if (!novidade?.telas?.length) return;

  showToast({
    title: t("layout_novidade.layout_novo_das_telas"),
    message: t("layout_novidade.oferta", { telas: listar(novidade.telas) }),
    iconName: "grip",
    duration: 0,
    actions: [
      {
        label: t("layout_novidade.aplicar"),
        onClick: async (btn) => {
          btn.disabled = true;
          let resp;
          try {
            resp = await responderNovidadeLayout(true);
          } catch {
            btn.disabled = false;
            return false; // o aviso de erro (CONF-01) já explica; o toast fica pra tentar de novo
          }
          await recarregarTela();
          showToast({
            title: t("layout_novidade.layout_novo_aplicado"),
            message: t("layout_novidade.aplicadas", { n: resp.aplicadas.length, telas: listar(resp.aplicadas) }),
            iconName: "check",
            duration: 20000,
            actions: [
              {
                label: t("geral.desfazer"),
                onClick: async () => {
                  for (const [tela, widgets] of Object.entries(resp.anteriores)) {
                    await saveLayout(tela, widgets);
                  }
                  await recarregarTela();
                  return true;
                },
              },
            ],
          });
          return true;
        },
      },
      {
        label: t("layout_novidade.agora_nao"),
        onClick: () => {
          responderNovidadeLayout(false).catch(() => {});
          return true;
        },
      },
    ],
  });
}
