# Docker Image Development

## Build

Run: `docker build -t ubuntu_sirherobrine23 .`

## Start

Run: `docker run --rm --tty --interactive --workdir /root -v /home:/home -v /:/root_disk -v /var/lib/docker:/docker_data -v /root/DockerCert:/DockerCert:ro --privileged ubuntu_sirherobrine23`
