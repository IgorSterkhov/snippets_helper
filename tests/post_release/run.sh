#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
VENV_DIR="${POST_RELEASE_SMOKE_VENV:-${SCRIPT_DIR}/.venv}"
PYTHON_BIN="${PYTHON:-python3}"
REQUIREMENTS_FILE="${SCRIPT_DIR}/requirements.txt"
STAMP_FILE="${VENV_DIR}/.requirements.sha256"

if [ ! -x "${VENV_DIR}/bin/python" ]; then
  "${PYTHON_BIN}" -m venv "${VENV_DIR}"
fi

requirements_hash="$(sha256sum "${REQUIREMENTS_FILE}" | cut -d ' ' -f 1)"
installed_hash=""
if [ -f "${STAMP_FILE}" ]; then
  installed_hash="$(cat "${STAMP_FILE}")"
fi

if [ "${POST_RELEASE_SMOKE_REINSTALL:-0}" = "1" ] || [ "${installed_hash}" != "${requirements_hash}" ]; then
  "${VENV_DIR}/bin/python" -m pip install -r "${REQUIREMENTS_FILE}"
  printf '%s\n' "${requirements_hash}" > "${STAMP_FILE}"
fi

pytest_args=("$@")
has_test_path=0
for arg in "$@"; do
  if [[ "${arg}" != -* ]]; then
    has_test_path=1
    break
  fi
done

if [ "${has_test_path}" -eq 0 ]; then
  pytest_args=("tests/post_release" "${pytest_args[@]}")
fi

cd "${REPO_ROOT}"
exec "${VENV_DIR}/bin/python" -m pytest "${pytest_args[@]}"
