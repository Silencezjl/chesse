#!/bin/bash
set -e

# ============================================
# Cheese 项目内网部署脚本
# 在内网机器上运行此脚本
# 前提：已解压 cheese-offline.tar.gz
# ============================================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "=========================================="
echo "  Cheese 内网部署工具"
echo "=========================================="

# 检查 Docker 是否可用
if ! command -v docker &> /dev/null; then
    echo "错误: 未检测到 Docker，请先安装 Docker"
    exit 1
fi

if ! docker info &> /dev/null; then
    echo "错误: Docker 服务未运行，请先启动 Docker"
    exit 1
fi

# 检查必要文件
for file in cheese-thief.tar redis.tar docker-compose.yml; do
    if [ ! -f "${SCRIPT_DIR}/${file}" ]; then
        echo "错误: 缺少文件 ${file}"
        echo "请确保已正确解压 cheese-offline.tar.gz"
        exit 1
    fi
done

# Step 1: 加载镜像
echo ""
echo "[1/3] 加载应用镜像..."
docker load -i "${SCRIPT_DIR}/cheese-thief.tar"
echo "  ✓ 应用镜像加载完成"

echo ""
echo "[2/3] 加载 Redis 镜像..."
docker load -i "${SCRIPT_DIR}/redis.tar"
echo "  ✓ Redis 镜像加载完成"

# Step 3: 启动服务
echo ""
echo "[3/3] 启动服务..."
docker compose -f "${SCRIPT_DIR}/docker-compose.yml" up -d

echo ""
echo "=========================================="
echo "  部署完成！"
echo "=========================================="
echo ""
echo "服务状态:"
docker compose -f "${SCRIPT_DIR}/docker-compose.yml" ps
echo ""
echo "访问地址: http://localhost:8000"
echo ""
echo "常用命令:"
echo "  查看日志:   docker compose -f ${SCRIPT_DIR}/docker-compose.yml logs -f"
echo "  停止服务:   docker compose -f ${SCRIPT_DIR}/docker-compose.yml down"
echo "  重启服务:   docker compose -f ${SCRIPT_DIR}/docker-compose.yml restart"
echo ""
