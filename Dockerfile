# syntax = docker/dockerfile:1

# Zero runtime dependencies: the server only uses node:http and node:sqlite,
# both built in, so there's nothing to install here.
FROM node:24-alpine
WORKDIR /app
COPY src ./src
COPY README.md ./
ENV PORT=8080
EXPOSE 8080
CMD ["node", "src/server.ts"]
