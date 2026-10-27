FROM node:20-alpine AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM golang:1.26-alpine AS api
WORKDIR /api
COPY api/go.mod api/go.sum ./
RUN go mod download
COPY api/ ./
COPY --from=web /web/out ./dist
RUN CGO_ENABLED=0 go build -ldflags="-s -w" -o /nbt .

# Runs as root so it can write to the Fly volume mounted at /data
FROM gcr.io/distroless/static-debian12
COPY --from=api /nbt /nbt
ENV NBT_ADDR=:8080 NBT_DB=/data/nbt.db
EXPOSE 8080
ENTRYPOINT ["/nbt"]
