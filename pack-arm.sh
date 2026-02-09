#!/bin/bash
set -e

# ============================================
# Cheese 项目 ARM64 离线打包脚本
# 在有网络的 ARM 机器上运行此脚本
# ============================================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
OUTPUT_DIR="${SCRIPT_DIR}/offline-package-arm"
APP_IMAGE_NAME="chesse-cheese-thief:arm64"
REDIS_IMAGE="docker.m.daocloud.io/redis:7-alpine"

echo "=========================================="
echo "  Cheese ARM64 离线打包工具"
echo "=========================================="

# 清理旧的打包目录
rm -rf "${OUTPUT_DIR}"
mkdir -p "${OUTPUT_DIR}"

# Step 1: 构建应用镜像 (使用 Dockerfile.arm)
echo ""
echo "[1/4] 构建 ARM64 应用镜像..."
docker build -f "${SCRIPT_DIR}/Dockerfile.arm" -t "${APP_IMAGE_NAME}" "${SCRIPT_DIR}"
echo "  ✓ ARM64 应用镜像构建完成"

# Step 2: 确保 Redis 镜像存在 (ARM 原生拉取)
echo ""
echo "[2/4] 拉取 ARM64 Redis 镜像..."
docker pull --platform linux/arm64 "${REDIS_IMAGE}" 2>/dev/null || echo "  (使用本地已有的 Redis 镜像)"
echo "  ✓ Redis ARM64 镜像就绪"

# Step 3: 导出镜像为 tar 文件
echo ""
echo "[3/4] 导出镜像..."
docker save -o "${OUTPUT_DIR}/cheese-thief-arm.tar" "${APP_IMAGE_NAME}"
echo "  ✓ 应用镜像已导出: cheese-thief-arm.tar"

docker save -o "${OUTPUT_DIR}/redis-arm.tar" "${REDIS_IMAGE}"
echo "  ✓ Redis 镜像已导出: redis-arm.tar"

# Step 4: 复制部署文件
echo ""
echo "[4/4] 生成内网部署文件..."

cp "${SCRIPT_DIR}/docker-compose-arm.yml" "${OUTPUT_DIR}/docker-compose.yml"
cp "${SCRIPT_DIR}/deploy-arm.sh" "${OUTPUT_DIR}/deploy.sh" 2>/dev/null || true

# 打包成一个压缩文件
echo ""
echo "正在压缩..."
cd "${SCRIPT_DIR}"
tar czf cheese-offline-arm.tar.gz -C "${OUTPUT_DIR}" .

echo ""
echo "=========================================="
echo "  ARM64 打包完成！"
echo "=========================================="
echo ""
echo "产出文件:"
echo "  ${SCRIPT_DIR}/cheese-offline-arm.tar.gz"
echo ""
echo "包含内容:"
echo "  - cheese-thief-arm.tar  (ARM64 应用镜像)"
echo "  - redis-arm.tar          (ARM64 Redis 镜像)"
echo "  - docker-compose.yml     (编排文件，已适配 ARM64)"
echo "  - deploy.sh              (一键部署脚本)"
echo ""
echo "将 cheese-offline-arm.tar.gz 拷贝到内网 ARM 机器后运行:"
echo "  tar xzf cheese-offline-arm.tar.gz"
echo "  bash deploy.sh"
echo ""

# 清理中间目录
rm -rf "${OUTPUT_DIR}"
