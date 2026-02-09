# ---- Stage 1: Build Frontend ----
FROM docker.m.daocloud.io/node:18-alpine AS frontend-build

WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm config set registry https://registry.npmmirror.com && npm install
COPY frontend/ ./
RUN npm run build

# ---- Stage 2: Run Backend + Serve Frontend ----
FROM docker.m.daocloud.io/python:3.11-slim

WORKDIR /app

# Install Python dependencies
COPY backend/requirements.txt /app/backend/requirements.txt
RUN pip install --no-cache-dir -i https://mirrors.aliyun.com/pypi/simple/ -r /app/backend/requirements.txt

# Copy backend code
COPY backend/ /app/backend/

# Copy built frontend from stage 1
COPY --from=frontend-build /app/frontend/dist /app/frontend/dist

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
