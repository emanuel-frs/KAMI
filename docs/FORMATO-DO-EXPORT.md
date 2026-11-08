# Formato do export

Os dados do Kami são seus. Em configurações › backup e dados › **exportar**, o Kami gera um arquivo
`.json` com tudo o que está no banco, que dá para importar de volta no Kami (inclusive numa versão mais
nova, que atualiza os dados sozinha) ou ler com qualquer ferramenta que entenda JSON.

> **English:** the export is a JSON file with every table of the local database. Without a password it is
> plain JSON (`tables` → rows); with a password it is an AES-256-GCM envelope with a scrypt key, described
> below with a short Python snippet to open it without Kami.

## Sem senha

```json
{
  "kami_version": "2.0.0",
  "exported_at": "2026-11-06T18:30:00-03:00",
  "tables": {
    "transactions": [
      {"id": "…", "description": "Mercado da semana", "amount": 236.8, "type": "saida",
       "category": "Mercado", "conta_id": "…", "date": "2026-11-05", "…": "…"}
    ],
    "goals": [ … ],
    "…": [ … ]
  }
}
```

- `tables` tem uma lista por tabela do banco, e cada item é uma linha com as colunas como estão no
  SQLite. Datas no formato `AAAA-MM-DD`; horários com o fuso (`2026-11-06T18:30:00-03:00`); valores em
  dinheiro são números, na moeda escolhida em configurações.
- Versões novas podem acrescentar tabelas e colunas; nada que já existe muda de sentido sem uma
  migração.
- Senhas e chaves salvas (senha de app do e-mail, token do GitHub, chave de busca, chave de provedor de IA)
  e o texto das notas trancadas ficam **cifrados com a chave deste computador** (colunas terminadas em
  `_enc` e `conteudo_cifrado`): o arquivo não as revela, e elas não funcionam em outro computador. Para
  levá-las junto, use o export **com senha**.

As tabelas que mais interessam fora do Kami:

| Tabela | O que guarda |
|---|---|
| `transactions` | lançamentos: descrição, valor, `type` (`entrada`, `saida`, `transferencia`), categoria, conta e data |
| `wallet_banks`, `wallet_accounts` | bancos e contas, com saldo e cartão |
| `fixed_bills`, `wallet_subscriptions`, `debts`, `compras_parceladas` | contas fixas, assinaturas, dívidas e compras parceladas |
| `income_sources`, `income_entries` | fontes de renda e cada recebimento |
| `goals`, `goal_contributions` | metas e cada aporte |
| `tracks`, `milestones` | trilhas de estudo e seus marcos |
| `habitos`, `habitos_marcas` | hábitos e os dias marcados |
| `notas`, `notas_tags` | notas (Markdown) e tags |
| `calendar_events`, `lembretes` | eventos e lembretes |
| `career_positions`, `career_educations`, `career_salary_records` | cargos, formação e histórico de salário |
| `action_logs`, `attributes`, `achievements` | o histórico de XP, os atributos e as conquistas |

## Com senha

O mesmo conteúdo (mais as senhas salvas, decifradas) vai comprimido com zlib e cifrado:

```json
{
  "kami_backup_cifrado": 1,
  "kami_version": "2.0.0",
  "exported_at": "2026-11-06T18:30:00-03:00",
  "kdf": {"nome": "scrypt", "n": 131072, "r": 8, "p": 1, "sal": "<base64>"},
  "cifra": "AES-256-GCM",
  "nonce": "<base64>",
  "dados": "<base64>"
}
```

- A chave de 32 bytes sai da senha por **scrypt** com os parâmetros e o sal do próprio arquivo.
- **AES-256-GCM** autentica também o cabeçalho: os dados adicionais são o JSON de todos os campos menos
  `dados`, com as chaves em ordem e sem espaços. Mexer em qualquer byte faz a abertura falhar.
- Sem a senha, ninguém abre, nem o Kami. Não existe recuperação.

Abrir sem o Kami (Python 3 com o pacote `cryptography`):

```python
import base64, json, sys, zlib
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.scrypt import Scrypt

env = json.load(open(sys.argv[1], encoding="utf-8"))
k = env["kdf"]
chave = Scrypt(salt=base64.b64decode(k["sal"]), length=32, n=k["n"], r=k["r"], p=k["p"]).derive(sys.argv[2].encode())
cabecalho = json.dumps({c: v for c, v in env.items() if c != "dados"}, sort_keys=True, separators=(",", ":")).encode()
claro = AESGCM(chave).decrypt(base64.b64decode(env["nonce"]), base64.b64decode(env["dados"]), cabecalho)
conteudo = json.loads(zlib.decompress(claro))
print(list(conteudo["tables"]))  # o mesmo formato do export sem senha, mais "segredos"
```
