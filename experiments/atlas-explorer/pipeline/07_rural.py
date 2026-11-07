"""Crédito rural contratado em 2025 por mês de emissão e município (SICOR, BCB).

Entradas: SICOR_OPERACAO_BASICA_ESTADO_2025.gz e SICOR_COMPLEMENTO_OPERACAO_BASICA.gz (microdados BCB).
Caminhos por variável de ambiente SICOR_BASICA e SICOR_COMPLEMENTO (padrão: ../atlas-film/raw/).
Saída: data/rural-2025.json, valores em R$ milhões. Só entram operações com município informado no complemento;
a cobertura (operações e valor) vai no próprio arquivo. SICOR_PROPRIEDADES, que traz CPF/CNPJ, não é usado.
"""
import gzip
import json
import os
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
FILM = ROOT.parent / "atlas-film/raw"
BASICA = Path(os.environ.get("SICOR_BASICA", FILM / "SICOR_OPERACAO_BASICA_ESTADO_2025.gz"))
COMPLEMENTO = Path(os.environ.get("SICOR_COMPLEMENTO", FILM / "SICOR_COMPLEMENTO_OPERACAO_BASICA.gz"))


def main():
    base = pd.read_csv(BASICA, sep=";", dtype=str, usecols=["#REF_BACEN", "NU_ORDEM", "DT_EMISSAO", "VL_PARC_CREDITO"])
    base["v"] = pd.to_numeric(base.VL_PARC_CREDITO, errors="coerce")
    base["month"] = base.DT_EMISSAO.str[6:10] + base.DT_EMISSAO.str[3:5]
    refs = set(base["#REF_BACEN"])
    rows = []
    with gzip.open(COMPLEMENTO, "rt", encoding="latin1") as f:
        f.readline()
        for line in f:
            p = line.split(";", 5)
            if p[0] in refs:
                rows.append((p[0], p[1], p[4].strip()))
    comp = pd.DataFrame(rows, columns=["#REF_BACEN", "NU_ORDEM", "ibge"]).drop_duplicates(["#REF_BACEN", "NU_ORDEM"])
    m = base.merge(comp, on=["#REF_BACEN", "NU_ORDEM"], how="left")
    covered = m[m.ibge.notna() & (m.ibge.str.len() == 7)]
    months = sorted(covered.month.unique())
    g = covered.groupby(["ibge", "month"]).v.sum()
    out = {}
    for (code, month), value in g.items():
        out.setdefault(code, [0.0] * len(months))[months.index(month)] = round(float(value) / 1e6, 3)
    result = {
        "source": "BCB · SICOR, operação básica e complemento (município IBGE)", "unit": "R$ milhões", "months": months,
        "totalBi": [round(float(covered[covered.month == mo].v.sum()) / 1e9, 2) for mo in months],
        "coverage": {"operations": round(float(m.ibge.notna().mean()), 3), "value": round(float(covered.v.sum() / m.v.sum()), 3)},
        "municipalities": out,
    }
    (ROOT / "data/rural-2025.json").write_text(json.dumps(result, separators=(",", ":")))
    print(len(out), "municípios;", months[0], "-", months[-1], result["coverage"], "total R$ bi", round(sum(result["totalBi"]), 1))


if __name__ == "__main__":
    main()
