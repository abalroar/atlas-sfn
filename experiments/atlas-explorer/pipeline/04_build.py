"""Monta os arquivos do protótipo a partir das etapas anteriores.

Saídas em data/:
  points.json     pontos compactos [lon, lat, tipo, instituição, precisão, crédito R$ mi, fatia rural ‰, idx]
  details.json    endereço e saldos por ponto, carregado sob demanda
  places.json     municípios (IBGE), UFs, Pix mensal e SCR por UF
  meta.json       instituições, contagens da narrativa, fontes e conferências
Unidades preservadas: crédito do ESTBAN em R$ (arquivo público sem centavos), Pix em R$ e pessoas,
SCR em razão numerador/denominador agregada antes da divisão.
"""
import csv
import hashlib
import json
import math
import statistics
import sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parents[1]
KINDS = ["agencia", "cooperativa", "pab", "paa", "cambio", "ouro", "outro_posto"]
PRECISION = ["numero", "numero_aproximado", "logradouro", "cep", "localidade", "municipio", "sem"]
BRANDS = {
    "00000000": ("Banco do Brasil", "#b49612"), "00360305": ("Caixa", "#087eaa"),
    "60746948": ("Bradesco", "#cf334b"), "60701190": ("Itaú", "#eb6b21"),
    "90400888": ("Santander", "#bd3540"), "30306294": ("BTG Pactual", "#254d78"),
    "58160789": ("Safra", "#37596b"),
}


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def pretty(name):
    small = {"de", "da", "do", "das", "dos", "e"}
    words = name.lower().split()
    return " ".join(w if (i and w in small) else w[:1].upper() + w[1:] for i, w in enumerate(words))


def short_institution(name):
    n = pretty(name)
    for a, b in [("Cooperativa de Crédito", "Coop."), ("Cooperativa de Economia e Crédito Mútuo", "Coop."),
                 ("Distribuidora de Títulos e Valores Mobiliários", "DTVM"), ("Sociedade Anônima", "S.A."),
                 (" S.a.", " S.A."), (" Ltda.", ""), (" Ltda", ""), (" S/A", " S.A.")]:
        n = n.replace(a, b)
    return n.strip()


def haversine(a, b):
    lon1, lat1, lon2, lat2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    return 6371000 * 2 * math.asin(math.sqrt(h))


def main():
    work = ROOT / "data/work"
    rows = list(csv.DictReader((work / "enderecos.csv").open()))
    geo = {r["id"]: r for r in csv.DictReader((work / "geocode.csv").open())}
    estban = json.loads((work / "estban-agencias.json").read_text())
    network = json.loads((REPO / "web/public/data/bank-network.json").read_text())
    links = {b["idCnpjBase"]: b.get("analysisLink") for b in network["banks"]}

    institutions, inst_index = [], {}
    points, details = [], []
    kinds = Counter()
    precision = Counter()
    for r in rows:
        g = geo.get(r["id"])
        try:
            lon, lat = float(g["lon"]), float(g["lat"])
        except (TypeError, ValueError, KeyError):
            lon = lat = None
        prec = (g or {}).get("precisao") or "sem"
        if prec not in PRECISION:
            prec = "sem"
        if lon is None:
            precision["sem"] += 1
            continue
        key = r["cnpjBase"]
        if key not in inst_index:
            brand = BRANDS.get(key)
            link = links.get(key)
            inst_index[key] = len(institutions)
            institutions.append({
                "cnpjBase": key, "name": brand[0] if brand else short_institution(r["institution"]),
                "legalName": r["institution"], "segment": r["segment"], "color": brand[1] if brand else None,
                "analysisId": link["analysisId"] if link else None,
                "analysisName": link["analysisName"] if link else None,
                "analysisCode": link["code"] if link else None, "count": 0,
            })
        inst = inst_index[key]
        institutions[inst]["count"] += 1
        e = estban["agencies"].get(r["cnpj"]) if r["kind"] == "agencia" else None
        credit = e["credito"] if e else None
        rural = round(1000 * e["rural"] / e["credito"]) if e and e["credito"] else None
        idx = len(points)
        points.append([round(lon, 6), round(lat, 6), KINDS.index(r["kind"]), inst, PRECISION.index(prec),
                       round(credit / 1e6, 1) if credit is not None else None, rural, idx])
        details.append({
            "id": r["id"], "unit": r["unit"], "address": r["address"], "bairro": r["bairro"], "cep": r["cep"],
            "ibge": r["ibge"], "since": r["since"], "postType": r.get("postType") or "",
            "compe": r["compe"], "cnpj": r["cnpj"],
            "desvio": round(float(g["desvio_metros"])) if g.get("desvio_metros") not in (None, "", "NA") else None,
            "estban": {k: e[k] for k in ("credito", "emprestimos", "financiamentos", "rural", "imobiliario", "poupanca", "prazo")} if e else None,
        })
        kinds[r["kind"]] += 1
        precision[prec] += 1

    # Conferência das coordenadas contra o gabarito publicado pelo BB (Open Finance).
    bb = json.loads((ROOT / "raw/bb-open-finance.geojson").read_text())
    located = {d["id"]: p for d, p in zip(details, points)}
    errors = defaultdict(list)
    for f in bb["features"]:
        p = located.get("A" + str(f["properties"].get("branchCnpj") or ""))
        if p:
            errors[PRECISION[p[4]]].append(haversine(f["geometry"]["coordinates"], p[:2]))
    check = {k: {"n": len(v), "medianM": round(statistics.median(v)), "p90M": round(sorted(v)[int(0.9 * (len(v) - 1))])}
             for k, v in errors.items() if v}

    # Municípios, cobertura física, Pix e SCR.
    muni = {m["ibge"]: m for m in network["municipalities"]}
    agencies_by = Counter(rows[i]["ibge"] for i in range(len(rows)) if rows[i]["kind"] == "agencia")
    coop_by = Counter(r["ibge"] for r in rows if r["kind"] == "cooperativa")
    posts_by = Counter(r["ibge"] for r in rows if r["kind"] != "agencia")
    pix_raw = json.loads((ROOT / "raw/pix-municipios.json").read_text())["value"]
    months = sorted({x["AnoMes"] for x in pix_raw})
    complete = [m for m in months if m <= 202610]
    mi = {m: i for i, m in enumerate(complete)}
    pix = defaultdict(lambda: {"pes": [None] * len(complete), "vl": [None] * len(complete)})
    for x in pix_raw:
        if x["AnoMes"] not in mi:
            continue
        code = str(x["Municipio_Ibge"])
        pix[code]["pes"][mi[x["AnoMes"]]] = x["QT_PES_PagadorPF"]
        pix[code]["vl"][mi[x["AnoMes"]]] = round(x["VL_PagadorPF"])
    # Centro de visita: mediana das unidades localizadas por número ou rua no município.
    # O ponto representativo do IBGE fica dentro do polígono, mas pode cair longe da área urbana.
    unit_xy = defaultdict(list)
    for d, p in zip(details, points):
        if p[4] <= 2:
            unit_xy[d["ibge"]].append(p[:2])
    places = []
    for code, m in muni.items():
        p = pix.get(code)
        xy = unit_xy.get(code)
        visit = [round(statistics.median(v[0] for v in xy), 5), round(statistics.median(v[1] for v in xy), 5)] if xy else None
        places.append({"ibge": code, "name": m["name"], "uf": m["uf"], "lon": m["lon"], "lat": m["lat"], "visit": visit,
                       "agencias": agencies_by.get(code, 0), "postos": posts_by.get(code, 0),
                       "cooperativas": coop_by.get(code, 0),
                       "pixPessoas": p["pes"] if p else None, "pixValor": p["vl"] if p else None})
    scr = {}
    for person in ("pf", "pj"):
        d = json.loads((REPO / f"web/public/data/atlas-{person}.json").read_text())
        last = len(d["dims"]["months"]) - 1
        num, den = defaultdict(float), defaultdict(float)
        for row in d["rows"]:
            if row[0] == last:
                uf = d["dims"]["ufs"][row[1]]["uf"]
                num[uf] += row[4]
                den[uf] += row[5]
        scr[person] = {"month": d["dims"]["months"][last],
                       "uf": {uf: round(100 * num[uf] / den[uf], 2) if den[uf] > 0 else None for uf in den}}

    desert = [p for p in places if p["agencias"] == 0 and p["postos"] == 0]
    coop_only = [p for p in places if p["agencias"] == 0 and p["cooperativas"] > 0]
    gold = Counter(r["ibge"] for r in rows if r["kind"] == "ouro")
    # Números da narrativa, calculados aqui para não ficarem escritos à mão na interface.
    credits = sorted(((p[5] or 0) * 1e6, p[7]) for p in points if p[5] is not None)
    all_credit = sum(e["credito"] or 0 for e in estban["agencies"].values())
    top10 = sorted((e["credito"] or 0 for e in estban["agencies"].values()), reverse=True)[:10]
    hq_val, hq_idx = credits[-1]
    hq = points[hq_idx]
    by_muni = defaultdict(lambda: [0, 0])
    for e in estban["agencies"].values():
        by_muni[e["ibge"]][0] += e["credito"] or 0
        by_muni[e["ibge"]][1] += e["rural"] or 0
    rural_rank = sorted(((r / c, code) for code, (c, r) in by_muni.items() if c >= 5e8 and muni.get(code, {}).get("uf") in ("RO", "MT")), reverse=True)
    rshare, rcode = rural_rank[0]
    story = {
        "hq": {"idx": hq_idx, "lon": hq[0], "lat": hq[1], "credit": estban["agencies"][details[hq_idx]["cnpj"]]["credito"],
               "institution": institutions[hq[3]]["name"], "municipality": muni[details[hq_idx]["ibge"]]["name"], "uf": muni[details[hq_idx]["ibge"]]["uf"]},
        "top10Share": round(100 * sum(top10) / all_credit, 1),
        "rural": {"ibge": rcode, "name": muni[rcode]["name"], "uf": muni[rcode]["uf"], "share": round(100 * rshare, 1),
                  "lon": muni[rcode]["lon"], "lat": muni[rcode]["lat"]},
        "goldCenter": None,
    }
    gold_pts = [p for p, r in zip(points, [r for r in rows if _ok(geo.get(r["id"]))]) if r["kind"] == "ouro" and r["ibge"] == gold.most_common(1)[0][0]]
    if gold_pts:
        story["goldCenter"] = [round(statistics.mean(p[0] for p in gold_pts), 5), round(statistics.mean(p[1] for p in gold_pts), 5)]
    meta = {
        "story": story,
        "position": "2026-11-05", "kinds": KINDS, "precision": PRECISION, "institutions": institutions,
        "counts": {"units": len(rows), "located": len(points), "kinds": kinds, "precision": precision,
                   "municipalities": len(places), "desert": len(desert), "coopOnly": len(coop_only),
                   "desertByUf": Counter(p["uf"] for p in desert).most_common(),
                   "coopOnlyByUf": Counter(p["uf"] for p in coop_only).most_common(),
                   "goldByMunicipality": [(muni[c]["name"], muni[c]["uf"], n) for c, n in gold.most_common(5)]},
        "pixMonths": complete, "scr": scr, "coordinateCheck": check,
        "estban": {k: estban[k] for k in ("source", "sourceUrl", "file", "period", "unit", "perimeter", "totalizersDropped", "totalizerMismatch")},
        "sources": {
            "agencias": {"url": "https://olinda.bcb.gov.br/olinda/servico/Informes_Agencias/versao/v1/odata/Agencias", "sha256": sha(ROOT / "raw/agencias.json")},
            "postos": {"url": "https://olinda.bcb.gov.br/olinda/servico/Informes_PostosDeAtendimento/versao/v1/odata/PostosAtendimento", "sha256": sha(ROOT / "raw/postos-atendimento.json")},
            "estban": {"url": "https://www.bcb.gov.br/content/estatisticas/estatistica_bancaria_estban/agencia/202606_ESTBAN_AG.csv.zip", "sha256": sha(ROOT / "raw/202606_ESTBAN_AG.csv.zip")},
            "pix": {"url": "https://olinda.bcb.gov.br/olinda/servico/Pix_DadosAbertos/versao/v1/odata/TransacoesPixPorMunicipio", "sha256": sha(ROOT / "raw/pix-municipios.json"), "lastCompleteMonth": complete[-1]},
            "geocode": {"method": "geocodebr (Ipea) sobre CNEFE 2022 (IBGE)"},
        },
    }
    out = ROOT / "data"
    (out / "points.json").write_text(json.dumps({"fields": ["lon", "lat", "kind", "inst", "precision", "creditMi", "ruralPermille", "idx"], "rows": points}, separators=(",", ":")))
    (out / "details.json").write_text(json.dumps(details, ensure_ascii=False, separators=(",", ":")))
    pix_out = {p["ibge"]: [p.pop("pixPessoas"), p.pop("pixValor")] for p in places if p.get("pixPessoas")}
    for p in places:
        p.pop("pixPessoas", None); p.pop("pixValor", None)
    (out / "places.json").write_text(json.dumps(places, ensure_ascii=False, separators=(",", ":")))
    (out / "pix.json").write_text(json.dumps({"months": complete, "fields": ["pessoasPagadorasPF", "valorPagoPF"], "municipalities": pix_out}, separators=(",", ":")))
    (out / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1))
    print(json.dumps(meta["counts"], ensure_ascii=False, default=str)[:1500])
    print("check", check)
    print("story", json.dumps(story, ensure_ascii=False))


def _ok(g):
    return bool(g) and g.get("lon") not in (None, "", "NA") and g.get("lat") not in (None, "", "NA")


if __name__ == "__main__":
    main()
