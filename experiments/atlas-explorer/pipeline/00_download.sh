#!/bin/sh
# Baixa as fontes do estudo em raw/. Executar a partir de experiments/atlas-explorer.
# O ESTBAN é publicado por trimestre, com defasagem (Comunicado 44.132/2025). Confira o catálogo antes de trocar o mês:
# https://www.bcb.gov.br/api/servico/sitebcb/Documentos/byListGuid?tronco=estatisticas&guidLista=f6391806-fd85-43af-acf1-c86d5b8dd6df&ordem=DataDocumento%20desc&pasta=agencia
set -eu
mkdir -p raw
O=https://olinda.bcb.gov.br/olinda/servico
curl -sfS -m 300 "$O/Informes_Agencias/versao/v1/odata/Agencias?\$format=json&\$top=100000" -o raw/agencias.json
curl -sfS -m 300 "$O/Informes_PostosDeAtendimento/versao/v1/odata/PostosAtendimento?\$format=json&\$top=100000" -o raw/postos-atendimento.json
curl -sfS -m 300 "https://www.bcb.gov.br/content/estatisticas/estatistica_bancaria_estban/agencia/202606_ESTBAN_AG.csv.zip" -o raw/202606_ESTBAN_AG.csv.zip
curl -sfS -m 600 "$O/Pix_DadosAbertos/versao/v1/odata/TransacoesPixPorMunicipio(DataBase=@DataBase)?@DataBase='202011'&\$format=json" -o raw/pix-municipios.json
# Gabarito de coordenadas: raw/bb-open-finance.geojson vem do estudo anterior (764 agências BB com coordenadas do Open Finance).
shasum -a 256 raw/*
curl -sfS -m 120 "https://servicodados.ibge.gov.br/api/v3/agregados/6579/periodos/2025/variaveis/9324?localidades=N6%5Ball%5D" -o raw/ibge-populacao-2025.json
