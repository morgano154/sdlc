#!/usr/bin/env bash
# scripts/create-cluster.sh
# Creates a local k3d cluster suitable for Module 6.
# Requires: k3d (https://k3d.io), kubectl

set -euo pipefail

CLUSTER_NAME="taskflow"
API_PORT=6550
HTTP_PORT=8080
HTTPS_PORT=8443

echo "==> Checking for k3d..."
if ! command -v k3d &> /dev/null; then
  echo "k3d not found. Installing via curl..."
  curl -s https://raw.githubusercontent.com/k3d-io/k3d/main/install.sh | bash
fi

echo "==> Creating k3d cluster: ${CLUSTER_NAME}"
k3d cluster create "${CLUSTER_NAME}" \
  --api-port "${API_PORT}" \
  --port "${HTTP_PORT}:80@loadbalancer" \
  --port "${HTTPS_PORT}:443@loadbalancer" \
  --agents 2

echo "==> Waiting for nodes to be ready..."
kubectl wait --for=condition=Ready nodes --all --timeout=60s

echo "==> Cluster info:"
kubectl cluster-info
kubectl get nodes

echo ""
echo "✅ Cluster '${CLUSTER_NAME}' is ready."
echo "   kubectl context is already set — run 'kubectl get nodes' to verify."
echo ""
echo "   To delete the cluster later: k3d cluster delete ${CLUSTER_NAME}"
