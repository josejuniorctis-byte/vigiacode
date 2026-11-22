# Release 0.1.0 — VigiaCode

Checklist e comandos para publicar o pacote `vigiacode` e criar o repositório
no GitHub. Nada aqui é executado automaticamente: rode na ordem, conferindo cada
passo.

## 1. Validar o pacote localmente

```bash
pnpm install
pnpm build
pnpm lint
pnpm typecheck
pnpm test
pnpm format:check

cd packages/cli
npm pack                       # gera vigiacode-0.1.0.tgz
```

O tarball da 0.1.0 tem ~360 KB e 293 arquivos, incluindo:

- `dist/` da CLI (ESM + `.d.ts`);
- `dist/drizzle/` com as migrations `0000`–`0004`;
- `dist/web/` com o dashboard React embutido (servido pelo Fastify);
- `README.md` e `LICENSE`.

Teste numa pasta fora do monorepo:

```bash
mkdir -p /tmp/vigiacode-test/app /tmp/vigiacode-test/project
cp vigiacode-0.1.0.tgz /tmp/vigiacode-test/
cd /tmp/vigiacode-test/app
npm init -y
npm install ../vigiacode-0.1.0.tgz
cd ../project
../app/node_modules/.bin/vigiacode init --yes --no-gitignore
../app/node_modules/.bin/vigiacode bindings scan --fail-on none
../app/node_modules/.bin/vigiacode start      # http://localhost:4317
../app/node_modules/.bin/vigiacode mcp        # initialize + tools/list no stdio
```

## 2. Requisitos do better-sqlite3

O banco usa `better-sqlite3`, um módulo nativo. O pacote traz binários
pré-compilados para as plataformas comuns; se o seu ambiente não tiver prebuild,
o npm compila na instalação e precisa de:

| Plataforma | Requisitos                                                                  |
| ---------- | --------------------------------------------------------------------------- |
| Windows    | Node 20/22, Visual Studio Build Tools (C++ Desktop) e Python 3              |
| macOS      | Xcode Command Line Tools (`xcode-select --install`)                         |
| Linux      | `build-essential`, `python3` e `make` (ex.: `node:20-slim` + esses pacotes) |

Se a carga falhar, o VigiaCode mostra uma mensagem em português com o detalhe e
sugere `npm rebuild better-sqlite3`. Node muito novo (ex.: 26) pode não ter
prebuild disponível; nesse caso use Node 20 ou 22.

## 3. Criar o repositório e enviar o código

O repositório **não é criado nem recebe push automaticamente**. Quando quiser:

```bash
git remote add origin https://github.com/josejuniorctis-byte/vigiacode.git
git push -u origin main
git tag v0.1.0
git push --tags
```

> Se o remoto já existir, pule o `git remote add`. Crie o repositório vazio
> `josejuniorctis-byte/vigiacode` no GitHub antes do push.

## 4. Publicar no npm

Primeiro login e conferência do nome:

```bash
npm login
npm whoami
npm view vigiacode version   # deve falhar com 404 se o nome estiver livre
```

Depois:

```bash
cd packages/cli
npm publish --access public
```

Para liberar versões futuras sem duplicar:

```bash
npm version patch|minor|major --no-git-tag-version
# atualize o CHANGELOG e o README
npm pack && npm publish --access public
git tag v<versao> && git push --tags
```

## 5. GitHub Release

Com o workflow `.github/workflows/release.yml` ativo, basta empurrar a tag:

```bash
git tag v0.1.0
git push origin v0.1.0
```

O workflow roda build + `npm pack`, anexa o `.tgz` ao Release e **só publica no
npm se o secret `NPM_TOKEN` existir** (Settings → Secrets and variables →
Actions). Sem o secret, o Release é criado com o tarball anexado.

## 6. Docker

A imagem multi-stage usa `node:20-slim`, roda como usuário sem privilégios
(uid 10001), expõe a porta **4317** e monta o projeto em `/project:ro`, com um
volume próprio em `/project/.vigiacode`.

```bash
docker build -t vigiacode:0.1.0 .
docker volume create vigiacode-state
docker run --rm -p 4317:4317 \
  -v "$PWD:/project:ro" \
  -v vigiacode-state:/project/.vigiacode \
  vigiacode:0.1.0
```

Ou:

```bash
docker compose up --build
```

Na primeira execução o entrypoint roda `vigiacode init --yes --no-gitignore`
(porque `/project` é somente leitura) e depois `vigiacode start --host 0.0.0.0`.
Para usar IA, injete as chaves pelo ambiente (`-e OPENAI_API_KEY=...`), nunca
na imagem ou no compose versionado.

> O build da imagem **não foi executado nesta máquina** porque o daemon do
> Docker Desktop não estava ativo. O Dockerfile foi escrito para o caminho
> padrão (pnpm 10 + Node 20 + prebuild do better-sqlite3). Rode
> `docker build -t vigiacode:test .` antes de publicar a imagem.
