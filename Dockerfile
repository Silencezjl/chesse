# ---- Stage 1: Build Frontend ----
FROM docker.m.daocloud.io/node:18-alpine AS frontend-build

WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm config set registry https://registry.npmmirror.com && npm install
COPY frontend/ ./
RUN npm run build

# ---- Stage 2: Frontend (nginx) ----
FROM docker.m.daocloud.io/nginx:alpine AS frontend

# Remove default nginx config
RUN rm /etc/nginx/conf.d/default.conf

# Copy custom nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy built frontend
COPY --from=frontend-build /app/frontend/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]

# ---- Stage 3: Backend ----
FROM docker.m.daocloud.io/python:3.11-slim AS backend

WORKDIR /app

# Install Python dependencies
COPY backend/requirements.txt /app/backend/requirements.txt
RUN pip install --no-cache-dir -i https://mirrors.aliyun.com/pypi/simple/ -r /app/backend/requirements.txt

# Copy backend code
COPY backend/ /app/backend/

WORKDIR /app/backend

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", \
     "--workers", "1", \
     "--loop", "uvloop", \
     "--http", "httptools", \
     "--ws", "websockets", \
     "--backlog", "4096", \
     "--timeout-keep-alive", "30", \
     "--limit-concurrency", "2000", \
     "--ws-max-size", "65536"]
