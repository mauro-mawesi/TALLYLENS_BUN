# Use Ubuntu as base for better compatibility
FROM ubuntu:22.04

# Set environment variables
ENV DEBIAN_FRONTEND=noninteractive
ENV BUN_INSTALL="/usr/local"

# Install system dependencies
RUN apt-get update && apt-get install -y \
    curl \
    git \
    unzip \
    postgresql-client \
    cmake \
    build-essential \
    python3 \
    sudo \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install Bun
RUN curl -fsSL https://bun.sh/install | bash

# Create a non-root user
RUN useradd -m -s /bin/bash vscode && \
    echo "vscode ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers

# Set working directory
WORKDIR /workspaces/backend

# Switch to non-root user
USER vscode

# Set Bun in PATH for the user
ENV PATH="/usr/local/bin:${PATH}"

# Verify Bun installation
RUN bun --version

# Set the default shell to bash
SHELL ["/bin/bash", "-c"]

# Default command
CMD ["bash"]