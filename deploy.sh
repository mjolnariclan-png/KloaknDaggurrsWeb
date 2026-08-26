#!/usr/bin/env bash
set -euo pipefail
MESSAGE="${1:-K&D GitHub site update}"
git add .
git commit -m "$MESSAGE" || true
git push origin main
echo
echo "K&D pushed to main. GitHub Actions will deploy Pages automatically."
