# LocalAI llama-cpp backend sidecar — locally built, first-party only.
#
# The backend bundle is the fork-built LocalAI llama-cpp gRPC backend at
# LLAMA_VERSION 58190cc8 (the estate's llama.cpp pin) and is fully
# self-contained: its own ld.so/libc and the complete CUDA 12.6 runtime
# (cublas/cudart/cudnn). The host contributes only the NVIDIA driver via
# `runtime: nvidia` — so the base is plain Ubuntu, not an L4T image.
#
# Purpose: dedicated per-model sidecars (first user: moonlight-16b-a3b)
# whose load failures crash only themselves, never the shared backend.
# Build/push: sidecar/build-and-push.sh in the LocalAI fork.
FROM ubuntu:22.04

COPY backend-bundle/ /opt/llama-backend/

WORKDIR /opt/llama-backend
ENV LD_LIBRARY_PATH=/opt/llama-backend/lib:/usr/local/cuda/lib64:/usr/lib/aarch64-linux-gnu/nvidia:/usr/local/cuda/compat

ENTRYPOINT ["/bin/bash", "-c", "cd /opt/llama-backend && exec ./lib/ld.so ./llama-cpp-fallback --addr ${BACKEND_ADDR:-0.0.0.0:50072}"]
