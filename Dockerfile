# Base stage with all language servers
FROM node:20-slim AS base

# Install system dependencies for language servers
RUN apt-get update && apt-get install -y \
    # Basic utilities
    curl \
    git \
    python3 \
    python3-pip \
    python3-venv \
    # Language server dependencies
    clang \
    clangd \
    golang-go \
    openjdk-17-jdk \
    ruby \
    ruby-dev \
    build-essential \
    # Clean up
    && rm -rf /var/lib/apt/lists/*

# Set up Python virtual environment for language servers
RUN python3 -m venv /opt/python-lsp && \
    /opt/python-lsp/bin/pip install python-lsp-server[all]

# Install global language servers via npm
RUN npm install -g \
    typescript-language-server \
    typescript \
    intelephense \
    @tailwindcss/language-server \
    vscode-langservers-extracted \
    yaml-language-server

# Install Go language server (use a stable version)
RUN go install golang.org/x/tools/gopls@v0.16.1

# Install Ruby language server
RUN gem install solargraph

# Set up environment variables
ENV PATH="/opt/python-lsp/bin:$PATH"
ENV GOPATH=/opt/go
ENV PATH="$GOPATH/bin:$PATH"

# Create workspace directory for fallback mounting
RUN mkdir -p /workspace

# Development stage
FROM base AS development
WORKDIR /app
COPY package*.json ./
COPY tsconfig.json ./
COPY scripts/ ./scripts/
COPY src/ ./src/
COPY tests/ ./tests/
RUN npm ci
ENV NODE_ENV=development
# Container will start in the mounted directory (same path as host)
CMD ["npx", "tsx", "watch", "/app/src/index.ts"]

# CI/Testing stage - includes dev dependencies for type checking and testing
FROM base AS ci
WORKDIR /app
COPY package*.json ./
COPY tsconfig.json ./
COPY eslint.config.js ./
COPY jest.config.js ./
COPY scripts/ ./scripts/
COPY src/ ./src/
COPY tests/ ./tests/
RUN npm ci --include=dev
RUN npm run build
ENV NODE_ENV=test

# Build stage - includes dev dependencies for building only
FROM base AS build
WORKDIR /app
COPY package*.json ./
COPY tsconfig.json ./
COPY scripts/ ./scripts/
COPY src/ ./src/
RUN npm ci --include=dev
RUN npm run build

# Production stage - for now, same as build to avoid complexity
FROM build AS production
ENV NODE_ENV=production
# Container will start in the mounted directory (same path as host)
EXPOSE 3000
CMD ["node", "/app/dist/src/index.js"]