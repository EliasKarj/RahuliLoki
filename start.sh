#!/usr/bin/env bash
#
# valuuttaloki — one command from a fresh clone to a running dashboard.
#
#   ./start.sh              set up if needed, build, serve on http://127.0.0.1:3000
#   ./start.sh --dev        hot-reloading server + Vite, for working on the code
#   ./start.sh --reconfigure  redo the credential questions
#   ./start.sh --check      verify everything is in place and exit, starting nothing
#   ./start.sh --seed       fill the database with invented data to look at the charts
#
# Design notes, since a setup script is where bad habits hide:
#
#  - POESESSID is read with the terminal echo off and written straight to a 0600 .env. It is
#    never passed as an argument (ps would show it), never echoed back, and never printed in a
#    summary.
#  - The credential is verified by starting the server and asking it to poll, rather than by
#    curling GGG here. The server already has the rate limiter and the good error messages
#    ("POESESSID has most likely expired"); a second, dumber implementation in shell would
#    drift from it and spend GGG requests without honouring the buckets.
#  - Nothing is overwritten without asking, and every step says what it is about to do.
#
# Windows has its own copy of this at start.ps1 — bash is not the right thing to send someone
# to when the very first error they hit is PowerShell not knowing what pnpm is.

set -euo pipefail

cd "$(dirname "$0")"

MODE=serve
RECONFIGURE=0
SEED=0

for arg in "$@"; do
  case "$arg" in
    --dev) MODE=dev ;;
    --check) MODE=check ;;
    --seed) SEED=1 ;;
    --reconfigure) RECONFIGURE=1 ;;
    # Usage lines only. The design notes below them are for whoever edits this file.
    -h|--help) sed -n '3,9p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $arg (try --help)" >&2; exit 2 ;;
  esac
done

# ── output ────────────────────────────────────────────────────────────────────
if [ -t 1 ]; then
  BOLD=$(printf '\033[1m'); DIM=$(printf '\033[2m'); RED=$(printf '\033[31m')
  GREEN=$(printf '\033[32m'); YELLOW=$(printf '\033[33m'); RESET=$(printf '\033[0m')
else
  BOLD=; DIM=; RED=; GREEN=; YELLOW=; RESET=
fi

step() { printf '\n%s▸ %s%s\n' "$BOLD" "$1" "$RESET"; }
ok()   { printf '  %s✓%s %s\n' "$GREEN" "$RESET" "$1"; }
warn() { printf '  %s!%s %s\n' "$YELLOW" "$RESET" "$1"; }
die()  { printf '\n  %s✗ %s%s\n\n' "$RED" "$1" "$RESET" >&2; exit 1; }
note() { printf '    %s%s%s\n' "$DIM" "$1" "$RESET"; }

# ── 1. prerequisites ──────────────────────────────────────────────────────────
step "Checking what this machine has"

command -v node >/dev/null 2>&1 || die "node is not installed. valuuttaloki needs Node 22 or newer."

NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
[ "$NODE_MAJOR" -ge 22 ] || die "Node $(node -v) is too old. This needs 22 or newer."
ok "node $(node -v)"

if ! command -v pnpm >/dev/null 2>&1; then
  if command -v corepack >/dev/null 2>&1; then
    warn "pnpm missing — enabling it through corepack"
    corepack enable >/dev/null 2>&1 || die "corepack enable failed. Install pnpm: npm i -g pnpm"
  else
    die "pnpm is not installed. Install it with: npm i -g pnpm"
  fi
fi
ok "pnpm $(pnpm --version)"

# ── 2. credentials ────────────────────────────────────────────────────────────
env_has() { [ -f .env ] && grep -q "^$1=." .env; }

configure() {
  step "Setting up .env"

  cat <<'EXPLAIN'
    Two things are needed, and one of them is sensitive.

    POESESSID is a session cookie, NOT a scoped API key. Whoever holds it is logged in
    as you: trade, stash, messages. It is stored in .env with 0600 permissions, is never
    logged, and is never sent to the browser. If you ever think it leaked, log out of all
    sessions on pathofexile.com — that invalidates it.

    To find it:
      1. Log in at pathofexile.com in your browser
      2. Open devtools (F12) → Application (Chrome) or Storage (Firefox) → Cookies
      3. Pick https://www.pathofexile.com and copy the POESESSID value

EXPLAIN

  printf '    POESESSID (input hidden): '
  stty -echo 2>/dev/null || true
  IFS= read -r POESESSID_VALUE || true
  stty echo 2>/dev/null || true
  printf '\n'
  [ -n "${POESESSID_VALUE:-}" ] || die "No POESESSID given; nothing to poll with."

  printf '\n    Account name, exactly as GGG spells it including the #discriminator\n'
  printf '    (e.g. Exile#1234): '
  IFS= read -r ACCOUNT_VALUE || true
  [ -n "${ACCOUNT_VALUE:-}" ] || die "No account name given."
  case "$ACCOUNT_VALUE" in
    *"#"*) : ;;
    *) warn "No # in \"$ACCOUNT_VALUE\". Modern GGG accounts have one; a 404 later usually means this." ;;
  esac

  printf '\n    League to track. Snapshots are keyed by this and leagues are never mixed.\n'
  printf '    [Standard]: '
  IFS= read -r LEAGUE_VALUE || true
  LEAGUE_VALUE=${LEAGUE_VALUE:-Standard}

  # Loopback by default, so no API token is needed. Offer one anyway for the case where this
  # is about to be put on a network — the server refuses to start wide open without it.
  printf '\n    Will anything other than this machine reach the dashboard? [y/N]: '
  IFS= read -r EXPOSED || true
  AUTH_LINE="AUTH_TOKEN="
  HOST_LINE="HOST=127.0.0.1"
  case "${EXPOSED:-n}" in
    [yY]*)
      if command -v openssl >/dev/null 2>&1; then
        GENERATED=$(openssl rand -hex 32)
      else
        GENERATED=$(node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))')
      fi
      AUTH_LINE="AUTH_TOKEN=$GENERATED"
      HOST_LINE="HOST=0.0.0.0"
      warn "Generated an API token. The dashboard will ask for it once per tab."
      note "It is in .env as AUTH_TOKEN. Without it the whole wealth history is public."
      ;;
  esac

  # Written with a restrictive umask so the file is never briefly world-readable.
  ( umask 077
    cat > .env <<EOF
# Written by ./start.sh. Contains a full account credential — keep it out of git.
POESESSID=$POESESSID_VALUE
POE_ACCOUNT_NAME=$ACCOUNT_VALUE
POE_LEAGUE=$LEAGUE_VALUE
POLL_CRON=*/10 * * * *
MIN_ITEM_CHAOS=2
TRACKED_TABS=
DATABASE_URL=file:./data/valuuttaloki.db
PORT=3000
$HOST_LINE
$AUTH_LINE
EOF
  )
  chmod 600 .env
  unset POESESSID_VALUE
  ok ".env written, readable only by you"
}

step "Looking for credentials"
if [ "$RECONFIGURE" = 1 ]; then
  [ -f .env ] && cp .env ".env.backup.$(date +%s)" && warn "Existing .env backed up"
  configure
elif [ ! -f .env ]; then
  configure
elif ! env_has POESESSID || ! env_has POE_ACCOUNT_NAME; then
  warn ".env exists but POESESSID or POE_ACCOUNT_NAME is empty"
  configure
else
  ok ".env is in place (--reconfigure to redo it)"
fi

# Read back the settings the script itself needs. Deliberately not POESESSID.
get_env() { grep "^$1=" .env 2>/dev/null | head -1 | cut -d= -f2- ; }
PORT=$(get_env PORT); PORT=${PORT:-3000}
HOST=$(get_env HOST); HOST=${HOST:-127.0.0.1}
LEAGUE=$(get_env POE_LEAGUE); LEAGUE=${LEAGUE:-Standard}
TOKEN=$(get_env AUTH_TOKEN)

# ── 3. dependencies and database ──────────────────────────────────────────────
step "Installing dependencies"
pnpm install --frozen-lockfile >/dev/null 2>&1 || pnpm install
ok "dependencies ready"

step "Preparing the database"
pnpm --filter @valuuttaloki/server exec prisma generate >/dev/null 2>&1
ok "Prisma client generated"
# Through the package script, which loads the root .env for the Prisma CLI — the CLI only looks
# beside the schema and in its own cwd, and the one .env in this workspace is at the top.
if ! MIGRATE_OUT=$(pnpm --filter @valuuttaloki/server db:deploy 2>&1); then
  printf '%s\n' "$MIGRATE_OUT" >&2
  die "Migrations failed. The database is not usable; nothing was started."
fi
ok "migrations applied"

if [ "$SEED" = 1 ]; then
  step "Seeding invented data"
  pnpm --filter @valuuttaloki/server seed -- --days 3 --league "$LEAGUE" --force
  warn "That data is fabricated. Delete server/prisma/data/*.db before trusting any chart."
fi

if [ "$MODE" = check ]; then
  step "Everything checks out"
  note "Run ./start.sh to bring it up."
  exit 0
fi

# ── 4. run ────────────────────────────────────────────────────────────────────
if [ "$MODE" = dev ]; then
  step "Starting in development mode"
  note "Server on :$PORT with reload, Vite on :5173. Open the Vite one."
  exec pnpm dev
fi

# Refuse to start on a port somebody else owns. Without this the readiness check below is a
# lie: it polls the port, gets an answer from whatever is already there, and reports success
# for a server that never started. That is how you end up debugging a stale process for an
# hour while the new code sits unbuilt.
step "Checking the port is free"
if curl -fsS -o /dev/null --max-time 2 "http://127.0.0.1:$PORT/api/health" 2>/dev/null; then
  die "Something is already serving on port $PORT. Stop it, or set PORT= in .env to another."
fi
ok "port $PORT is free"

step "Building"
pnpm build >/dev/null 2>&1 || pnpm build
ok "server and dashboard built"

step "Starting"
# The server logs structured JSON, one line per request. Interleaved with this script's output
# it buries everything; in a file it is still there when something needs diagnosing.
SERVER_LOG=${TMPDIR:-/tmp}/valuuttaloki.log
: > "$SERVER_LOG"
pnpm --filter @valuuttaloki/server start >>"$SERVER_LOG" 2>&1 &
SERVER_PID=$!
# Without this the server keeps running in the background after Ctrl-C, holding the port and
# quietly polling GGG with nothing on screen to say so.
trap 'kill "$SERVER_PID" 2>/dev/null || true' INT TERM EXIT

# Deliberately no -f. On a failed poll the body *is* the diagnosis, and -f throws it away
# along with the status code.
curl_api() {
  if [ -n "$TOKEN" ]; then
    curl -sS -H "Authorization: Bearer $TOKEN" "$@"
  else
    curl -sS "$@"
  fi
}

json_field() {
  node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const v=process.argv[1].split(".").reduce((o,k)=>o?.[k],JSON.parse(s));console.log(v??"")}catch{console.log("")}})' "$1"
}

URL="http://127.0.0.1:$PORT"
printf '  waiting for it to answer'
# The port was verified free above, so anything answering now is ours.
for _ in $(seq 1 40); do
  if curl -fsS -o /dev/null "$URL/api/health" 2>/dev/null; then break; fi
  # A server that died on a config error will never answer; say so instead of spinning.
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    printf '\n'
    tail -5 "$SERVER_LOG" >&2
    die "The server exited during startup. Full log: $SERVER_LOG"
  fi
  printf '.'; sleep 0.5
done
printf '\n'
curl -fsS -o /dev/null "$URL/api/health" 2>/dev/null || die "The server never became ready."
ok "listening on $URL"

# ── 5. first poll, which is also the credential check ─────────────────────────
step "Testing the credential with one real poll"
note "This is the only way to know POESESSID works, and it spends one GGG request."

# Exactly one attempt. A retry here would spend a second request against the very budget this
# whole application is careful with, and would tell us nothing the first one did not.
POLL=$(curl_api -X POST "$URL/api/poll" 2>/dev/null || true)
POLL_OK=$(printf '%s' "$POLL" | json_field ok)

if [ "$POLL_OK" = "true" ]; then
  CHAOS=$(printf '%s' "$POLL" | json_field snapshot.totalChaos)
  ok "It works. First snapshot: ${CHAOS}c"
else
  warn "The poll did not succeed."
  REASON=$(printf '%s' "$POLL" | json_field error)
  [ -n "$REASON" ] && printf '    %s%s%s\n' "$RED" "$REASON" "$RESET"

  # Hints matched against what actually failed. A blanket "403 means your session expired" is
  # wrong, and wastes someone's afternoon when the 403 came from poe.ninja rather than GGG.
  case "$REASON" in
    *"rejected the session"*|*"GGG returned HTTP 401"*|*"GGG returned HTTP 403"*)
      note "Your POESESSID is no longer valid. Rerun: ./start.sh --reconfigure" ;;
    *"404"*)
      note "Check POE_ACCOUNT_NAME (including the #number) and POE_LEAGUE." ;;
    *"poe.ninja"*)
      note "poe.ninja is unreachable or refusing us — that is prices, not your credential."
      note "Usually temporary; the poller retries on its own." ;;
    *"no stash tabs"*)
      note "The session may belong to a different account than POE_ACCOUNT_NAME." ;;
    *)
      note "Full detail: $SERVER_LOG" ;;
  esac
  note "The dashboard still works; the poller retries on its own schedule."
fi

# ── 6. what now ───────────────────────────────────────────────────────────────
cat <<EOF

$BOLD  valuuttaloki is up$RESET

    Dashboard   $URL
    League      $LEAGUE
    Schedule    a snapshot every 10 minutes, automatically
EOF

if [ -n "$TOKEN" ]; then
  cat <<EOF
    Token       required — the dashboard asks once per tab
                get it with: grep AUTH_TOKEN .env
EOF
fi

cat <<EOF

$DIM    The first chart needs two snapshots, so give it twenty minutes — or press
    "poll now" on the page. Ctrl-C stops everything.

    Server log   $SERVER_LOG

    ./start.sh --dev     work on the code with hot reload
    ./start.sh --seed    invented data, to see the charts without waiting
    ./start.sh --check   verify setup without starting anything$RESET

EOF

wait "$SERVER_PID"
