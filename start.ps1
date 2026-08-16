# valuuttaloki - one command from a fresh clone to a running dashboard, on Windows.
#
#   .\start.ps1              set up if needed, build, serve on http://127.0.0.1:3000
#   .\start.ps1 -Desktop     build and launch the desktop application instead
#   .\start.ps1 -Dev         hot-reloading server + Vite, for working on the code
#   .\start.ps1 -Check       verify everything is in place and exit, starting nothing
#   .\start.ps1 -Seed        fill the database with invented data to look at the charts
#   .\start.ps1 -Reconfigure redo the credential questions
#
# The PowerShell counterpart of ./start.sh. It exists because the first thing a Windows user
# hits is `pnpm : The term 'pnpm' is not recognized` - the README assumed a package manager
# that is not installed by default anywhere, and the bash script that fixes that is no help
# in PowerShell.
#
# If PowerShell refuses to run this ("running scripts is disabled on this system"), that is
# the default execution policy, not a fault in the file:
#
#   Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass

[CmdletBinding()]
param(
    [switch]$Desktop,
    [switch]$Dev,
    [switch]$Check,
    [switch]$Seed,
    [switch]$Reconfigure
)

$ErrorActionPreference = 'Stop'
Set-Location -Path $PSScriptRoot

function Write-Step($text) { Write-Host ""; Write-Host "> $text" -ForegroundColor White }
function Write-Ok($text)   { Write-Host "  [ok] $text" -ForegroundColor Green }
function Write-Warn($text) { Write-Host "  [!]  $text" -ForegroundColor Yellow }
function Write-Note($text) { Write-Host "       $text" -ForegroundColor DarkGray }
function Stop-With($text)  { Write-Host ""; Write-Host "  [x] $text" -ForegroundColor Red; Write-Host ""; exit 1 }

# --- 1. prerequisites --------------------------------------------------------
Write-Step "Checking what this machine has"

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    Stop-With "Node is not installed. Install Node 22 or newer, then open a new terminal:`n        winget install OpenJS.NodeJS.LTS"
}

$nodeVersion = (& node -p "process.versions.node")
$nodeMajor = [int](($nodeVersion -split '\.')[0])
if ($nodeMajor -lt 22) {
    Stop-With "Node $nodeVersion is too old. This needs 22 or newer."
}
Write-Ok "node v$nodeVersion"

if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
    Write-Warn "pnpm missing - enabling it through corepack"
    # corepack ships with Node and is the least invasive way to get pnpm.
    & corepack enable pnpm 2>$null
    if ($LASTEXITCODE -ne 0 -or -not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
        Stop-With "Could not enable pnpm automatically. Install it with:`n        npm install -g pnpm"
    }
}
Write-Ok "pnpm $(& pnpm --version)"

# --- 2. credentials ----------------------------------------------------------
function Set-EnvFilePermissions($path) {
    # .env holds a full account credential. Strip inherited permissions and grant the current
    # user only - the closest Windows equivalent of the 0600 the bash script sets.
    try {
        & icacls $path /inheritance:r /grant:r "$($env:USERNAME):(R,W)" | Out-Null
    } catch {
        Write-Warn "Could not restrict permissions on $path - check them yourself."
    }
}

function New-Configuration {
    Write-Step "Setting up .env"

    Write-Host @"
    Two things are needed, and one of them is sensitive.

    POESESSID is a session cookie, NOT a scoped API key. Whoever holds it is logged in
    as you: trade, stash, messages. It is stored in .env, is never logged, and is never
    sent to the browser. If you ever think it leaked, log out of all sessions on
    pathofexile.com - that invalidates it.

    To find it:
      1. Log in at pathofexile.com in your browser
      2. Open devtools (F12) -> Application (Chrome) or Storage (Firefox) -> Cookies
      3. Pick https://www.pathofexile.com and copy the POESESSID value

    Or skip all of that: .\start.ps1 -Desktop signs you in with a real login window.

"@

    $secure = Read-Host -Prompt "    POESESSID (input hidden)" -AsSecureString
    $session = [System.Net.NetworkCredential]::new('', $secure).Password
    if ([string]::IsNullOrWhiteSpace($session)) { Stop-With "No POESESSID given; nothing to poll with." }

    Write-Host ""
    Write-Host "    Account name, exactly as GGG spells it including the #discriminator"
    $account = Read-Host -Prompt "    (e.g. Exile#1234)"
    if ([string]::IsNullOrWhiteSpace($account)) { Stop-With "No account name given." }
    if ($account -notlike '*#*') {
        Write-Warn "No # in `"$account`". Modern GGG accounts have one; a 404 later usually means this."
    }

    Write-Host ""
    Write-Host "    League to track. Snapshots are keyed by this and leagues are never mixed."
    $league = Read-Host -Prompt "    [Standard]"
    if ([string]::IsNullOrWhiteSpace($league)) { $league = 'Standard' }

    $lines = @(
        "# Written by start.ps1. Contains a full account credential - keep it out of git."
        "POESESSID=$session"
        "POE_ACCOUNT_NAME=$account"
        "POE_LEAGUE=$league"
        "POLL_CRON=*/10 * * * *"
        "MIN_ITEM_CHAOS=2"
        "TRACKED_TABS="
        "DATABASE_URL=file:./data/valuuttaloki.db"
        "PORT=3000"
        "HOST=127.0.0.1"
        "AUTH_TOKEN="
    )
    Set-Content -Path '.env' -Value $lines -Encoding UTF8
    Set-EnvFilePermissions '.env'
    Write-Ok ".env written, readable only by you"
}

Write-Step "Looking for credentials"
$envExists = Test-Path '.env'
$configured = $false
if ($envExists) {
    $content = Get-Content '.env' -Raw
    $configured = ($content -match '(?m)^POESESSID=.+') -and ($content -match '(?m)^POE_ACCOUNT_NAME=.+')
}

if ($Reconfigure) {
    if ($envExists) {
        Copy-Item '.env' ".env.backup.$([int][double]::Parse((Get-Date -UFormat %s)))"
        Write-Warn "Existing .env backed up"
    }
    New-Configuration
} elseif (-not $envExists) {
    if ($Desktop) {
        # The desktop build asks for credentials in its own window, so there is nothing to
        # collect here. Writing a half-empty .env would only get in its way.
        Write-Note "No .env - the desktop app will ask you to sign in when it opens."
    } else {
        New-Configuration
    }
} elseif (-not $configured -and -not $Desktop) {
    Write-Warn ".env exists but POESESSID or POE_ACCOUNT_NAME is empty"
    New-Configuration
} else {
    Write-Ok ".env is in place (-Reconfigure to redo it)"
}

# --- 3. dependencies and database --------------------------------------------
Write-Step "Installing dependencies"
& pnpm install --frozen-lockfile
if ($LASTEXITCODE -ne 0) { & pnpm install }
if ($LASTEXITCODE -ne 0) { Stop-With "pnpm install failed." }
Write-Ok "dependencies ready"

Write-Step "Preparing the database"
& pnpm --filter '@valuuttaloki/server' exec prisma generate | Out-Null
if ($LASTEXITCODE -ne 0) { Stop-With "prisma generate failed." }
Write-Ok "Prisma client generated"

if (-not $Desktop) {
    # The desktop build migrates its own database in the user data directory at startup.
    & pnpm --filter '@valuuttaloki/server' db:deploy | Out-Null
    if ($LASTEXITCODE -ne 0) { Stop-With "Migrations failed. The database is not usable; nothing was started." }
    Write-Ok "migrations applied"
}

if ($Seed) {
    Write-Step "Seeding invented data"
    & pnpm --filter '@valuuttaloki/server' seed -- --days 3 --force
    Write-Warn "That data is fabricated. Delete server\prisma\data\*.db before trusting any chart."
}

if ($Check) {
    Write-Step "Everything checks out"
    Write-Note "Run .\start.ps1 to bring it up."
    exit 0
}

# --- 4. run ------------------------------------------------------------------
if ($Desktop) {
    Write-Step "Building and launching the desktop app"
    Write-Note "Sign in from the panel at the top of the window."
    & pnpm desktop
    exit $LASTEXITCODE
}

if ($Dev) {
    Write-Step "Starting in development mode"
    Write-Note "Server on :3000 with reload, Vite on :5173. Open the Vite one."
    & pnpm dev
    exit $LASTEXITCODE
}

Write-Step "Building"
& pnpm build | Out-Null
if ($LASTEXITCODE -ne 0) { Stop-With "Build failed." }
Write-Ok "server and dashboard built"

Write-Step "Starting"
Write-Host ""
Write-Host "  Dashboard   http://127.0.0.1:3000" -ForegroundColor White
Write-Host "  Schedule    a snapshot every 10 minutes, automatically"
Write-Host ""
Write-Note "The first chart needs two snapshots, so give it twenty minutes - or press"
Write-Note "`"poll now`" on the page. Ctrl-C stops everything."
Write-Host ""

& pnpm --filter '@valuuttaloki/server' start
exit $LASTEXITCODE
