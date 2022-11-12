# Docker Image Development

Está é uma imagem rapido para desenvolvimento.

## Pacotes

Existe duas versões: `core` (`ghcr.io/sirherobrine23/initjs_core`) e `full` (`ghcr.io/sirherobrine23/initjs` ou `ghcr.io/sirherobrine23/initjs_full`)

### Core

`Binary (apt)`:

- cmake
- make
- build-essential
- git
- curl
- wget
- jq
- sudo
- procps
- zsh
- tar
- screen
- ca-certificates
- procps
- lsb-release
- gnupg
- gnupg2
- gpg
- apt-transport-https
- python3-pip
- apt-file
- attr
- bash-completion
- bc
- bison
- clang
- command-not-found
- dialog
- dos2unix
- ed
- flex
- gawk
- gperf
- htop
- libresolv-wrapper
- lld
- llvm
- lsof
- man
- neofetch
- neovim
- rhash
- tree
- tshark
- unbound
- unzip
- xxhash
- openssh-server
- openssh-client
- nodejs (latest by Sirherobrine23)

`NPM`:

- ts-node
- typescript
- autocannon
- pnpm
- initjs (init)

### Full

Tudo do core mais:

- Golang (`go`)
- Rust
- PHP (`php` and `compose`)
- OpenJDK (`java` sem o `openjdk*headless` e o `openjdk*zero`)
- Github CLI (`gh`)
- httpie (`http` and `https`)
- Prometheus
- Grafana
- Docker
- Docker Compose (`docker-compose`)
- Kubernetes CLI (`kubectl`)
- Minikube (`minikube` run in docker)
- k3d