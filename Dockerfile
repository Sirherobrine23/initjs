FROM ubuntu:latest
RUN apt update && apt install -y curl wget git zsh

# Install Docker and Docker Compose
RUN curl https://get.docker.com | sh && \
  VERSION=$(curl -s https://api.github.com/repos/docker/compose/releases/latest | grep tag_name | cut -d '"' -f 4) && \
  wget "https://github.com/docker/compose/releases/download/${VERSION}/docker-compose-linux-$(uname -m)" -O /usr/local/bin/docker-compose && \
  chmod +x /usr/local/bin/docker-compose

ENV \
  DOCKER_HOST=tcp://docker.sirherobrine23.org:2375 \
  DOCKER_TLS_VERIFY=1 \
  DOCKER_CERT_PATH=/DockerCert

# Install ZSH and oh-my-zsh
RUN yes | sh -c "$(curl -fsSL https://raw.github.com/ohmyzsh/ohmyzsh/master/tools/install.sh)" && \
  git clone https://github.com/zsh-users/zsh-syntax-highlighting.git ~/.oh-my-zsh/custom/plugins/zsh-syntax-highlighting && \
  git clone https://github.com/zsh-users/zsh-autosuggestions ~/.oh-my-zsh/custom/plugins/zsh-autosuggestions && \
  sed -e 's/ZSH_THEME=".*"/ZSH_THEME="strug"/g' -i ~/.zshrc && \
  sed -e 's/plugins=(.*)/plugins=(git docker zsh-syntax-highlighting zsh-autosuggestions)/g' -i ~/.zshrc && \
  usermod -s $(command -v zsh) root
CMD ["/usr/bin/zsh"]

# Install Github CLI
ARG ghcli_arch="amd64"
RUN VERSION=$(curl -s https://api.github.com/repos/cli/cli/releases/latest | grep tag_name | cut -d '"' -f 4 | cut -d 'v' -f 2) && \
  wget "https://github.com/cli/cli/releases/download/v${VERSION}/gh_${VERSION}_linux_${ghcli_arch}.deb" -O /tmp/gh_cli.deb && \
  dpkg -i /tmp/gh_cli.deb && \
  rm /tmp/gh_cli.deb