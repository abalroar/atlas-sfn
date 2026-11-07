"""Une agências e postos do cadastro BCB em uma tabela de endereços para geocodificação.

Entrada: raw/agencias.json (Informes_Agencias) e raw/postos-atendimento.json
(Informes_PostosDeAtendimento), ambos com posição 05/11/2026.
Saída: data/work/enderecos.csv, uma linha por unidade cadastrada.

Nenhum endereço é corrigido à mão. O número só é separado do logradouro quando
o cadastro o traz no fim do campo Endereco, depois de vírgula ou espaço.
"""
import csv
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RETAIL = {"Banco Múltiplo", "Banco Comercial", "Caixa Econômica Federal"}
NUMBER = re.compile(r"^(.*?)[,\s]+(?:N[º°O]\.?\s*)?(\d{1,6})(?:\s*[A-Z])?\s*$")
KIND = {
    "Posto de Atendimento Cooperativo - PAC": "cooperativa",
    "Posto de Atendimento Bancário - PAB": "pab",
    "Posto Avançado de Atendimento - PAA": "paa",
    "Posto de Câmbio Permanente - PCP": "cambio",
    "Posto de Câmbio Transitório - PCT": "cambio",
    "Posto de Compra de Ouro - PCO": "ouro",
}


ABBREVIATIONS = [
    (r"^R\b\.?", "RUA"), (r"\bAV\b\.?", "AVENIDA"), (r"\bPCA\b\.?", "PRACA"), (r"\bPC\b\.?", "PRACA"),
    (r"\bAL\b\.", "ALAMEDA"), (r"\bTV\b\.?", "TRAVESSA"), (r"\bROD\b\.?", "RODOVIA"), (r"\bEST\b\.", "ESTRADA"),
    (r"\bPRES\b\.?", "PRESIDENTE"), (r"\bDR\b\.?", "DOUTOR"), (r"\bSEN\b\.?", "SENADOR"), (r"\bDEP\b\.?", "DEPUTADO"),
    (r"\bGOV\b\.?", "GOVERNADOR"), (r"\bCEL\b\.?", "CORONEL"), (r"\bGAL\b\.?", "GENERAL"), (r"\bGEN\b\.", "GENERAL"),
    (r"\bMAL\b\.?", "MARECHAL"), (r"\bCAP\b\.?", "CAPITAO"), (r"\bTEN\b\.?", "TENENTE"), (r"\bSTA\b\.?", "SANTA"),
    (r"\bSTO\b\.?", "SANTO"), (r"\bPROF\b\.?", "PROFESSOR"), (r"\bENG\b\.?", "ENGENHEIRO"), (r"\bDES\b\.?", "DESEMBARGADOR"),
    (r"\bVISC\b\.?", "VISCONDE"), (r"\bBR\b\.", "BARAO"), (r"\bCONS\b\.?", "CONSELHEIRO"), (r"\bMONS\b\.?", "MONSENHOR"),
]


def expand(street):
    # Abreviações frequentes do cadastro (ex.: "AV.PRES.VARGAS"), expandidas só para a busca no CNEFE.
    s = re.sub(r"\.(?=\S)", ". ", street)
    for pattern, full in ABBREVIATIONS:
        s = re.sub(pattern, full, s)
    return re.sub(r"\s+", " ", s).strip()


def split_number(address, number):
    address = re.sub(r"\s+", " ", (address or "").strip())
    number = (number or "").strip()
    hit = NUMBER.match(address)
    if hit:
        # O número no fim do Endereco prevalece: o campo Numero diverge dele em parte do cadastro.
        return hit.group(1).strip(" ,"), hit.group(2)
    if number and re.fullmatch(r"\d{1,6}", number):
        return address, number
    return address, ""


def main():
    rows = []
    agencies = json.loads((ROOT / "raw/agencias.json").read_text())["value"]
    for a in agencies:
        if a["Segmento"] not in RETAIL:
            continue
        street, number = split_number(a["Endereco"], a["Numero"])
        rows.append({
            "id": "A" + a["CnpjBase"] + a["CnpjSequencial"] + a["CnpjDv"],
            "kind": "agencia",
            "cnpjBase": a["CnpjBase"],
            "cnpj": a["CnpjBase"] + a["CnpjSequencial"] + a["CnpjDv"],
            "institution": a["NomeIf"],
            "segment": a["Segmento"],
            "unit": a["NomeAgencia"] or "",
            "compe": a["CodigoCompe"] or "",
            "address": a["Endereco"],
            "logradouro": expand(street),
            "numero": number,
            "bairro": a["Bairro"] or "",
            "cep": (a["Cep"] or "").replace("-", ""),
            "ibge": a["MunicipioIbge"],
            "municipio": a["Municipio"],
            "uf": a["UF"],
            "since": a["DataInicio"] or "",
        })
    posts = json.loads((ROOT / "raw/postos-atendimento.json").read_text())["value"]
    seen = {}
    for p in posts:
        kind = KIND.get(p["TipoPosto"], "outro_posto")
        street, number = split_number(p["Endereco"], p["Numero"])
        key = "P" + p["Cnpj"] + "-" + (p["MunicipioIbge"] or "")
        seen[key] = seen.get(key, 0) + 1
        rows.append({
            "id": f"{key}-{seen[key]:04d}",
            "kind": kind,
            "cnpjBase": p["Cnpj"],
            "cnpj": "",
            "institution": p["NomeIf"],
            "segment": p["Segmento"],
            "unit": p["NomePosto"] or "",
            "compe": "",
            "address": " ".join(x for x in [p["Endereco"], p["Numero"]] if x),
            "logradouro": expand(street),
            "numero": number,
            "bairro": p["Bairro"] or "",
            "cep": (p["Cep"] or "").replace("-", ""),
            "ibge": p["MunicipioIbge"],
            "municipio": p["Municipio"],
            "uf": p["UF"],
            "since": "",
            "postType": p["TipoPosto"],
        })
    out = ROOT / "data/work/enderecos.csv"
    out.parent.mkdir(parents=True, exist_ok=True)
    fields = list(rows[0].keys()) + ["postType"]
    with out.open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)
    ids = [r["id"] for r in rows]
    if len(ids) != len(set(ids)):
        sys.exit("IDs duplicados")
    print(len(rows), "unidades;", sum(r["kind"] == "agencia" for r in rows), "agências;",
          sum(bool(r["numero"]) for r in rows), "com número")


if __name__ == "__main__":
    main()
