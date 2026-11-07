"""Saldos ESTBAN (Documento 4500) por agência, jun/2026.

Cada instituição traz uma linha totalizadora com AGENCIA = 00000000000191, igual à soma
das suas agências. Essas linhas são conferidas e descartadas. Valores em reais, como no
arquivo público (sem centavos). Ausência de linha continua N/D; zero continua zero.
"""
import csv
import io
import json
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "raw/202606_ESTBAN_AG.csv.zip"
TOTALIZER = "00000000000191"
FIELDS = {
    "credito": "VERBETE_160_OPERACOES_DE_CREDITO",
    "emprestimos": "VERBETE_161_EMPRES_E_TIT_DESCONTADOS",
    "financiamentos": "VERBETE_162_FINANCIAMENTOS",
    "rural": "VERBETE_163_FIN_RURAIS_AGRICUL_CUST/INVEST",
    "imobiliario": "VERBETE_169_FINANCIAMENTOS_IMOBILIARIOS",
    "poupanca": "VERBETE_420_DEPOSITOS_DE_POUPANCA",
    "prazo": "VERBETE_432_DEPOSITOS_A_PRAZO",
}


def main():
    with zipfile.ZipFile(SRC) as z:
        name = z.namelist()[0]
        text = z.read(name).decode("latin1")
    lines = text.splitlines()
    reader = csv.DictReader(io.StringIO("\n".join(lines[2:])), delimiter=";")
    agencies, totals, sums = {}, {}, {}
    for row in reader:
        agency = row["AGENCIA"].lstrip("'")
        cnpj = row["CNPJ"]
        values = {k: int(float(row[v])) if row[v] not in ("", None) else None for k, v in FIELDS.items()}
        if agency == TOTALIZER:
            totals[cnpj] = values
            continue
        if agency in agencies:
            sys.exit(f"agência duplicada {agency}")
        agencies[agency] = {"cnpjBase": cnpj, "institution": row["NOME_INSTITUICAO"].strip(),
                            "ibge": row["CODMUN_IBGE"], **values}
        acc = sums.setdefault(cnpj, {k: 0 for k in FIELDS})
        for k in FIELDS:
            acc[k] += values[k] or 0
    mismatch = [c for c, t in totals.items() if any(abs((t[k] or 0) - sums.get(c, {}).get(k, 0)) > 1000 for k in FIELDS)]
    out = {
        "source": "BCB · ESTBAN por agência (Documento 4500)",
        "sourceUrl": "https://www.bcb.gov.br/estatisticas/estatisticabancariamunicipios",
        "file": name, "period": "2026-06", "unit": "R$",
        "perimeter": "Instituição individual (CNPJ); saldo registrado na agência",
        "totalizersDropped": len(totals), "totalizerMismatch": mismatch,
        "agencies": agencies,
    }
    (ROOT / "data/work/estban-agencias.json").write_text(json.dumps(out, ensure_ascii=False))
    print(len(agencies), "agências;", len(totals), "totalizadores;", len(mismatch), "divergentes",
          "; crédito R$ tri", round(sum(a["credito"] or 0 for a in agencies.values()) / 1e12, 3))


if __name__ == "__main__":
    main()
