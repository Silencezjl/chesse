#!/bin/sh
set -eu
certificate=/opt/chesse-acme/letsencrypt/live/111.229.79.183/fullchain.pem
previous_certificate=$(sha256sum "$certificate")
docker run --rm \
  -v /opt/chesse-acme/letsencrypt:/etc/letsencrypt \
  -v /opt/chesse-acme/webroot:/var/www/certbot \
  -v /opt/chesse-acme/logs:/var/log/letsencrypt \
  certbot/certbot:v5.4.0 renew --quiet --no-random-sleep-on-renew
current_certificate=$(sha256sum "$certificate")
if [ "$previous_certificate" = "$current_certificate" ]; then exit 0; fi
docker exec chesse-shanghai-frontend-1 nginx -t
docker exec chesse-shanghai-frontend-1 nginx -s reload
