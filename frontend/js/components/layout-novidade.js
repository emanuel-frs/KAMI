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

const NOMES = { nucleo: "núcleo", perfil: "perfil", financas: "finanças", carreira: "carreira" };

function listar(telas) {
  const nomes = telas.map((t) => NOMES[t] || t);
  return nomes.length > 1 ? `${nomes.slice(0, -1).join(", ")} e ${nomes.at(-1)}` : nomes[0];
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
    title: "layout novo das telas",
    message: `o layout padrão de ${listar(novidade.telas)} melhorou: cada widget no tamanho dele, sem esticar pra tapar buraco. aplicar? dá pra desfazer logo depois.`,
    iconName: "grip",
    duration: 0,
    actions: [
      {
        label: "aplicar",
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
            title: "layout novo aplicado",
            message: `${listar(resp.aplicadas)} ${resp.aplicadas.length > 1 ? "estão" : "está"} com o layout padrão novo.`,
            iconName: "check",
            duration: 20000,
            actions: [
              {
                label: "desfazer",
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
        label: "agora não",
        onClick: () => {
          responderNovidadeLayout(false).catch(() => {});
          return true;
        },
      },
    ],
  });
}
