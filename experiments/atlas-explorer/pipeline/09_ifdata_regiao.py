"""Carteira de crédito ativa por região geográfica (IF.data, relatório 9, conglomerados prudenciais e
instituições independentes). Saldos em R$; participação calculada sobre o Total Geral da própria instituição.
Saída: data/ifdata-regiao.json, por código IF.data (CodInst), com a data-base usada.
"""
import json
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
COLUMNS = ["Norte", "Nordeste", "Centro-oeste", "Sudeste", "Sul", "Total Exterior", "Região não Informada", "Total Geral"]


def main(period="202606"):
    url = ("https://olinda.bcb.gov.br/olinda/servico/IFDATA/versao/v1/odata/IfDataValores(AnoMes=@AnoMes,TipoInstituicao=@TipoInstituicao,Relatorio=@Relatorio)"
           f"?@AnoMes={period}&@TipoInstituicao=1&@Relatorio='9'&$format=json")
    raw = ROOT / f"raw/ifdata-regiao-{period}.json"
    if not raw.exists():
        raw.write_bytes(urllib.request.urlopen(url, timeout=180).read())
    rows = json.loads(raw.read_text())["value"]
    out = {}
    for r in rows:
        if r["NomeColuna"] in COLUMNS:
            out.setdefault(r["CodInst"], {})[r["NomeColuna"]] = r["Saldo"]
    result = {"source": "BCB · IF.data, Carteira de crédito ativa por região geográfica", "period": period, "unit": "R$", "columns": COLUMNS, "institutions": out}
    (ROOT / "data/ifdata-regiao.json").write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")))
    print(len(out), "instituições", period)


if __name__ == "__main__":
    main(*sys.argv[1:])
