# Atlas SFN

Repositório independente do Atlas, extraído do Toma Conta. Leia `README.md` e `migration/source-inventory.json` antes de alterar a organização dos dados.

- Preserve os módulos de cálculo, unidades, sinais, identidade e perímetro das instituições. Ausência continua N/D; zero continua zero.
- Os PPTX preservam Calibri, fundo branco e a paleta Itaú BBA. A interface usa Hanken Grotesk e a identidade já aprovada.
- A versão publicada está em `web/`; estudos visuais ficam em `experiments/` e não entram no build de produção.
- Use afirmações diretas. Evite estruturas como "não é X, é Y", "vai além de X", slogans e contraposições retóricas.
- Não inclua credenciais, caches de execução ou arquivos pessoais. Não use links simbólicos para o repositório anterior.
- Valide com `npm test`, `npm run build` e os testes Python pertinentes. `npm run verify:migration` confere a preservação dos dados e do código financeiro extraído.
- Esta extração foi solicitada como repositório local. Alterar o repositório GitHub executor, sua identidade OIDC ou as rotas públicas exige uma migração explícita da configuração de publicação. Preserve a identidade de produção enquanto isso.
