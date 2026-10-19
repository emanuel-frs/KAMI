#!/usr/bin/env python3
"""
Auditoria de dependências (SEG-04): junta o resultado do pip-audit
(backend), do npm audit (frontend) e do cargo audit (Tauri) e decide se o
CI falha.

Regra: falha com vulnerabilidade ALTA ou CRÍTICA que não esteja nas
exceções. Média/baixa e os avisos do cargo (crate sem manutenção,
"unsound") só aparecem no resumo. Severidade desconhecida conta como alta
— melhor olhar e registrar uma exceção do que deixar passar sem ver.

De onde vem a severidade:
- npm: o próprio npm audit;
- pip e cargo: o banco OSV (api.osv.dev) — o campo de severidade do
  GitHub Advisory (do id ou de um alias GHSA) e, sem ele, a nota CVSS 3
  calculada do vetor.

Exceções: `.github/auditoria-excecoes.toml`, cada uma com motivo e data
de revisão; passou da data, a exceção deixa de valer e o CI volta a
falhar (assim nenhuma fica esquecida).

Uso (o que o workflow auditoria.yml roda):
    python scripts/auditoria.py --pip pip.json --npm npm.json --cargo cargo.json \\
        --excecoes .github/auditoria-excecoes.toml
"""
import argparse
import datetime as dt
import json
import math
import os
import sys
import tomllib
import urllib.request

ALTAS = {"HIGH", "CRITICAL"}
OSV_URL = "https://api.osv.dev/v1/vulns/{}"


# ── severidade ─────────────────────────────────────────────────────────

_CVSS3 = {
    "AV": {"N": 0.85, "A": 0.62, "L": 0.55, "P": 0.2},
    "AC": {"L": 0.77, "H": 0.44},
    "UI": {"N": 0.85, "R": 0.62},
    "C": {"H": 0.56, "L": 0.22, "N": 0},
    "I": {"H": 0.56, "L": 0.22, "N": 0},
    "A": {"H": 0.56, "L": 0.22, "N": 0},
}


def _roundup(x: float) -> float:
    return math.ceil(x * 10 - 1e-9) / 10


def cvss3_nota(vetor: str) -> float | None:
    """Nota base CVSS 3.x de um vetor 'CVSS:3.1/AV:N/AC:L/...'; None se não der."""
    if not vetor or not vetor.startswith("CVSS:3"):
        return None
    try:
        m = dict(p.split(":") for p in vetor.split("/")[1:])
        escopo_muda = m["S"] == "C"
        pr = {"N": 0.85, "L": 0.68 if escopo_muda else 0.62, "H": 0.5 if escopo_muda else 0.27}[m["PR"]]
        iss = 1 - (1 - _CVSS3["C"][m["C"]]) * (1 - _CVSS3["I"][m["I"]]) * (1 - _CVSS3["A"][m["A"]])
        impacto = 7.52 * (iss - 0.029) - 3.25 * (iss - 0.02) ** 15 if escopo_muda else 6.42 * iss
        explor = 8.22 * _CVSS3["AV"][m["AV"]] * _CVSS3["AC"][m["AC"]] * pr * _CVSS3["UI"][m["UI"]]
    except (KeyError, ValueError):
        return None
    if impacto <= 0:
        return 0.0
    base = 1.08 * (impacto + explor) if escopo_muda else impacto + explor
    return _roundup(min(base, 10))


def nivel_da_nota(nota: float) -> str:
    if nota >= 9:
        return "CRITICAL"
    if nota >= 7:
        return "HIGH"
    if nota >= 4:
        return "MODERATE"
    return "LOW" if nota > 0 else "NONE"


def _osv(vuln_id: str) -> dict | None:
    try:
        with urllib.request.urlopen(OSV_URL.format(vuln_id), timeout=20) as resp:
            return json.load(resp)
    except Exception:  # noqa: BLE001 — sem OSV, a severidade fica desconhecida (conta como alta)
        return None


def severidade(vuln_id: str, aliases=(), vetor: str | None = None, consultar=_osv) -> str:
    for vid in [vuln_id, *aliases]:
        dados = consultar(vid) if vid else None
        if not dados:
            continue
        nivel = (dados.get("database_specific") or {}).get("severity")
        if isinstance(nivel, str) and nivel.upper() in {"LOW", "MODERATE", "MEDIUM", "HIGH", "CRITICAL"}:
            return "MODERATE" if nivel.upper() == "MEDIUM" else nivel.upper()
        for sev in dados.get("severity") or []:
            nota = cvss3_nota(sev.get("score", ""))
            if nota is not None:
                return nivel_da_nota(nota)
    nota = cvss3_nota(vetor or "")
    return nivel_da_nota(nota) if nota is not None else "DESCONHECIDA"


# ── leitura dos relatórios ─────────────────────────────────────────────

def achados_pip(rel: dict, consultar=_osv) -> list[dict]:
    out = []
    for dep in rel.get("dependencies", []):
        for v in dep.get("vulns", []):
            out.append({
                "origem": "pip", "pacote": f"{dep['name']} {dep['version']}", "id": v["id"],
                "severidade": severidade(v["id"], v.get("aliases") or [], consultar=consultar),
                "correcao": ", ".join(v.get("fix_versions") or []) or "—",
            })
    return out


def achados_npm(rel: dict) -> list[dict]:
    out = []
    for nome, v in (rel.get("vulnerabilities") or {}).items():
        ids = [via.get("url", "").rsplit("/", 1)[-1] for via in v.get("via", []) if isinstance(via, dict)]
        out.append({
            "origem": "npm", "pacote": nome, "id": ", ".join(i for i in ids if i) or nome,
            "severidade": (v.get("severity") or "desconhecida").upper().replace("MEDIUM", "MODERATE"),
            "correcao": "sim" if v.get("fixAvailable") else "—",
        })
    return out


def achados_cargo(rel: dict, consultar=_osv) -> tuple[list[dict], list[dict]]:
    vulns = []
    for v in (rel.get("vulnerabilities") or {}).get("list", []):
        a = v["advisory"]
        vulns.append({
            "origem": "cargo", "pacote": f"{v['package']['name']} {v['package']['version']}", "id": a["id"],
            "severidade": severidade(a["id"], a.get("aliases") or [], vetor=a.get("cvss"), consultar=consultar),
            "correcao": ", ".join((v.get("versions") or {}).get("patched") or []) or "—",
        })
    avisos = []
    for tipo, lista in (rel.get("warnings") or {}).items():
        for w in lista:
            a = w.get("advisory") or {}
            avisos.append({"tipo": tipo, "pacote": f"{w['package']['name']} {w['package']['version']}", "id": a.get("id", "—")})
    return vulns, avisos


# ── decisão ────────────────────────────────────────────────────────────

def carregar_excecoes(caminho: str, hoje: dt.date) -> tuple[dict, list[str]]:
    if not caminho or not os.path.exists(caminho):
        return {}, []
    with open(caminho, "rb") as fh:
        dados = tomllib.load(fh)
    validas, vencidas = {}, []
    for e in dados.get("excecao", []):
        ate = dt.date.fromisoformat(str(e["revisar_ate"]))
        if ate < hoje:
            vencidas.append(f"{e['id']} (venceu em {ate.isoformat()})")
        else:
            validas[e["id"]] = e
    return validas, vencidas


def decidir(achados: list[dict], excecoes: dict) -> list[dict]:
    """Os achados que fazem o CI falhar."""
    falham = []
    for a in achados:
        ids = {i.strip() for i in a["id"].split(",")}
        if ids & set(excecoes):
            a["excecao"] = True
            continue
        if a["severidade"] in ALTAS or a["severidade"] == "DESCONHECIDA":
            falham.append(a)
    return falham


def resumo_md(achados, avisos, falham, vencidas) -> str:
    linhas = ["## Auditoria de dependências", ""]
    if not achados:
        linhas.append("Nenhuma vulnerabilidade conhecida em pip, npm e cargo.")
    else:
        linhas += ["| origem | pacote | id | severidade | correção | |", "|---|---|---|---|---|---|"]
        for a in achados:
            marca = "exceção" if a.get("excecao") else ("**falha**" if a in falham else "")
            linhas.append(f"| {a['origem']} | {a['pacote']} | {a['id']} | {a['severidade']} | {a['correcao']} | {marca} |")
    if vencidas:
        linhas += ["", "Exceções vencidas (não valem mais): " + "; ".join(vencidas)]
    if avisos:
        linhas += ["", f"<details><summary>{len(avisos)} aviso(s) do cargo (sem manutenção, unsound) — não falham</summary>", ""]
        linhas += [f"- {w['tipo']}: {w['pacote']} ({w['id']})" for w in avisos]
        linhas += ["", "</details>"]
    linhas += ["", "**Resultado:** " + ("falhou — alta/crítica sem exceção" if falham else "ok")]
    return "\n".join(linhas) + "\n"


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pip")
    ap.add_argument("--npm")
    ap.add_argument("--cargo")
    ap.add_argument("--excecoes")
    args = ap.parse_args(argv)

    def ler(caminho):
        if not caminho:
            return {}
        with open(caminho, encoding="utf-8") as fh:
            texto = fh.read().strip()
        return json.loads(texto) if texto else {}

    achados = achados_pip(ler(args.pip)) + achados_npm(ler(args.npm))
    cargo, avisos = achados_cargo(ler(args.cargo))
    achados += cargo
    excecoes, vencidas = carregar_excecoes(args.excecoes, dt.date.today())
    falham = decidir(achados, excecoes)

    md = resumo_md(achados, avisos, falham, vencidas)
    print(md)
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a", encoding="utf-8") as fh:
            fh.write(md)
    return 1 if falham else 0


if __name__ == "__main__":
    sys.exit(main())
