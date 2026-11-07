# Atlas · Agências

Estudo isolado de navegação geográfica em resposta à rejeição dos pilares por UF. Nenhuma alteração no site publicado, nos cálculos ou nos exportáveis.

## Dados

- 764 localizações de agências do Banco do Brasil, com coordenadas fornecidas pelo banco em sua API pública Open Finance.
- Coleta parcial e não aleatória: 19 páginas válidas entre 87, com falhas HTTP nas demais. Universo cadastral BCB: 3.909 agências BB, em 05/11/2026. Cobertura exibida: 19,54%.
- Identificação por banco + código COMPE numérico exato + mesmo município IBGE. O CNPJ do participante na API é o da matriz, não o da agência.
- O GeoJSON de origem preserva 771 pontos. A vista exclui seis nearBoundary e um outside, mantendo os 764 inside na malha municipal IBGE simplificada. Pertencimento municipal não certifica coordenada de porta ou imóvel.
- Três pares coincidentes preservados, sem deslocamento artificial. O clique resolve o ID original e abre os registros com a mesma posição.
- SCR público disponível por UF; não foi convertido artificialmente em pontos municipais. ESTBAN municipal identificado como outra fonte possível, ainda sem coleta ou validação de saldos neste estudo.

Recibos: `bb-agencies-receipt.json`, `bb-geography-check.json`, `granularity-sources.json` e `credit-granularity-research.json`.

## Navegação

Mapa plano, zoom e arraste, busca por cidade/agência/endereço, detalhe de cada unidade, busca de instituição e link para a análise existente. Aproximação contínua Brasil → São Paulo → Centro em 17 segundos. A câmera se move sobre uma posição cadastral fixa; não simula aberturas históricas, deslocamentos de agências ou fluxos de crédito.

Hanken Grotesk local (licença aberta). Pontos dourados com contorno escuro. Geografia IBGE local; mapa de ruas OpenStreetMap com atribuição visível e cache padrão do navegador, sem coleta de tiles em lote ou modo offline. Tiles só são usados na escala urbana; falha da camada de ruas a desliga e mantém os dados locais.

## Executar

```sh
node build.mjs
python3 -m http.server 8779 --bind 127.0.0.1
```

As dependências são instaladas neste diretório com `npm ci`; não há links para o worktree de origem. O MapLibre e seus workers são servidos localmente. O estudo é separado do build publicado em `web/`.

## Conferência

- Build concluído.
- Contagens conferidas independentemente: 764 IDs, todos inside; 26 SP capital, 19 RJ capital; três pares coincidentes.
- Inspeção no navegador em 788 × 711 e 390 × 844; sem rolagem horizontal. Busca por código e seleção com Enter, clique real no ponto, fonte/cobertura e link para a instituição conferidos.
- Aproximação iniciada e encerrada no Centro; pausa e navegação manual disponíveis. A qualidade percebida do movimento continua sujeita à avaliação editorial do usuário.
- Revisão independente de código, dados e captura estabilizada corrigiu seleção por coordenada quantizada, rótulo de cidade após navegação livre, contraste dos pontos e padding ao mudar breakpoint.
- Os worktrees do site e da hospedagem permaneceram limpos.

## Limites para publicação

A amostra atual não representa a densidade nacional de agências. Será necessário completar e monitorar a cobertura dos bancos, confirmar a licença dos dados coordenados e escolher infraestrutura de mapa compatível com o uso público antes de publicar essa camada em escala nacional.
