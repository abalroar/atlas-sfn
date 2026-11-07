"""Relevo da poupança: saldo de depósitos de poupança (ESTBAN verbete 420, jun/2026) somado por célula
de 0,4° de latitude × 0,25° de longitude, pela localização geocodificada de cada agência.

A soma é feita dentro da célula, sem suavização entre células. O ESTBAN cobre bancos com carteira
comercial e Caixa; cooperativas ficam fora. Valores em R$ milhões. A interface usa altura proporcional
à raiz quadrada do saldo, informada na nota.
"""
import json
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT.parents[1] / "web/public/data/territorio"
LAT, LON = 0.4, 0.25


def main():
    details = json.loads((WEB / "details.json").read_text())
    points = json.loads((WEB / "points.json").read_text())["rows"]
    cells, total, agencies = defaultdict(float), 0, 0
    for d, p in zip(details, points):
        e = d.get("estban")
        if not e or e.get("poupanca") is None:
            continue
        cells[(round(p[1] / LAT), round(p[0] / LON))] += e["poupanca"]
        total += e["poupanca"]
        agencies += 1
    out = {"source": "BCB · ESTBAN por agência, verbete 420 (poupança), jun/2026", "unit": "R$ milhões", "latStep": LAT, "lonStep": LON,
           "agencies": agencies, "totalBi": round(total / 1e9, 1),
           "cells": [[a, b, round(v / 1e6, 2)] for (a, b), v in sorted(cells.items())]}
    (ROOT / "data/poupanca-grid.json").write_text(json.dumps(out, separators=(",", ":")))
    print(agencies, "agências;", len(cells), "células; R$", out["totalBi"], "bi")


if __name__ == "__main__":
    main()
