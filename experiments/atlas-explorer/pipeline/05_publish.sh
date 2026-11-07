#!/bin/sh
# Copia os arquivos gerados para a publicação estática do site (web/public/data/territorio).
# Executar a partir de experiments/atlas-explorer, depois de 04_build.py.
set -eu
dest=../../web/public/data/territorio
mkdir -p "$dest"
for name in points.json places.json details.json meta.json municipalities.json pix-adocao.json rural-2025.json poupanca-grid.json ifdata-regiao.json; do cp "data/$name" "$dest/$name"; done
shasum -a 256 "$dest"/*
