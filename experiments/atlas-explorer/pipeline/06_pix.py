"""Adoção do Pix por município: pessoas físicas pagadoras no mês / população estimada pelo IBGE (2025).

Entradas: raw/pix-municipios.json (Olinda TransacoesPixPorMunicipio, campo QT_PES_PagadorPF)
          raw/ibge-populacao-2025.json (IBGE, tabela 6579, variável 9324)
Saída: data/pix-adocao.json, com a razão em milésimos por município e mês (nov/2020 a out/2026).
O mês corrente é descartado por estar incompleto. A população é a mesma estimativa de 2025 em todos os meses.
O BCB não documenta publicamente como atribui o município; a razão pode passar de 100%.
Linha sem código de município fica fora; município sem linha no mês fica N/D (null).
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LAST = 202610


def main():
    series = json.loads((ROOT / "raw/ibge-populacao-2025.json").read_text())[0]["resultados"][0]["series"]
    pop = {s["localidade"]["id"]: int(s["serie"]["2025"]) for s in series}
    rows = [x for x in json.loads((ROOT / "raw/pix-municipios.json").read_text())["value"]
            if x.get("Municipio_Ibge") is not None and x["AnoMes"] <= LAST]
    months = sorted({x["AnoMes"] for x in rows})
    index = {m: i for i, m in enumerate(months)}
    payers = {}
    for x in rows:
        code = str(int(x["Municipio_Ibge"]))
        payers.setdefault(code, [None] * len(months))[index[x["AnoMes"]]] = x["QT_PES_PagadorPF"]
    out, national = {}, []
    for code, values in payers.items():
        if code not in pop or pop[code] <= 0:
            continue
        out[code] = [None if v is None else round(1000 * v / pop[code]) for v in values]
    for i in range(len(months)):
        num = sum(payers[c][i] or 0 for c in out)
        den = sum(pop[c] for c in out if payers[c][i] is not None)
        national.append(round(1000 * num / den) if den else None)
    top = max(out, key=lambda c: out[c][-1] or -1)
    reached = {c: next((months[i] for i, v in enumerate(vals) if v is not None and v >= 400), None) for c, vals in out.items()}
    result = {
        "source": "BCB · Pix por município (QT_PES_PagadorPF) · IBGE, estimativa de população 2025",
        "unit": "milésimos da população", "months": months, "national": national,
        "municipalities": out,
        "facts": {"highest": {"ibge": top, "ratio": out[top][-1], "population": pop[top], "payers": payers[top][-1]},
                  "reached40Median": sorted(m for m in reached.values() if m)[len([m for m in reached.values() if m]) // 2],
                  "neverReached40": sum(1 for m in reached.values() if m is None),
                  "missingPopulation": sorted(set(payers) - set(out))},
    }
    (ROOT / "data/pix-adocao.json").write_text(json.dumps(result, separators=(",", ":")))
    print(len(out), "municípios;", months[0], "a", months[-1], "; Brasil", national[-1], "‰; maior", result["facts"]["highest"])


if __name__ == "__main__":
    main()
