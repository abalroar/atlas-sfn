# Atlas · território

Estudo de exploração contínua do território, fora do site publicado. Os cálculos, exportáveis e dados de `web/` não foram alterados.

## Composição

Segunda versão, integrada à identidade do site. A cena de inadimplência é o próprio `web/src/AtlasScene.jsx`, com os cálculos de `web/src/atlas-data.js` (`makeCube`, `rate`) e os estilos de `web/src/atlas-landing.css`, importados sem cópia. O mapa vetorial repete o enquadramento da cena (mesma malha de UFs e mesma margem), de modo que a passagem do SVG para o mapa acontece sobre o mesmo desenho.

Percurso: inadimplência por UF (com play mensal) → distribuição por faixa de renda ou porte, em que cada ponto vira o contorno do estado → agências e postos sobre o coroplético esmaecido → ouro em Peixoto de Azevedo. Depois a coluna vira a leitura da área visível: lugar, contagem de unidades, cinco instituições com link para a análise e a inadimplência da UF central com o mesmo controle de renda. Pix, saldos ESTBAN agregados, crédito rural e sede saíram da interface; os saldos ESTBAN ficaram só na ficha de cada agência.

### Primeira versão

- Coluna fixa à esquerda e mapa ocupando o resto da tela. No celular, o mapa fica em cima e a coluna embaixo.
- A coluna começa com seis passos. A rolagem da coluna conduz a câmera: cada trecho interpola zoom e deslocamento pela curva de van Wijk e Nuij (`src/flight.js`), quadro a quadro, sem temporizador. Voltar a rolagem desfaz o caminho. As camadas de destaque mudam de opacidade no mesmo ritmo da câmera.
- Arrastar, usar a roda do mouse, clicar num ponto ou buscar entrega o controle: a coluna passa para a leitura da área visível e a câmera fica onde está.
- A leitura da área visível traz contagens por tipo, instituições presentes, crédito ESTBAN das agências na tela, Pix do município central e inadimplência SCR da UF central. Cada número leva a escala em que existe.
- Clicar numa instituição destaca os pontos dela com a cor própria do banco; as demais unidades esmaecem. O link de análise só aparece quando há vínculo prudencial confirmado em `web/public/data/bank-network.json`.
- Clicar num ponto abre a ficha: tipo, endereço, precisão da localização, data de início e saldos ESTBAN da agência.
- Mapa de base vetorial do OpenFreeMap (esquema OpenMapTiles), estilizado em `src/map-style.js`. Os vetores mudam de nível de zoom sem troca de imagem.

## Dados

| Arquivo | Origem | Observação |
| --- | --- | --- |
| `raw/agencias.json` | Olinda `Informes_Agencias`, posição 05/11/2026 | 12.818 agências de Banco Múltiplo, Banco Comercial e Caixa |
| `raw/postos-atendimento.json` | Olinda `Informes_PostosDeAtendimento`, 05/11/2026 | 23.044 postos; 10.013 PAC, 8.945 PAB, 3.077 PAA, 931 câmbio, 43 compra de ouro |
| `raw/202606_ESTBAN_AG.csv.zip` | ESTBAN por agência, jun/2026 | Saldos contábeis por CNPJ de agência, em reais sem centavos |
| `raw/pix-municipios.json` | Olinda `TransacoesPixPorMunicipio` | Nov/2020 a out/2026; nov/2026 descartado por estar incompleto |
| `web/public/data/atlas-pf.json`, `atlas-pj.json` | SCR.data já usado no site | Inadimplência por UF, jul/2026, agregada antes da divisão |
| `raw/bb-open-finance.geojson` | Estudo anterior | 771 coordenadas publicadas pelo BB, usadas só como gabarito |

`pipeline/00_download.sh` baixa as fontes. `raw/` e `data/work/` ficam fora do Git.

### Geocodificação

`pipeline/02_geocode.R` usa o geocodebr 0.6.3 (Ipea) sobre o CNEFE 2022 do IBGE. O número no fim do campo `Endereco` prevalece sobre o campo `Numero`, que diverge dele em parte do cadastro.

| Precisão | Unidades | Erro contra o gabarito BB (mediana · p90) |
| --- | ---: | --- |
| Número | 14.152 | 26 m · 208 m (n=319) |
| Número próximo | 12.216 | 92 m · 812 m (n=288) |
| Rua | 3.194 | 197 m · 1.078 m (n=59) |
| CEP | 4.599 | 231 m · 1.298 m (n=86) |
| Bairro | 1.184 | 324 m · 538 m (n=14) |
| Município | 514 | 12 km · 22 km (n=5) |
| Sem correspondência | 3 | fora do mapa |

Pontos localizados por CEP, bairro ou município ficam visíveis nas escalas nacional e regional e quase desaparecem a partir do zoom 12. Pontos coincidentes não são deslocados. O gabarito cobre só agências BB e não é uma amostra aleatória.

### ESTBAN

Cada instituição tem uma linha totalizadora com `AGENCIA = 00000000000191`. As 108 linhas foram conferidas contra a soma das agências da instituição (nenhuma divergência acima de R$ 1 mil) e descartadas. Sem elas, o crédito soma R$ 6,37 tri; com elas, o dobro.

O ESTBAN casa com o cadastro pelo CNPJ completo da agência. A localização é a agência onde a operação é contabilizada: as sedes concentram carteiras de todo o país (dez agências somam 35,6% do crédito; a matriz do Bradesco, em Osasco, R$ 825 bi). Perímetro: instituição individual, sem relação com os números prudenciais do IF.data.

### Números da narrativa

Calculados em `pipeline/04_build.py` e gravados em `data/meta.json`: 1.136 municípios com posto de cooperativa e sem agência bancária; 1.053 sem agência nem posto (correspondentes não entram); 12 postos de compra de ouro em Peixoto de Azevedo (MT); 94,3% do crédito das agências de Monte Negro (RO) em financiamento rural.

## Executar

```sh
cd experiments/atlas-explorer
npm install
python3 pipeline/01_addresses.py
R_LIBS_USER=<biblioteca R> GEOCODEBR_CACHE=<pasta de cache> Rscript pipeline/02_geocode.R
python3 pipeline/03_estban.py
python3 pipeline/04_build.py
node build.mjs
npm run preview
```

Abra `http://127.0.0.1:8781/`. O geocodebr baixa o CNEFE na primeira execução; a geocodificação completa levou cerca de 7 minutos.

## Publicação

A landing do site (`?view=overview`) usa esta composição desde 07/11/2026: `web/src/territory/TerritoryLanding.jsx`, com `flight.js`, `map-style.js` e `territory.css`. Os dados ficam em `web/public/data/territorio/`, copiados por `pipeline/05_publish.sh`, e são lidos da publicação estática (não fazem parte das revisões compartilhadas). A série SCR vem de `loadAtlasAsset`, como na landing anterior, que continua em `?view=credito`.

### Pix

`pipeline/06_pix.py` gera `pix-adocao.json`: pessoas físicas pagadoras no mês (BCB, `QT_PES_PagadorPF`) divididas pela população estimada de 2025 (IBGE, tabela 6579), de nov/2020 a out/2026. O passo da landing anima essa razão por município e termina em Pacaraima (RR), onde 179.432 pessoas pagaram com Pix em out/2026 para uma população estimada de 23.112. O BCB não documenta como atribui o município; a interface descreve o dado sem explicar a causa. O passo do ouro saiu.

### Versão em filme (07/11/2026)

A landing abre como filme: o mapa ocupa a tela, o percurso começa sozinho (com movimento reduzido, abre direto na exploração; `?filme` força o percurso) e, ao fim ou a qualquer gesto, a coluna de busca entra pela esquerda. Capítulos: Brasil, agências e postos (redes acendem banco a banco, nas cores próprias), inadimplência, por renda, Pix, Pacaraima, poupança e crédito rural. Mapa de base com tintas hipsométricas, batimetria e sombreamento (Terrain Tiles), que se apagam na escala de rua.

- `07_rural.py`: crédito rural 2025 por mês e município (SICOR, operações com município informado).
- `08_poupanca.py`: poupança ESTBAN por agência somada em células de 0,4° × 0,25°, desenhada como linhas de relevo com altura proporcional à raiz do saldo.
- `09_ifdata_regiao.py`: carteira de crédito por região (IF.data, relatório 9), exibida na ficha da instituição pelo código prudencial.

## Limites para publicação

- O OpenFreeMap público serve bem a um estudo. Em produção, convém hospedar um PMTiles recortado para o Brasil no R2.
- `details.json` (11 MB) e `pix.json` (5,7 MB) são carregados sob demanda, mas ainda pedem compressão ou divisão por UF.
- A regra de atribuição de município no Pix (pagador e recebedor) ainda precisa ser confirmada na documentação do BCB.
- Cooperativas não têm vínculo com a análise institucional nesta base; o cruzamento por nome foi evitado de propósito.
- Correspondentes bancários têm cadastro por município, sem endereço, e ficaram fora.
