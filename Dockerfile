# syntax=docker/dockerfile:1

# ─── build ──────────────────────────────────────────────────────────────────
# Node 20 é a versão mínima suportada pelo pacote (engines >=20). O build roda
# com pnpm e embute o dashboard em packages/cli/dist/web antes do npm pack.
FROM node:20-slim AS build

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

RUN npm install -g pnpm@10

WORKDIR /src
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm build
RUN mkdir -p /dist && cd packages/cli && npm pack --pack-destination /dist

# ─── runtime ────────────────────────────────────────────────────────────────
FROM node:20-slim AS runtime

ENV NODE_ENV=production

# setpriv (util-linux) permite iniciar como root só para ajustar o volume e
# então executar o servidor como usuário sem privilégios.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates util-linux \
  && rm -rf /var/lib/apt/lists/*

COPY --from=build /dist/*.tgz /tmp/vigiacode.tgz
RUN npm install -g /tmp/vigiacode.tgz && rm -f /tmp/vigiacode.tgz

RUN groupadd -g 10001 vigia \
  && useradd -m -u 10001 -g vigia -s /usr/sbin/nologin vigia

COPY docker/entrypoint.sh /usr/local/bin/vigiacode-entrypoint
RUN chmod 0755 /usr/local/bin/vigiacode-entrypoint

WORKDIR /project
EXPOSE 4317

HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4317/api/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

ENTRYPOINT ["vigiacode-entrypoint"]
CMD ["start", "--host", "0.0.0.0", "--port", "4317"]
