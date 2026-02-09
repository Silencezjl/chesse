#!/bin/bash
set -e

# ============================================
# Cheese 项目离线打包脚本
# 在有网络的机器上运行此脚本
# ============================================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
OUTPUT_DIR="${SCRIPT_DIR}/offline-package"
APP_IMAGE_NAME="chesse-cheese-thief"
REDIS_IMAGE="docker.m.daocloud.io/redis:7-alpine"

echo "=========================================="
echo "  Cheese 离线打包工具"
echo "=========================================="

# 清理旧的打包目录
rm -rf "${OUTPUT_DIR}"
mkdir -p "${OUTPUT_DIR}"

# Step 1: 构建应用镜像
echo ""
echo "[1/4] 构建应用镜像..."
docker compose -f "${SCRIPT_DIR}/docker-compose.yml" build
echo "  ✓ 应用镜像构建完成"

# 确认实际镜像名称
ACTUAL_IMAGE=$(docker compose -f "${SCRIPT_DIR}/docker-compose.yml" images cheese-thief --format json 2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin)[0]['Repository'])" 2>/dev/null || echo "")
if [ -z "${ACTUAL_IMAGE}" ]; then
    # fallback: 尝试从 docker images 中查找
    ACTUAL_IMAGE=$(docker images --format '{{.Repository}}' | grep -i "cheese" | head -1 || echo "${APP_IMAGE_NAME}")
fi
echo "  镜像名称: ${ACTUAL_IMAGE}"

# Step 2: 确保 Redis 镜像存在
echo ""
echo "[2/4] 拉取 Redis 镜像..."
docker pull "${REDIS_IMAGE}" 2>/dev/null || echo "  (使用本地已有的 Redis 镜像)"
echo "  ✓ Redis 镜像就绪"

# Step 3: 导出镜像为 tar 文件
echo ""
echo "[3/4] 导出镜像..."
docker save -o "${OUTPUT_DIR}/cheese-thief.tar" "${ACTUAL_IMAGE}"
echo "  ✓ 应用镜像已导出: cheese-thief.tar"

docker save -o "${OUTPUT_DIR}/redis.tar" "${REDIS_IMAGE}"
echo "  ✓ Redis 镜像已导出: redis.tar"

# Step 4: 生成内网用的 docker-compose.yml（将 build 替换为 image）
echo ""
echo "[4/4] 生成内网部署文件..."

sed 's|    build: \.|    image: '"${ACTUAL_IMAGE}"'|' "${SCRIPT_DIR}/docker-compose.yml" > "${OUTPUT_DIR}/docker-compose.yml"

# 复制部署脚本
cp "${SCRIPT_DIR}/deploy.sh" "${OUTPUT_DIR}/deploy.sh" 2>/dev/null || true

# 打包成一个压缩文件
echo ""
echo "正在压缩..."
cd "${SCRIPT_DIR}"
tar czf cheese-offline.tar.gz -C "${OUTPUT_DIR}" .

echo ""
echo "=========================================="
echo "  打包完成！"
echo "=========================================="
echo ""
echo "产出文件:"
echo "  ${SCRIPT_DIR}/cheese-offline.tar.gz"
echo ""
echo "包含内容:"
echo "  - cheese-thief.tar  (应用镜像)"
echo "  - redis.tar          (Redis 镜像)"
echo "  - docker-compose.yml (编排文件，已适配内网)"
echo "  - deploy.sh          (一键部署脚本)"
echo ""
echo "将 cheese-offline.tar.gz 拷贝到内网机器后运行:"
echo "  tar xzf cheese-offline.tar.gz"
echo "  bash deploy.sh"
echo ""

# 清理中间目录
rm -rf "${OUTPUT_DIR}"
