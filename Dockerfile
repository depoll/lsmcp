# Base stage with all language servers
FROM node:20-slim AS base

# Install system dependencies for language servers
RUN apt-get update && apt-get install -y \
    # Basic utilities
    curl \
    git \
    unzip \
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

# Python is now handled by Pyright (installed via npm below)

# Install global language servers via npm
RUN npm install -g \
    typescript-language-server \
    typescript \
    pyright \
    intelephense \
    @tailwindcss/language-server \
    vscode-langservers-extracted \
    yaml-language-server \
    bash-language-server

# Install Go language server (use a stable version)
RUN go install golang.org/x/tools/gopls@v0.16.1

# Install Ruby language server
RUN gem install solargraph

# Install Rust analyzer
RUN curl -L https://github.com/rust-lang/rust-analyzer/releases/latest/download/rust-analyzer-x86_64-unknown-linux-gnu.gz | \
    gunzip -c - > /usr/local/bin/rust-analyzer && \
    chmod +x /usr/local/bin/rust-analyzer

# Install .NET SDK and OmniSharp C# language server
RUN apt-get update && apt-get install -y wget && \
    wget https://dot.net/v1/dotnet-install.sh -O dotnet-install.sh && \
    chmod +x dotnet-install.sh && \
    ./dotnet-install.sh --channel 8.0 --install-dir /usr/share/dotnet && \
    ln -s /usr/share/dotnet/dotnet /usr/bin/dotnet && \
    rm dotnet-install.sh && \
    rm -rf /var/lib/apt/lists/*

# Install OmniSharp separately as it's not a dotnet tool
RUN mkdir -p /opt/omnisharp && \
    curl -L https://github.com/OmniSharp/omnisharp-roslyn/releases/latest/download/omnisharp-linux-x64-net6.0.tar.gz | \
    tar xz -C /opt/omnisharp && \
    chmod +x /opt/omnisharp/OmniSharp && \
    ln -s /opt/omnisharp/OmniSharp /usr/local/bin/omnisharp

# Add .NET tools to PATH
ENV PATH="/root/.dotnet/tools:$PATH"

# Install Java LSP (eclipse.jdt.ls)
RUN mkdir -p /opt/eclipse.jdt.ls && \
    curl -L "https://download.eclipse.org/jdtls/snapshots/jdt-language-server-latest.tar.gz" | \
    tar -xz -C /opt/eclipse.jdt.ls

# Install Kotlin language server
RUN curl -L "https://github.com/fwcd/kotlin-language-server/releases/latest/download/server.zip" -o /tmp/kotlin-ls.zip && \
    unzip /tmp/kotlin-ls.zip -d /opt/kotlin-language-server && \
    chmod +x /opt/kotlin-language-server/server/bin/kotlin-language-server && \
    ln -s /opt/kotlin-language-server/server/bin/kotlin-language-server /usr/local/bin/kotlin-language-server && \
    rm /tmp/kotlin-ls.zip

# Install Swift (for Swift language server)
# Note: Swift installation is complex and platform-specific
# For production, consider using a Swift base image or installing via package manager
# This is a placeholder - Swift LSP (sourcekit-lsp) comes with Swift toolchain
RUN echo "Swift installation skipped - use swift:latest base image for Swift support"

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