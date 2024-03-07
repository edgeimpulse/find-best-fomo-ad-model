# 22.04
FROM ubuntu:jammy-20240227

WORKDIR /app

ARG DEBIAN_FRONTEND=noninteractive

RUN apt update && apt install -y curl

# Add Node.js through Nodesource
RUN curl -fsSL https://deb.nodesource.com/setup_18.x | bash - && \
    apt install -y nodejs

# Node dependencies
COPY package*.json ./
RUN npm ci

COPY . ./
RUN npm run build

ENTRYPOINT ["bash", "run.sh"]
