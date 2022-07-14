#!/bin/bash
echo "dont start with root/sudo user!"
# Start docker
if command -v dockerd &> /dev/null; then
  if ! [[ -f "/var/run/docker.sock" ]] || !docker info &> /dev/null ;then
    (sudo dockerd "${DOCKERD_ARGS}") &
    (minikube start "${MINIKUBE_ARGS}") &
    sleep 5s
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
if ! [[ -z "\$@" ]]; then
  set -ex
  exec "\$@"
fi

# Sleep script
sleep infinity
