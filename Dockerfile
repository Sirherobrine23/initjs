# Build dive
FROM golang
WORKDIR /build
RUN git clone https://github.com/wagoodman/dive --depth=1 dive && \
cd dive && go build -o /dive.bin .

# Final Image
FROM debian:latest
ARG DEBIAN_FRONTEND="noninteractive"
# Install Basic packages, Docker, Docker Compose, minikube, kubectl, act, dive and gh ...
COPY --from=0 /dive.bin /usr/local/bin/dive
VOLUME [ "/var/lib/docker" ]
RUN apt update && apt install -y git curl wget sudo procps zsh tar screen ca-certificates procps lsb-release && \
  wget -qO- https://raw.githubusercontent.com/Sirherobrine23/DebianNodejsFiles/main/debianInstall.sh | bash && \
  wget -qO- https://get.docker.com | sh && \
  wget -q $(wget -qO- https://api.github.com/repos/docker/compose/releases/latest | grep 'browser_download_url' | grep -v '.sha' | cut -d '"' -f 4 | grep linux | grep $(uname -m) | head -n 1)\
  -O /usr/local/bin/docker-compose && chmod +x -v /usr/local/bin/docker-compose && \
  # Minikube
  curl -Lo minikube "https://storage.googleapis.com/minikube/releases/latest/minikube-linux-$(dpkg --print-architecture)" && \
  chmod +x minikube && mv minikube /usr/bin && \
  # Kubectl
  curl -LO "https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/linux/$(dpkg --print-architecture)/kubectl" && \
  chmod +x kubectl && mv kubectl /usr/bin && \
  # act (https://github.com/nektos/act)
  wget -qO- https://raw.githubusercontent.com/nektos/act/master/install.sh | bash && \
  # dive (https://github.com/wagoodman/dive)
  chmod a+x /usr/local/bin/dive && \
  # Install Github CLI (gh)
  (wget -q "$(wget -qO- https://api.github.com/repos/cli/cli/releases/latest | grep 'browser_download_url' | grep '.deb' | cut -d \" -f 4 | grep $(dpkg --print-architecture))" -O /tmp/gh.deb && dpkg -i /tmp/gh.deb && rm /tmp/gh.deb) || echo "Fail Install gh"

# Create docker and minikube start script
ENV MINIKUBE_ARGS="--driver=docker" DOCKERD_ARGS="--experimental"
COPY ./start.sh /usr/local/bin/start.sh
RUN chmod a+x /usr/local/bin/start.sh
ENTRYPOINT [ "/usr/local/bin/start.sh" ]

# Add non root user and Install oh my zsh
# ARG USERNAME="devcontainer" USER_UID="1000" USER_GID=$USER_UID
# RUN groupadd --gid $USER_GID $USERNAME && adduser --disabled-password --gecos "" --shell /usr/bin/zsh --uid $USER_UID --gid $USER_GID $USERNAME && usermod -aG sudo $USERNAME && echo "$USERNAME ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers.d/$USERNAME && chmod 0440 /etc/sudoers.d/$USERNAME && usermod -aG docker $USERNAME
# USER $USERNAME
# WORKDIR /home/$USERNAME
# RUN yes | sh -c "$(curl -fsSL https://raw.githubusercontent.com/robbyrussell/oh-my-zsh/master/tools/install.sh)" && \
#   git clone https://github.com/zsh-users/zsh-syntax-highlighting.git ~/.oh-my-zsh/custom/plugins/zsh-syntax-highlighting && \
#   git clone https://github.com/zsh-users/zsh-autosuggestions ~/.oh-my-zsh/custom/plugins/zsh-autosuggestions && \
#   sed -e 's|ZSH_THEME=".*"|ZSH_THEME="strug"|g' -i ~/.zshrc && \
#   sed -e 's|plugins=(.*)|plugins=(git docker kubectl zsh-syntax-highlighting zsh-autosuggestions)|g' -i ~/.zshrc
