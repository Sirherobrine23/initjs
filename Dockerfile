# Build dive
FROM golang
WORKDIR /build
RUN git clone https://github.com/wagoodman/dive --depth=1 dive && cd dive && go build -o /dive.bin .

# Build (PHP) compose
FROM php
WORKDIR /build
RUN curl -sS https://getcomposer.org/installer | php

# Final Image
FROM ubuntu:latest AS base_image
# Install Basic packages
ARG DEBIAN_FRONTEND="noninteractive"
ARG EXTRA_PACKAGE=""
RUN apt update && apt list --upgradable -a && apt upgrade -y
RUN apt update && apt install -y software-properties-common cmake make build-essential git curl wget jq sudo procps zsh tar screen ca-certificates procps lsb-release gnupg gnupg2 gpg $EXTRA_PACKAGE

# Nodejs
RUN wget -qO- https://raw.githubusercontent.com/Sirherobrine23/DebianNodejsFiles/main/debianInstall.sh | bash

# Grafana
RUN apt install -y apt-transport-https && \
  apt install -y software-properties-common wget && \
  wget -q -O /usr/share/keyrings/grafana.key https://packages.grafana.com/gpg.key && \
  echo "deb [signed-by=/usr/share/keyrings/grafana.key] https://packages.grafana.com/enterprise/deb stable main" | tee -a /etc/apt/sources.list.d/grafana.list && \
  apt update && apt install -y grafana

# Install Prometheus
RUN mkdir /var/lib/prometheus && for i in rules rules.d files_sd; do mkdir -vp /etc/prometheus/${i}; done && \
  cd /tmp && mkdir prometheus && cd prometheus && \
  curl -s https://api.github.com/repos/prometheus/prometheus/releases/latest | grep browser_download_url | grep linux-$(dpkg --print-architecture) | cut -d '"' -f 4 | wget -O- -qi - | tar -xzvf - && \
  cd prometheus*/ && mv prometheus promtool /usr/local/bin/ && mv prometheus.yml /etc/prometheus/prometheus.yml && mv consoles/ console_libraries/ /etc/prometheus/ && \
  rm -rf /tmp/*

# PHP and compose
COPY --from=1 /build/composer.phar /usr/share/composer/composer.phar
RUN apt update && apt install -y php && echo "php /usr/share/composer/composer.phar \"\$@\"" > /usr/local/bin/composer && chmod +x /usr/local/bin/composer

# Docker, Docker Compose, minikube, kubectl, act, dive
RUN wget -qO- https://get.docker.com | sh && \
  wget -q $(wget -qO- https://api.github.com/repos/docker/compose/releases/latest | grep 'browser_download_url' | grep -v '.sha' | cut -d '"' -f 4 | grep linux | grep $(uname -m) | head -n 1) -O /usr/local/bin/docker-compose && chmod +x -v /usr/local/bin/docker-compose && \
  # Minikube
  curl -Lo minikube "https://storage.googleapis.com/minikube/releases/latest/minikube-linux-$(dpkg --print-architecture)" && \
  chmod +x minikube && mv minikube /usr/bin && \
  # Install Kubectl
  curl -LO "https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/linux/$(dpkg --print-architecture)/kubectl" && \
  chmod +x kubectl && mv kubectl /usr/bin && \
  # Install act (https://github.com/nektos/act)
  wget -qO- https://raw.githubusercontent.com/nektos/act/master/install.sh | bash

# Install dive (https://github.com/wagoodman/dive)
COPY --from=0 /dive.bin /usr/local/bin/dive
RUN chmod a+x /usr/local/bin/dive

# Install Github CLI (gh)
RUN (wget -q "$(wget -qO- https://api.github.com/repos/cli/cli/releases/latest | grep 'browser_download_url' | grep '.deb' | cut -d \" -f 4 | grep $(dpkg --print-architecture))" -O /tmp/gh.deb && dpkg -i /tmp/gh.deb && rm /tmp/gh.deb) || echo "Fail Install gh"

# Go (golang)
RUN wget -qO- "https://go.dev/dl/go1.19.2.linux-$(dpkg --print-architecture).tar.gz" | tar -C /usr/local -xzf - && ln -s /usr/local/go/bin/go /usr/bin/go && ln -s /usr/local/go/bin/gofmt /usr/bin/gofmt

# Install httpie
RUN apt install -y python3-pip && pip install --upgrade pip wheel && pip install --upgrade httpie

# Install extra packages
RUN apt update && apt install -y apt-file attr bash-completion bc bison clang command-not-found dialog dos2unix ed flex gawk gperf htop libresolv-wrapper lld llvm lsof man neofetch neovim rhash tree tshark unbound unzip xxhash openssh-server openssh-client

# Install latest gcc
RUN add-apt-repository ppa:ubuntu-toolchain-r/test -y && apt update && apt install -y gcc g++

# Use clang to C and C++
RUN apt update && apt install -y lsb-release wget software-properties-common gnupg && bash -c "$(curl -SsL https://apt.llvm.org/llvm.sh)"
ENV CC=/usr/bin/clang CPP=/usr/bin/clang-cpp CXX=/usr/bin/clang++ LD=/usr/bin/ld.lld

# Install node apps
RUN npm i -g ts-node typescript autocannon pnpm

# Create docker and minikube start script
WORKDIR /usr/local/initd
COPY ./ ./
RUN chmod a+x ./start.sh && ln -s /usr/local/initd/start.sh /usr/local/bin/start.sh

VOLUME [ "/var/lib/docker" ]
CMD [ "zsh" ]
ENV MINIKUBE_ARGS="--driver=docker" DOCKERD_ARGS="--experimental"
WORKDIR /root
ENTRYPOINT [ "bash", "/usr/local/initd/start.sh" ]
