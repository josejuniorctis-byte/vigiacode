#!/bin/sh
# Inicializa o projeto na primeira execução e roda o servidor como usuário sem
# privilégios. O volume do projeto é montado somente leitura; apenas
# /project/.vigiacode é gravável (volume próprio).
set -eu

if [ "$(id -u)" = "0" ]; then
  mkdir -p /project/.vigiacode
  chown -R 10001:10001 /project/.vigiacode
  exec setpriv --reuid=10001 --regid=10001 --init-groups "$0" "$@"
fi

if [ ! -f /project/.vigiacode/config.json ]; then
  echo "VigiaCode: inicializando /project (volume somente leitura; .vigiacode é gravável)."
  vigiacode init --yes --no-gitignore --name "${VIGIACODE_PROJECT_NAME:-$(basename /project)}"
fi

exec vigiacode "$@"
