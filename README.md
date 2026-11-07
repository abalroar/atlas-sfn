# Atlas SFN

Site e dados públicos do sistema financeiro brasileiro, com análise de instituições, Balanço e DRE, crédito PF/PJ, rede de agências, mercado imobiliário, pagamentos e exportações Office.

Este é o repositório local independente em `/Users/matheusjprates/atlas-sfn`. A extração usa a versão publicada do Toma Conta, commit `3fa25eaa68b3ffa79c7d365606b2a86e241c1e1e`, e preserva os arquivos financeiros e dados por SHA-256. O projeto original permanece disponível como origem histórica.

## Executar

Node.js 24 ou superior. As dependências do site conservam seu lockfile original.

```sh
npm ci
npm run setup
npm run dev
```

Abra `http://127.0.0.1:5178/atlas-sfn/`.

```sh
npm test
npm run build
```

O build fica em `web/dist`. Para testar o Worker independente, com o build pronto:

```sh
npm run preview:worker
```

Abra `http://127.0.0.1:8789/atlas-sfn/`. O Worker usa somente os handlers e recursos financeiros; não inclui a galeria, o painel de fotos ou os bancos do site pessoal.

## Python e atualização

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements-dev.txt
npm run test:python
```

Os coletores, modelos contábeis e renderizadores foram copiados sem alterações em `utils/`. As poucas dependências legadas em `tabs/` fornecem classificações, conceitos e tabelas usadas por esses módulos; não há servidor Streamlit do site nem `app1.py` nesta extração. A biblioteca Streamlit ainda é uma dependência de compatibilidade dos módulos originais.

Os geradores em `web/tools/` leem exclusivamente os dados deste repositório. Exemplos, sempre a partir da raiz:

```sh
.venv/bin/python web/tools/export_institutions.py
.venv/bin/python web/tools/export_extra.py
.venv/bin/python web/tools/export_charts.py
.venv/bin/python web/tools/export_statements.py --output web/public/data
```

Os comandos sobrescrevem os arquivos derivados correspondentes; rode apenas ao preparar uma nova geração, com fontes completas. `data/bundled/` contém os Parquets versionados. O cache anual SCR não faz parte desse diretório: para recalcular o Atlas PF/PJ, restaure uma geração oficial ou colete o cache SCR pelos módulos existentes antes de executar `web/tools/export_atlas.py`. A base web atual já contém os JSON necessários para navegar no Atlas.

`scripts/tomaconta_shared_runner.py` e `scripts/tomaconta_shared_clock.py` preservam o protocolo de atualização compartilhada e os testes originais. O código completo do serviço está em `web/server/` e sua documentação em `docs/shared-web-refresh.md`.

## Publicação e identidade

O repositório oficial é `https://github.com/abalroar/atlas-sfn`, branch `main`. O endereço público permanece `https://matheusprat.es/atlas-sfn/`.

O Worker `atlas-sfn` contém o site e suas APIs. O Worker do site pessoal encaminha os prefixos `/atlas-sfn/` e `/tomaconta/` pelo service binding `ATLAS_SFN`, preservando método, corpo, contexto e cabeçalhos. Os bindings financeiros D1/R2 existentes conservam revisões e histórico; os recursos da galeria são separados.

O executor compartilhado autentica exclusivamente `abalroar/atlas-sfn` (repo ID `1449624970`, owner `255978345`), workflow `tomaconta-shared.yml` na `main`. A audiência canônica continua `https://matheusprat.es/tomaconta/api/shared/runner`; a assinatura e as demais guardas OIDC permanecem obrigatórias. O relógio resolve o ID do workflow pelo arquivo no próprio repositório, sem reutilizar o ID do Toma Conta.

A variável GitHub `TOMACONTA_SHARED_ENABLED=true` ativa a consulta agendada da fila no repositório oficial. Sua desativação no repositório antigo impede dois executores de disputar a mesma fila. `build.json` identifica o repositório, commit da interface e origem dos dados efetivamente publicados. Os dados de uma revisão compartilhada conservam seus próprios hashes e commit de geração.

O build de produção usa `npm ci --include=dev`, `npm ci --include=dev --prefix web`, `npm test` e `npm run build`; a publicação do Worker usa `npx wrangler deploy`. A integração de publicação automática está documentada em `docs/deployment.md`.

## Estudos visuais

`experiments/agency-map/` contém o último estudo de navegação granular, separado do build publicado.

```sh
npm run experiment:build
cd experiments/agency-map
npm run preview
```

Abra `http://127.0.0.1:8779/`. São 764 coordenadas de agências BB, uma amostra parcial de 19,5% da rede cadastrada do banco. Os dados brutos, recibos e conferência geográfica acompanham o estudo. Esse mapa não representa a densidade nacional completa.

## Organização

| Pasta | Conteúdo |
| --- | --- |
| `web/` | Interface, dados públicos derivados, geradores e testes web |
| `utils/` | Coletores, cálculos e exportadores originais |
| `tabs/` | Dependências financeiras legadas do modelo |
| `data/bundled/` | Fontes Parquet e metadados versionados |
| `worker/` | Hospedagem independente e APIs do Atlas |
| `scripts/` | Executor compartilhado, relógio e verificação da extração |
| `tests/` | Testes do Worker, coleta, cache e cálculos |
| `experiments/` | Estudos visuais fora da versão publicada |
| `migration/` | Inventário de origem e hashes dos arquivos preservados |

`npm run verify:migration` é uma conferência da extração inicial: verifica os hashes de todos os arquivos copiados e rejeita links simbólicos para o projeto anterior. Ela não integra a suíte diária, pois o desenvolvimento posterior altera legitimamente a interface e os dados. O inventário preserva a referência histórica. A validação desta extração está em `migration/validation.json`: 397 testes aprovados e 16 subtestes, builds do site e do experimento, além dos downloads reais de XLSX/PPTX pelo novo Worker.

Os PPTX mantêm Calibri, fundo branco e paleta Itaú BBA. A interface usa Hanken Grotesk, com licença aberta incluída. A licença dos dados e bibliotecas continua sendo a de cada fonte; esta extração não cria uma licença global nova.
