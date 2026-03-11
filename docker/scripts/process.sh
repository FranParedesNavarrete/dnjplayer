#!/bin/bash
set -euo pipefail

# dnjplayer Anime4K pre-processing script
# Environment variables:
#   INPUT_URL    - Source video URL (MEGAcmd WebDAV)
#   OUTPUT_FILE  - Output file path
#   TARGET_W     - Target width (e.g., 3840 for 4K)
#   TARGET_H     - Target height (e.g., 2160 for 4K)
#   SHADER_PATH  - Path to Anime4K GLSL shader file

: "${INPUT_URL:?INPUT_URL is required}"
: "${OUTPUT_FILE:?OUTPUT_FILE is required}"
: "${TARGET_W:=3840}"
: "${TARGET_H:=2160}"
: "${SHADER_PATH:=/shaders/Anime4K_Upscale_CNN_x2_VL.glsl}"

echo "=== dnjplayer Anime4K Processor ==="
echo "Input:  ${INPUT_URL}"
echo "Output: ${OUTPUT_FILE}"
echo "Target: ${TARGET_W}x${TARGET_H}"
echo "Shader: ${SHADER_PATH}"
echo "==================================="

ffmpeg -y \
  -init_hw_device vulkan=vk:0 \
  -hwaccel auto \
  -i "${INPUT_URL}" \
  -vf "hwupload=derive_device=vulkan,libplacebo=w=${TARGET_W}:h=${TARGET_H}:custom_shader_path=${SHADER_PATH}:disable_multiplane=1,hwdownload,format=nv12" \
  -c:v hevc_nvenc -preset p7 -cq 18 \
  -c:a copy \
  -progress pipe:1 \
  "${OUTPUT_FILE}"

echo "Processing complete: ${OUTPUT_FILE}"
