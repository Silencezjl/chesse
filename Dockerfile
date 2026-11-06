ARG NODE_IMAGE=node:22-alpine
ARG NGINX_IMAGE=nginx:alpine
ARG PYTHON_IMAGE=python:3.11-slim
FROM ${NODE_IMAGE} AS web-build
WORKDIR /app
COPY package*.json ./
RUN npm ci --no-audit --no-fund
COPY vite.config.mjs postcss.config.cjs ./
COPY lobby-web/ ./lobby-web/
COPY web/ ./web/
RUN npm run build

FROM ${NGINX_IMAGE} AS frontend
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=web-build /app/dist/ /usr/share/nginx/html/
EXPOSE 80

FROM ${PYTHON_IMAGE} AS backend
WORKDIR /app/backend
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -i https://pypi.tuna.tsinghua.edu.cn/simple -r requirements.txt
COPY backend/ ./
EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
