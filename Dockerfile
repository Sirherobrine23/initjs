FROM debian:latest

# Install Basic packages
ARG DEBIAN_FRONTEND="noninteractive"
RUN apt update && apt install -y git curl wget sudo procps zsh tar screen ca-certificates procps lsb-release && \
  wget -qO- https://raw.githubusercontent.com/Sirherobrine23/DebianNodejsFiles/main/debianInstall.sh | bash

# Install Docker, Docker Compose and minikube and kubectl
VOLUME [ "/var/lib/docker" ]
RUN wget -qO- https://get.docker.com | sh && \
  wget -q $(wget -qO- https://api.github.com/repos/docker/compose/releases/latest | grep 'browser_download_url' | grep -v '.sha' | cut -d '"' -f 4 | grep linux | grep $(uname -m) | head -n 1)\
  -O /usr/local/bin/docker-compose && chmod +x -v /usr/local/bin/docker-compose && \
  curl -Lo minikube "https://storage.googleapis.com/minikube/releases/latest/minikube-linux-$(dpkg --print-architecture)" && \
  chmod +x minikube && mv minikube /usr/bin && \
  curl -LO "https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/linux/$(dpkg --print-architecture)/kubectl" && \
  chmod +x kubectl && mv kubectl /usr/bin

# Create docker and minikube start script
ARG MINIKUBE_ARGS="--driver=docker"
ARG DOCKERD_ARGS="--experimental"
RUN (echo '#''!/bin/bash';\
echo 'EXISTDOCKER="1"';\
echo "if command -v dockerd &> /dev/null; then";\
echo '  if ! [[ -f "/var/run/docker.sock" ]];then';\
echo "    (sudo dockerd ${DOCKERD_ARGS}) &";\
echo "    (minikube start ${MINIKUBE_ARGS}) &";\
echo "    sleep 5s";\
echo "  fi";\
echo "else";\
echo '  EXISTDOCKER="0"';\
echo '  echo "o Docker não está instalado!"';\
echo "fi";\
echo "";\
echo "# Run script";\
echo 'if ! [[ -z "\$@" ]]; then';\
echo '  sh -c "\$@"';\
echo "fi";\
echo "";\
echo "# Sleep script";\
echo "sleep infinity";\
echo "exit") | tee /usr/local/bin/start.sh && chmod a+x /usr/local/bin/start.sh

# Add non root user
ARG USERNAME="devcontainer"
ARG USER_UID="1000"
ARG USER_GID=$USER_UID
RUN groupadd --gid $USER_GID $USERNAME && adduser --disabled-password --gecos "" --shell /usr/bin/zsh --uid $USER_UID --gid $USER_GID $USERNAME && usermod -aG sudo $USERNAME && echo "$USERNAME ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers.d/$USERNAME && chmod 0440 /etc/sudoers.d/$USERNAME && usermod -aG docker $USERNAME
USER $USERNAME
WORKDIR /home/$USERNAME

# Install oh my zsh
RUN yes | sh -c "$(curl -fsSL https://raw.githubusercontent.com/robbyrussell/oh-my-zsh/master/tools/install.sh)" && \
  git clone https://github.com/zsh-users/zsh-syntax-highlighting.git ~/.oh-my-zsh/custom/plugins/zsh-syntax-highlighting && \
  git clone https://github.com/zsh-users/zsh-autosuggestions ~/.oh-my-zsh/custom/plugins/zsh-autosuggestions && \
  sed -e 's|ZSH_THEME=".*"|ZSH_THEME="strug"|g' -i ~/.zshrc && \
  sed -e 's|plugins=(.*)|plugins=(git docker kubectl zsh-syntax-highlighting zsh-autosuggestions)|g' -i ~/.zshrc

# Start Script
ENTRYPOINT [ "/usr/local/bin/start.sh" ]
