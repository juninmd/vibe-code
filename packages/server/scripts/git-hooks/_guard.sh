#!/bin/sh
# vibe-code git hook guard. Agents and the server run git with core.hooksPath
# pointing here (GIT_CONFIG_PARAMETERS), so every hook lands in this script:
# pre-push scans the pushed commits with gitleaks and runs the repo's tests,
# then each hook hands over to the repository's own hook (husky, .git/hooks).
name="$1"
shift
here=$(cd "$(dirname "$0")" && pwd -P)
root=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
zero=0000000000000000000000000000000000000000
input=""
[ "$name" = pre-push ] && input=$(cat)

say() { printf 'vibe-code pre-push: %s\n' "$*" >&2; }

scan_secrets() {
  if ! command -v gitleaks >/dev/null 2>&1; then
    if [ "${VIBE_REQUIRE_GITLEAKS:-}" = 1 ]; then
      say "gitleaks is not installed; push blocked."
      return 1
    fi
    say "gitleaks is not installed; secret scan skipped."
    return 0
  fi
  printf '%s\n' "$input" | while read -r _lref lsha _rref rsha; do
    [ -z "$lsha" ] || [ "$lsha" = "$zero" ] && continue
    # New branch, or a remote tip we never fetched: scan what no remote ref has yet.
    if [ "$rsha" = "$zero" ] || ! git cat-file -e "$rsha^{commit}" 2>/dev/null; then
      range="$lsha --not --remotes"
    else
      range="$rsha..$lsha"
    fi
    gitleaks git --no-banner --redact --log-level error --log-opts="$range" "$root" >&2 || {
      say "gitleaks found secrets in the pushed commits; push blocked. Remove them and rewrite the commits."
      exit 1
    }
  done
}

test_command() {
  if [ -f "$root/package.json" ] && node -e '
    const t = require(process.argv[1]).scripts?.test;
    process.exit(t && !/no test specified/.test(t) ? 0 : 1)' "$root/package.json" 2>/dev/null; then
    if [ -f "$root/bun.lock" ] || [ -f "$root/bun.lockb" ]; then echo "bun run test"
    elif [ -f "$root/pnpm-lock.yaml" ]; then echo "pnpm test"
    elif [ -f "$root/yarn.lock" ]; then echo "yarn test"
    else echo "npm test"; fi
  elif [ -f "$root/Makefile" ] && grep -q '^test:' "$root/Makefile"; then echo "make test"
  elif [ -f "$root/go.mod" ]; then echo "go test ./..."
  elif [ -f "$root/Cargo.toml" ]; then echo "cargo test"
  fi
}

run_tests() {
  [ "${VIBE_PREPUSH_TESTS:-on}" = off ] && return 0
  cmd=$(test_command)
  [ -z "$cmd" ] && return 0
  say "running $cmd"
  bound=""
  command -v timeout >/dev/null 2>&1 && bound="timeout ${VIBE_PREPUSH_TEST_TIMEOUT:-900}"
  # Tests that push to scratch repos must not re-enter this guard or inherit git hook env vars.
  (cd "$root" && env -u GIT_CONFIG_PARAMETERS -u GIT_DIR -u GIT_WORK_TREE -u GIT_INDEX_FILE -u GIT_COMMON_DIR -u GIT_OBJECT_DIRECTORY -u GIT_ALTERNATE_OBJECT_DIRECTORIES -u GIT_PREFIX VIBE_HOOK_GUARD_ACTIVE=1 CI=true \
    $bound sh -c "$cmd") >&2 || {
    say "tests failed ($cmd); push blocked. Set VIBE_PREPUSH_TESTS=off only with a reason."
    return 1
  }
}

if [ "$name" = pre-push ] && [ -z "${VIBE_HOOK_GUARD_ACTIVE:-}" ]; then
  scan_secrets || exit 1
  run_tests || exit 1
fi

# Hand over to the repository's own hook, ignoring the override that led here.
dir=$(env -u GIT_CONFIG_PARAMETERS git config --get core.hooksPath 2>/dev/null)
if [ -z "$dir" ]; then
  dir="$(git rev-parse --git-common-dir)/hooks"
else
  case "$dir" in /*) ;; *) dir="$root/$dir" ;; esac
fi
[ -d "$dir" ] && [ "$(cd "$dir" && pwd -P)" = "$here" ] && exit 0
hook="$dir/$name"
[ -x "$hook" ] || exit 0
if [ "$name" = pre-push ]; then
  printf '%s\n' "$input" | "$hook" "$@"
else
  exec "$hook" "$@"
fi
