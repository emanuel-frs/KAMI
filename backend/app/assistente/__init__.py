"""
Assistente de IA do Kami (Sprints 8–10, cards IA-*; princípios na seção 9
de docs/EVOLUCAO-CARDS.md).

Desligado por padrão: o Kami funciona inteiro sem ele, nenhuma chave vem
embutida (P-11), e nada sai do computador até a pessoa configurar um
provedor e ligar.

A chamada ao provedor sai do BACKEND, nunca do webview — a CSP do app
continua só com `connect-src 'self' http://127.0.0.1:*`, e a chave da API
nunca passa pelo frontend.

Peças:
  tipos.py          formato neutro de mensagem/ferramenta/evento — o resto
                    do assistente só conhece este formato
  catalogo.py       provedores conhecidos (provedores.json, só pré-preenchem)
  transporte.py     HTTP com urllib (sem SDK, sem dependência nova): tempo
                    limite, sem seguir redirecionamento, SSE, erros
                    traduzidos em ErroProvedor
  openai_compat.py  adaptador "compatível com OpenAI" (OpenAI, Gemini,
                    Groq, OpenRouter, Mistral, Ollama, LM Studio…)
  anthropic.py      adaptador da API Messages da Anthropic
  provedores.py     escolhe o adaptador, valida URL (P-109), lista modelos
  config.py         configuração e provedores salvos no banco
  uso.py            teto diário de chamadas/tokens (P-104)
"""
