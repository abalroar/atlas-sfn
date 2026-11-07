# Publicação do Atlas SFN

Repositório oficial: `abalroar/atlas-sfn`, ID `1449624970`, owner `255978345`, branch `main`.

## Componentes

- Worker `atlas-sfn`: build `web/dist`, handlers financeiros originais e bindings `TOMACONTA_DB`/`TOMACONTA_BUCKET` já existentes.
- Worker `personalwebsite`: recebe o domínio atual e encaminha os prefixos exatos `/atlas-sfn` e `/tomaconta` para `atlas-sfn` pelo service binding `ATLAS_SFN`. O Request conserva URL, método, corpo e cabeçalhos. Os recursos pessoais continuam no Worker original.
- Cloudflare Workers Builds: checkout do repositório oficial, build e publicação do Worker `atlas-sfn` a partir de `main`.
- GitHub Actions: CI e executor de atualização compartilhada neste repositório. A variável `TOMACONTA_SHARED_ENABLED` habilita os agendamentos.

O endereço público permanece `https://matheusprat.es/atlas-sfn/`. O alias e a audiência OIDC continuam em `/tomaconta/api/shared`, preservando links e protocolo. A identidade aceita pelo handler pertence exclusivamente ao novo repositório e ao workflow oficial `tomaconta-shared.yml` em `main`.

## Build e publicação

```sh
npm ci --include=dev
npm ci --include=dev --prefix web
npm test
npm run build
npx wrangler deploy
```

O `build.json` inclui repositório, commit da interface e origem dos dados. O cabeçalho `X-Atlas-Repository` identifica o Worker responsável pela resposta. Os arquivos financeiros publicados em uma revisão compartilhada mantêm seus próprios hashes, datas e commit de geração; a versão da interface não substitui a proveniência dos dados.

## Atualização compartilhada

O workflow `tomaconta-shared.yml` consulta e executa a fila. `tomaconta-shared-clock.yml` consulta a fila e pode disparar o executor com `GITHUB_TOKEN` efêmero. O relógio resolve e valida o ID do workflow neste repositório pelo filename, sem IDs herdados do projeto anterior.

Antes de trocar o executor, conferir ausência de jobs em execução e desativar `TOMACONTA_SHARED_ENABLED` em `abalroar/tomaconta`. Depois de publicar e conferir a nova identidade, habilitar a variável em `abalroar/atlas-sfn`. O histórico e a revisão ativa permanecem no mesmo D1/R2; não executar novo bootstrap quando já existe uma revisão ativa.

Diagnóstico sem coleta:

```sh
gh workflow run tomaconta-shared.yml --repo abalroar/atlas-sfn --ref main -f diagnostic=true
```

Uma solicitação real pela aba Atualizar base deve gerar um job no serviço, uma execução no novo repositório e uma revisão publicada com o commit dessa execução. Confirmar a revisão em uma sessão nova e conferir um download de Balanço/DRE e um exportável de gráficos.

## Reversão

Preservar a revisão ativa e as versões anteriores. A retirada do service binding restaura o encaminhamento anterior do site pessoal, mas a identidade do executor também precisa acompanhar qualquer reversão. Não habilitar o executor antigo enquanto o handler publicado aceita apenas o novo repositório. A restauração de dados deve usar o protocolo condicional do próprio serviço, sem edição manual do ponteiro de revisão.
