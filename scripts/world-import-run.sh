#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/world-import-run.sh [--transcript <path>] [--help] [--] <world-import args...>

Run memchat world-import in a TTY-safe way so ANSI-styled thinking output stays visible
in a terminal or herdr pane.

Examples:
  scripts/world-import-run.sh \
    --input samples/pg120-images-3.epub \
    --output world-output/pg120-images-3-$(date +%Y%m%d-%H%M%S) \
    --model openrouter/deepseek/deepseek-v4-pro \
    --show-tool-updates

  scripts/world-import-run.sh \
    --transcript world-output/pg120-images-3.typescript \
    --input samples/pg120-images-3.epub \
    --output world-output/pg120-images-3-tty \
    --model openrouter/deepseek/deepseek-v4-pro \
    --show-tool-updates

Notes:
  - Runs 'npm run world-import -- ...' directly by default.
  - Avoid piping through tee when you want styled thinking output.
  - --transcript uses 'script' to save a terminal transcript while keeping a pseudo-TTY.
EOF
}

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

transcript_path=""
forwarded=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --help|-h)
      usage
      exit 0
      ;;
    --transcript)
      if [[ $# -lt 2 ]]; then
        echo "world-import-run: missing value for --transcript" >&2
        exit 1
      fi
      transcript_path="$2"
      shift 2
      ;;
    --)
      shift
      while [[ $# -gt 0 ]]; do
        forwarded+=("$1")
        shift
      done
      ;;
    *)
      forwarded+=("$1")
      shift
      ;;
  esac

done

if [[ ${#forwarded[@]} -eq 0 ]]; then
  usage >&2
  exit 1
fi

cmd=(npm run world-import -- "${forwarded[@]}")

if [[ -n "$transcript_path" ]]; then
  mkdir -p "$(dirname "$transcript_path")"
  printf -v command_string '%q ' "${cmd[@]}"
  exec script -qef "$transcript_path" -c "${command_string% }"
fi

exec "${cmd[@]}"
