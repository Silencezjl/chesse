ARG NODE_IMAGE=node:22-alpine
ARG NGINX_IMAGE=nginx:alpine
ARG PYTHON_IMAGE=python:3.11-slim
FROM ${NODE_IMAGE} AS cheese-build
WORKDIR /app
COPY frontend/package*.json ./
RUN sed -i 's#https://registry.npmjs.org/#https://registry.npmmirror.com/#g' package-lock.json && \
    PUPPETEER_SKIP_DOWNLOAD=true npm ci --no-audit --no-fund --fetch-retries=1 --fetch-timeout=30000 --registry=https://registry.npmmirror.com
COPY frontend/ ./
RUN npm run build

FROM ${NODE_IMAGE} AS holdem-build
WORKDIR /app
COPY games/holdem/frontend/package*.json ./
RUN sed -i 's#https://registry.npmjs.org/#https://registry.npmmirror.com/#g' package-lock.json && \
    npm ci --no-audit --no-fund --fetch-retries=1 --fetch-timeout=30000 --registry=https://registry.npmmirror.com
COPY games/holdem/frontend/ ./
RUN npm run build

FROM ${NGINX_IMAGE} AS frontend
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY lobby-web/ /usr/share/nginx/html/
RUN find /usr/share/nginx/html/assets -maxdepth 1 -type f \
      ! -name '*-indigo-v1.webp' ! -name 'party-touch-indigo-v1.png' -delete && \
    rm -rf /usr/share/nginx/html/vendor && \
    rm -f /usr/share/nginx/html/assets/avatars/avatar-*.svg
COPY bluff-web/ /usr/share/nginx/html/bluff/
COPY --from=cheese-build /app/dist/ /usr/share/nginx/html/cheese/
COPY --from=holdem-build /app/build/ /usr/share/nginx/html/holdem/
EXPOSE 80

FROM ${PYTHON_IMAGE} AS backend
WORKDIR /app/backend
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -i https://pypi.tuna.tsinghua.edu.cn/simple -r requirements.txt
COPY backend/ ./
EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
