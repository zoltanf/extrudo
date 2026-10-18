# Extrudo as a Docker image (ADR-0091): nginx serving the built app (apps/web/dist)
# with the response headers of apps/web/public/_headers. No build steps here:
# run `pnpm build` first, then `docker build -t extrudo .`.
#
#   docker run -d -p 8080:80 ghcr.io/zoltanf/extrudo
FROM nginx:1.30-alpine

LABEL org.opencontainers.image.source="https://github.com/zoltanf/extrudo" \
      org.opencontainers.image.licenses="GPL-3.0-or-later" \
      org.opencontainers.image.title="Extrudo" \
      org.opencontainers.image.description="Browser-based parametric CAD for 3D printing"

COPY docker/nginx/maps.conf /etc/nginx/conf.d/00-maps.conf
COPY docker/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY docker/nginx/headers.conf /etc/nginx/extrudo/headers.conf
COPY apps/web/dist/ /usr/share/nginx/html/
EXPOSE 80
