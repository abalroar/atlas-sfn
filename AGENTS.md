# Atlas SFN

Repositório independente do Atlas, extraído do Toma Conta. Leia `README.md` e `migration/source-inventory.json` antes de alterar a organização dos dados.

- Preserve os módulos de cálculo, unidades, sinais, identidade e perímetro das instituições. Ausência continua N/D; zero continua zero.
- Os PPTX preservam Calibri e fundo branco e seguem a paleta terracota e azul-petróleo do Atlas (`web/src/editorial.js`). A interface usa Hanken Grotesk e a identidade já aprovada.
- A versão publicada está em `web/`; estudos visuais ficam em `experiments/` e não entram no build de produção.
- Use afirmações diretas. Evite estruturas como "não é X, é Y", "vai além de X", slogans e contraposições retóricas.
- Não inclua credenciais, caches de execução ou arquivos pessoais. Não use links simbólicos para o repositório anterior.
- Valide com `npm test`, `npm run build` e os testes Python pertinentes. `npm run verify:migration` confere a preservação dos dados e do código financeiro extraído.
- O repositório oficial é `abalroar/atlas-sfn`. O Worker financeiro é `atlas-sfn`; o site pessoal encaminha `/atlas-sfn/` e a entrada legada `/tomaconta/` para ele por service binding. Preserve o endereço público e os bindings financeiros existentes.
- O executor compartilhado autentica o repositório e workflow exatos por OIDC. Toda mudança de identidade deve atualizar as guardas do workflow, runner, relógio e handler juntas, com testes que rejeitem a identidade antiga.
