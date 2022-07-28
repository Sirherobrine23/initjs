#!/bin/bash
CUSTOMRUN="$@"
echo "dont start with root/sudo user!"
# Start docker
if command -v dockerd &> /dev/null; then
  if ! docker info &> /dev/null ;then
    (sudo dockerd "${DOCKERD_ARGS}") &
  fi
fi

# User scripts
if [[ -d "/startScripts" ]];then
  cd "/startScripts"
  for script in *; do
    ("./$script") &
  done
fi

# Run script
if ! [[ -z "${CUSTOMRUN}" ]]; then
  set -ex
  bash -c "${CUSTOMRUN}"
  exit $?
fi

# Sleep script
sleep infinity
