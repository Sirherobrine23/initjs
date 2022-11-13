# Build dive
FROM golang
WORKDIR /build
RUN git clone https://github.com/wagoodman/dive --depth=1 dive && cd dive && go build -o /dive.bin .

# Build (PHP) compose
FROM php
WORKDIR /build
RUN curl -sS https://getcomposer.org/installer | php

# core Image
FROM ubuntu:latest AS core
# Install Basic packages
ARG DEBIAN_FRONTEND="noninteractive"
RUN apt update && apt list --upgradable -a && apt upgrade -y
RUN apt update && apt install -y software-properties-common cmake make build-essential git curl wget jq sudo procps zsh tar screen ca-certificates procps lsb-release gnupg gnupg2 gpg apt-transport-https python3-pip apt-file attr bash-completion bc bison clang command-not-found dialog dos2unix ed flex gawk gperf htop libresolv-wrapper lld llvm lsof man neofetch neovim rhash tree tshark unbound unzip xxhash openssh-server openssh-client && wget -qO- https://raw.githubusercontent.com/Sirherobrine23/DebianNodejsFiles/main/debianInstall.sh | bash && npm i -g ts-node typescript autocannon pnpm
STOPSIGNAL SIGSTOP
ENTRYPOINT [ "sudo", "-E", "initjs", "start", "--initjs-folder", "/usr/local/initd/initjs" ]
CMD [ "zsh" ]
RUN (echo '#''!/bin/bash'; echo 'set -ex';echo 'echo "Now use sudo -E node /usr/local/initd/src/index.js start --initjs-folder /usr/local/initd/initjs" or sudo -E initjs start --initjs-folder /usr/local/initd/initjs'; echo "sudo -E INITD_NO_EXIT=\"1\" initjs start --initjs-folder /usr/local/initd/initjs" '"$@"') | tee /usr/local/bin/start.sh && chmod a+x /usr/local/bin/start.sh
WORKDIR /usr/local/initd
COPY ./package*.json ./
RUN npm install --no-save
COPY ./ ./
RUN npm run build && npm link
WORKDIR /root

# Full Image
FROM core as full
# Docker, Docker Compose, dive (https://github.com/wagoodman/dive), act (https://github.com/nektos/act)
# ENV KUBECONFIG="/etc/kubeconf"
VOLUME [ "/var/lib/docker" ]
COPY --from=0 /dive.bin /usr/local/bin/dive
RUN wget -qO- https://get.docker.com | sh && \
  wget -q $(wget -qO- https://api.github.com/repos/docker/compose/releases/latest | grep 'browser_download_url' | grep -v '.sha' | cut -d '"' -f 4 | grep linux | grep $(uname -m) | head -n 1) -O /usr/local/bin/docker-compose && chmod +x -v /usr/local/bin/docker-compose && \
  wget -qO- https://raw.githubusercontent.com/nektos/act/master/install.sh | bash && \
  chmod a+x /usr/local/bin/dive && \
  # Install Kubectl
  curl -LO "https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/linux/$(dpkg --print-architecture)/kubectl" && \
  chmod +x kubectl && mv kubectl /usr/bin && \
  # Minikube
  curl -Lo minikube "https://storage.googleapis.com/minikube/releases/latest/minikube-linux-$(dpkg --print-architecture)" && \
  chmod +x minikube && mv minikube /usr/bin && \
  # Install k3d
  wget -q -O - https://raw.githubusercontent.com/k3d-io/k3d/main/install.sh | bash

# Install Prometheus
RUN groupadd --system prometheus && useradd -s /sbin/nologin --system -g prometheus prometheus && \
  mkdir /var/lib/prometheus && for i in rules rules.d files_sd; do mkdir -vp /etc/prometheus/${i}; done && \
  cd /tmp && mkdir prometheus && cd prometheus && \
  curl -s https://api.github.com/repos/prometheus/prometheus/releases/latest | grep browser_download_url | grep linux-$(dpkg --print-architecture) | cut -d '"' -f 4 | wget -O- -qi - | tar -xzvf - && \
  cd prometheus*/ && mv prometheus promtool /usr/local/bin/ && mv prometheus.yml /etc/prometheus/prometheus.yml && mv consoles/ console_libraries/ /etc/prometheus/ && \
  rm -rf /tmp/* && for i in rules rules.d files_sd; do chown -R prometheus:prometheus /etc/prometheus/${i}; done && for i in rules rules.d files_sd; do chmod -R 775 /etc/prometheus/${i}; done && chown -R prometheus:prometheus /var/lib/prometheus/ && \
  # Grafana
  wget -q -O /usr/share/keyrings/grafana.key https://packages.grafana.com/gpg.key && \
  echo "deb [signed-by=/usr/share/keyrings/grafana.key] https://packages.grafana.com/enterprise/deb stable main" | tee -a /etc/apt/sources.list.d/grafana.list && \
  apt update && apt install -y grafana

# Install Github CLI (gh)
RUN (wget -q "$(wget -qO- https://api.github.com/repos/cli/cli/releases/latest | grep 'browser_download_url' | grep '.deb' | cut -d \" -f 4 | grep $(dpkg --print-architecture))" -O /tmp/gh.deb && dpkg -i /tmp/gh.deb && rm /tmp/gh.deb) || echo "Fail Install gh"

# Install httpie
RUN pip install --upgrade pip wheel && pip install --upgrade httpie

# PHP and compose
COPY --from=1 /build/composer.phar /usr/share/composer/composer.phar
RUN apt update && apt install -y php && echo "php /usr/share/composer/composer.phar \"\$@\"" > /usr/local/bin/composer && chmod +x /usr/local/bin/composer

# Install Openjdk
RUN apt update && apt list | grep -E 'openjdk-[0-9\.]+-(jre|jdk)' | grep -v -E 'headless|zero' | cut -d / -f 1 | xargs apt install -y

# Install rust
ENV RUSTUP_HOME="/usr" CARGO_HOME="/usr"
RUN curl https://sh.rustup.rs -sSf | sh -s -- -y --no-modify-path

# Go (golang)
ARG GOVERSION="1.19.3"
RUN wget -qO- "https://go.dev/dl/go${GOVERSION}.linux-$(dpkg --print-architecture).tar.gz" | tar -C /usr/local -xzf - && ln -s /usr/local/go/bin/go /usr/bin/go && ln -s /usr/local/go/bin/gofmt /usr/bin/gofmt
