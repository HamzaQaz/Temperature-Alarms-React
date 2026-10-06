# Install, deploy, upgrade, back up, and remove the Temperature Alarms stack (compose.yaml)
# on this Windows server, or on remote Linux servers over ssh. The same tool as deploy.sh,
# with the same actions and flags (GNU style, --yes; -Yes style works too). Runs on
# Windows PowerShell 5.1 and PowerShell 7. Run with no action for a menu:
#
#   powershell -ExecutionPolicy Bypass -File deploy\deploy.ps1
#   pwsh deploy/deploy.ps1 deploy --yes --web-port 8080
#
# `deploy\deploy.ps1 --help` lists everything. Every action is safe to repeat.

Set-StrictMode -Version 2.0
# Native commands (docker, git) report through exit codes; 'Stop' would turn their stderr
# progress into errors under Windows PowerShell 5.1.
$ErrorActionPreference = 'Continue'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoDir = Split-Path -Parent $ScriptDir
$EnvPath = Join-Path $RepoDir '.env'
$ExamplePath = Join-Path $RepoDir '.env.example'
$BackupDir = Join-Path $RepoDir 'backups'
$DbName = 'temperature_alarms'
$Secrets = @('ADMIN_TOKEN', 'DEVICE_TOKEN', 'DB_PASSWORD')
$Tunables = @('REPORT_INTERVAL_SECONDS', 'RETENTION_DAYS', 'HOT_WARNING_F', 'HOT_CRITICAL_F', 'COLD_WARNING_F', 'DRY_WARNING_PERCENT', 'MISSED_REPORTS_BEFORE_OFFLINE', 'LEGACY_TIME_ZONE', 'DB_BUFFER_POOL_SIZE')
# Without build attestations an unchanged checkout rebuilds to the same image id, so a
# repeated deploy leaves the running containers alone instead of recreating them.
if (-not $env:BUILDX_NO_DEFAULT_ATTESTATIONS) { $env:BUILDX_NO_DEFAULT_ATTESTATIONS = '1' }
# The demo (compose.demo.yaml) has its own project, so its own volume, and throwaway secrets.
$DemoProject = 'temperature-alarms-demo'
$DemoPort = '8080'
# Extra arguments for every docker compose call; the demo sets its project and files here.
$DcArgs = @()

$OnWindows = ($PSVersionTable.PSVersion.Major -lt 6) -or $IsWindows
$UseColour = (-not [Console]::IsOutputRedirected) -and (-not $env:NO_COLOR)

$O = @{
    Action = ''; File = ''; Yes = $false; Project = ''; WebPort = ''; Sets = @(); Pull = $null
    Reveal = $false; Reconfigure = $false; Wipe = $false; Confirm = ''; Follow = $false; Tail = '200'
    Service = ''; Hosts = @(); Servers = ''; Dir = 'temperature-alarms'; Repo = ''; Branch = ''
    SshOpts = $env:DEPLOY_SSH_OPTS; Pass = @(); Bootstrap = $false; At = '02:00'; Down = $false
}
$OrigArgs = @($args | ForEach-Object { "$_" })

# --- output ----------------------------------------------------------------------------
function Write-Line([string]$Text, [string]$Colour) {
    if ($UseColour -and $Colour) { Write-Host $Text -ForegroundColor $Colour } else { Write-Host $Text }
}
function Step([string]$Text) { Write-Host ''; Write-Line "==> $Text" 'Cyan' }
function Ok([string]$Text) { Write-Line "  [ ok ] $Text" 'Green' }
function Warn([string]$Text) { Write-Line "  [warn] $Text" 'Yellow' }
function Bad([string]$Text) { Write-Line "  [FAIL] $Text" 'Red' }
function Fail([string]$Text) { throw $Text }

function Show-Usage {
    Write-Host @'
Usage: deploy\deploy.ps1 [action] [options]

With no action at a console, shows a menu. Actions:
  preflight          Check Docker, Compose v2, Linux containers, the web port, and disk space
  install            Create .env from .env.example with generated secrets (keeps an existing one)
  deploy             Install if needed, optionally git pull, build and start, wait for healthy,
                     check /api/health through web. Also the upgrade. Safe to repeat.
  status             Containers and the health check
  logs               Recent logs (--follow, --service api|web|db, --tail N)
  backup             mysqldump to backups\<project>_<time>.sql.gz
  bootstrap          Linux servers only (--host): Docker Engine, Compose, git, and cron from
                     the distribution's Docker repository; see deploy.sh --help
  schedule-backup    Linux and macOS servers (--host): nightly backup from cron (--at HH:MM,
  unschedule-backup  --keep-days N). On Windows it prints the Task Scheduler line instead.
  restore [FILE]     Replace the database with a backup (typed confirmation; backs up first)
  migrate-legacy     Back up, then run `npm run migrate:legacy` in api
  info               The URL, the tokens (masked unless --reveal), and the config.h lines
  stop               Stop the containers; data and settings stay
  uninstall          Remove containers and built images; --wipe also deletes the database
                     (typed confirmation). .env and backups\ stay.
  demo               See it without hardware: the stack plus sample Campuses, Devices, a week
                     of history, and live Readings that loop through every Condition. Its own
                     project (temperature-alarms-demo) and throwaway secrets in .env.demo, so
                     it never touches a real install. --web-port (default 8080); --down
                     removes it, volume and .env.demo included.

Options:
  -y, --yes             Non-interactive: take flag values and defaults, never prompt
  -p, --project NAME    Compose project name; default is Compose's own (the folder name), which
                        names the database volume, so keep it for an existing install
      --web-port PORT   The published port, or ADDR:PORT (install, deploy)
      --set KEY=VALUE   A tunable from .env.example (repeatable; install, deploy), or
                        TRUST_PROXY=ADDR[,ADDR] behind a TLS proxy (DEPLOYMENT.md)
      --reconfigure     Apply --web-port/--set to an existing .env (secrets are kept)
      --pull / --no-pull  git pull --ff-only before deploy (asked when interactive)
      --reveal          Print tokens in full (info)
      --confirm TEXT    Answer a typed confirmation non-interactively: the project name
      --wipe            uninstall also deletes the database volume
      --down            demo: remove the demo instead of starting it
      --file FILE       Backup file for restore
      --follow, --service NAME, --tail N   For logs
Remote Linux servers (runs deploy.sh there over ssh; each keeps its own .env and backups):
      --host USER@SERVER  Repeatable
      --servers FILE      One USER@SERVER per line, # comments (e.g. deploy\servers.txt)
      --dir PATH          Checkout on the server (default: temperature-alarms, under $HOME)
      --repo URL          Repo to clone there (default: this checkout's origin)
      --branch NAME       Branch to clone
      --ssh-opts "OPTS"   Extra ssh options, e.g. "-p 2222 -i C:\keys\id_ed25519" (or DEPLOY_SSH_OPTS)
      --bootstrap         With deploy: run bootstrap on each server first (it needs no checkout)
      --at HH:MM, --keep-days N   For schedule-backup on a server
'@
}

function Read-Args([string[]]$List) {
    $i = 0
    while ($i -lt $List.Count) {
        $raw = $List[$i]
        $name = $raw.ToLowerInvariant()
        $next = $null
        if ($i + 1 -lt $List.Count) { $next = $List[$i + 1] }
        $takesValue = $false
        if ($name -match '^--?[a-z]') {
            $key = ($name -replace '^-+', '') -replace '-', ''
            switch ($key) {
                { $_ -in 'h', 'help', '?' } { Show-Usage; exit 0 }
                { $_ -in 'y', 'yes' } { $O.Yes = $true; $O.Pass += '--yes' }
                { $_ -in 'p', 'project' } { $takesValue = $true; $O.Project = $next; $O.Pass += @('-p', $next) }
                'webport' { $takesValue = $true; $O.WebPort = $next; $O.Pass += @('--web-port', $next) }
                'set' { $takesValue = $true; $O.Sets += $next; $O.Pass += @('--set', $next) }
                'reconfigure' { $O.Reconfigure = $true; $O.Pass += '--reconfigure' }
                'pull' { $O.Pull = $true; $O.Pass += '--pull' }
                'nopull' { $O.Pull = $false; $O.Pass += '--no-pull' }
                'reveal' { $O.Reveal = $true; $O.Pass += '--reveal' }
                'confirm' { $takesValue = $true; $O.Confirm = $next; $O.Pass += @('--confirm', $next) }
                'wipe' { $O.Wipe = $true; $O.Pass += '--wipe' }
                'down' { $O.Down = $true; $O.Pass += '--down' }
                'file' { $takesValue = $true; $O.File = $next; $O.Pass += @('--file', $next) }
                { $_ -in 'f', 'follow' } { $O.Follow = $true; $O.Pass += '--follow' }
                'service' { $takesValue = $true; $O.Service = $next; $O.Pass += @('--service', $next) }
                'tail' { $takesValue = $true; $O.Tail = $next; $O.Pass += @('--tail', $next) }
                'host' { $takesValue = $true; $O.Hosts += $next }
                'servers' { $takesValue = $true; $O.Servers = $next }
                'dir' { $takesValue = $true; $O.Dir = $next }
                'repo' { $takesValue = $true; $O.Repo = $next }
                'branch' { $takesValue = $true; $O.Branch = $next }
                'sshopts' { $takesValue = $true; $O.SshOpts = $next }
                'bootstrap' { $O.Bootstrap = $true }
                'at' { $takesValue = $true; $O.At = $next; $O.Pass += @('--at', $next) }
                'keepdays' { $takesValue = $true; $O.Pass += @('--keep-days', $next) }
                default { Fail "unknown option $raw (see --help)" }
            }
            if ($takesValue) {
                if ([string]::IsNullOrEmpty($next)) { Fail "$raw needs a value" }
                $i++
            }
        }
        elseif (-not $O.Action) { $O.Action = $name; $O.Pass += $name }
        elseif ($O.Action -eq 'restore' -and -not $O.File) { $O.File = $raw; $O.Pass += $raw }
        else { Fail "unexpected argument $raw" }
        $i++
    }
}

# --- prompts ---------------------------------------------------------------------------
function Test-Interactive { (-not $O.Yes) -and (-not [Console]::IsInputRedirected) }

function Ask([string]$Question, [string]$Default) {
    if (-not (Test-Interactive)) { return $Default }
    $answer = Read-Host "  $Question [$Default]"
    if ([string]::IsNullOrWhiteSpace($answer)) { return $Default }
    return $answer.Trim()
}

function Confirm-Choice([string]$Question, [bool]$Default) {
    if (-not (Test-Interactive)) { return $Default }
    $hint = if ($Default) { 'Y/n' } else { 'y/N' }
    $answer = Read-Host "  $Question [$hint]"
    if ([string]::IsNullOrWhiteSpace($answer)) { return $Default }
    return ($answer.Trim().ToLowerInvariant() -in @('y', 'yes'))
}

function Confirm-Typed([string]$What) {
    $word = Get-ProjectName
    if ($O.Confirm) {
        if ($O.Confirm -ne $word) { Fail "--confirm must be the project name '$word'" }
        return
    }
    if (-not (Test-Interactive)) { Fail "$What Add --confirm $word to go ahead." }
    Write-Line "  $What" 'Yellow'
    $typed = Read-Host "  Type the project name '$word' to go ahead"
    if ($typed -ne $word) { Fail 'not confirmed; nothing was changed' }
}

# --- .env ------------------------------------------------------------------------------
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Read-Lines([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) { return @() }
    return @([IO.File]::ReadAllLines($Path))
}
function Write-Lines([string]$Path, [string[]]$Lines) {
    [IO.File]::WriteAllText($Path, (($Lines -join "`n") + "`n"), $Utf8NoBom)
}

function Get-EnvValue([string]$Key) {
    $value = ''
    foreach ($line in (Read-Lines $EnvPath)) {
        if ($line.StartsWith("$Key=")) { $value = $line.Substring($Key.Length + 1).Trim().Trim('"') }
    }
    return $value
}

function Set-EnvValue([string]$Key, [string]$Value) {
    $out = New-Object System.Collections.Generic.List[string]
    $done = $false
    $hasLive = @(Read-Lines $EnvPath | Where-Object { $_.StartsWith("$Key=") }).Count -gt 0
    foreach ($line in (Read-Lines $EnvPath)) {
        if ($line.StartsWith("$Key=")) {
            if (-not $done) { $out.Add("$Key=$Value"); $done = $true }
            continue
        }
        if (-not $hasLive -and -not $done -and $line -match "^#\s*$Key=") { $out.Add("$Key=$Value"); $done = $true; continue }
        $out.Add($line)
    }
    if (-not $done) { $out.Add("$Key=$Value") }
    Write-Lines $EnvPath $out.ToArray()
}

function New-Secret {
    $bytes = New-Object byte[] 32
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    $rng.GetBytes($bytes)
    $rng.Dispose()
    return (($bytes | ForEach-Object { $_.ToString('x2') }) -join '')
}

function Protect-EnvFile {
    if ($OnWindows) {
        $me = [Security.Principal.WindowsIdentity]::GetCurrent().Name
        & icacls.exe $EnvPath /inheritance:r /grant:r "${me}:(F)" | Out-Null
        if ($LASTEXITCODE -ne 0) { Warn 'could not restrict .env to this account (icacls)' }
    }
    else { & chmod 600 $EnvPath }
}

# TRUST_PROXY: empty, or IPs and CIDR ranges separated by commas, or `gateway` (the Docker host).
# Never a prefix of 0, however spelled (/0, /00): trusting every address would let any client
# write its own X-Forwarded-For. frontend/real-ip.sh and deploy.sh check the same, the same way.
function Test-IPv4([string]$Value) {
    if ($Value -notmatch '\A[0-9]{1,3}(\.[0-9]{1,3}){3}\z') { return $false }
    foreach ($octet in $Value.Split('.')) { if ([int]$octet -gt 255) { return $false } }
    return $true
}

# Groups of up to four hex digits, eight of them, or fewer around one `::`; the last two may be
# a dotted IPv4 address. No zone (%eth0) and no brackets: nginx takes neither.
function Test-IPv6([string]$Value) {
    $a = $Value
    if ($a -notmatch ':' -or $a -match '[^0-9A-Fa-f:.]' -or $a.Contains(':::') -or ($a -split '::').Count -gt 2) { return $false }
    if ($a.Contains('.')) {
        $last = $a.LastIndexOf(':')
        if (-not (Test-IPv4 $a.Substring($last + 1))) { return $false }
        $a = $a.Substring(0, $last) + ':0:0'
    }
    if ($a.Contains('.')) { return $false }
    $compressed = $a.Contains('::')
    $groups = 0
    foreach ($group in $a.Split(':')) {
        if ($group -eq '') { if (-not $compressed) { return $false }; continue }
        if ($group.Length -gt 4) { return $false }
        $groups++
    }
    if ($compressed) { return $groups -le 7 }
    return $groups -eq 8
}

# An address, or ADDRESS/PREFIX with the prefix 1 to 32 (IPv4) or 1 to 128 (IPv6).
function Test-Address([string]$Value) {
    $parts = $Value.Split('/')
    if ($parts.Count -gt 2) { return $false }
    if (Test-IPv4 $parts[0]) { $max = 32 }
    elseif (Test-IPv6 $parts[0]) { $max = 128 }
    else { return $false }
    if ($parts.Count -eq 1) { return $true }
    if ($parts[1] -notmatch '\A[0-9]{1,3}\z') { return $false }
    return ([int]$parts[1] -ge 1) -and ([int]$parts[1] -le $max)
}

function Test-TrustProxy([string]$Value) {
    if (-not $Value) { return $true }
    # \z, not $: one line only, so the value cannot carry a second line into .env.
    if ($Value -notmatch '\A[0-9A-Za-z.:/, ]*\z') { return $false }
    foreach ($entry in ($Value -split '[, ]+' | Where-Object { $_ })) {
        if ($entry -eq 'gateway') { continue }
        if (-not (Test-Address $entry)) { return $false }
    }
    return $true
}

# USER@SERVER, SERVER, or an ssh config alias. Never starting with `-`, which ssh would take as an
# option (-oProxyCommand=... runs a command here), and nothing ssh would read as syntax.
function Test-SshHost([string]$Value) {
    return $Value -cmatch '\A[A-Za-z0-9_.@:%+][A-Za-z0-9_.@:%+-]*\z'
}

function Test-Setting([string]$Key, [string]$Value) {
    switch ($Key) {
        'WEB_PORT' { return $Value -match '^([0-9.]+:|\[[0-9a-fA-F:]+\]:)?[0-9]{1,5}$' }
        'TRUST_PROXY' { return Test-TrustProxy $Value }
        'LEGACY_TIME_ZONE' { return ($Value -eq '') -or ($Value -match '^[A-Za-z0-9_/+:-]+$') }
        # MySQL's size syntax: bytes, or a whole number of K, M, or G.
        'DB_BUFFER_POOL_SIZE' { return ($Value -eq '') -or ($Value -cmatch '^[1-9][0-9]*[KMG]?$') }
        default { return $Value -match '^[0-9]+$' }
    }
}

function Set-FlagsInEnv {
    if ($O.WebPort) {
        if (-not (Test-Setting 'WEB_PORT' $O.WebPort)) { Fail "--web-port: '$($O.WebPort)' is not PORT or ADDR:PORT" }
        Set-EnvValue 'WEB_PORT' $O.WebPort; Ok "WEB_PORT=$($O.WebPort)"
    }
    foreach ($kv in $O.Sets) {
        $key = $kv.Split('=', 2)[0]
        $value = if ($kv.Contains('=')) { $kv.Split('=', 2)[1] } else { '' }
        if ($key -notin (@('WEB_PORT', 'TRUST_PROXY') + $Tunables)) { Fail "--set: $key is not a setting this script manages (WEB_PORT TRUST_PROXY $($Tunables -join ' '))" }
        if (-not (Test-Setting $key $value)) { Fail "--set: '$value' is not valid for $key" }
        Set-EnvValue $key $value; Ok "$key=$value"
    }
}

function Read-Tunables {
    $current = Get-EnvValue 'WEB_PORT'
    if (-not $current) { $current = '80' }
    while ($true) {
        $value = Ask 'Web port (PORT, or 127.0.0.1:PORT behind a TLS proxy)' $current
        if (Test-Setting 'WEB_PORT' $value) { break }
        Warn "'$value' is not PORT or ADDR:PORT"
    }
    Set-EnvValue 'WEB_PORT' $value
    # Behind a TLS proxy every browser arrives from the proxy's address, so the per-address
    # limits would count them all as one unless nginx is told to trust the proxy.
    $current = Get-EnvValue 'TRUST_PROXY'
    if (Confirm-Choice 'Is a TLS proxy (Caddy, nginx) in front of this stack?' ([bool]$current)) {
        if (-not $current) { $current = 'gateway' }
        while ($true) {
            $value = Ask 'Proxy address(es) to trust: IP or CIDR, comma-separated; gateway = a proxy on this host' $current
            if ($value -and (Test-Setting 'TRUST_PROXY' $value)) { break }
            Warn "'$value' is not a list of IP addresses or CIDR ranges (or gateway)"
        }
        Set-EnvValue 'TRUST_PROXY' $value
    }
    elseif ($current) { Set-EnvValue 'TRUST_PROXY' '' }
    if (Confirm-Choice 'Change the alarm thresholds and retention from their defaults?' $false) {
        foreach ($k in $Tunables) {
            $current = Get-EnvValue $k
            while ($true) {
                $value = Ask $k $current
                if (Test-Setting $k $value) { break }
                Warn "'$value' is not valid for $k"
            }
            if ($k -in @('LEGACY_TIME_ZONE', 'DB_BUFFER_POOL_SIZE') -and -not $value) { continue }
            Set-EnvValue $k $value
        }
    }
}

function Add-MissingSecrets {
    $filled = @()
    foreach ($k in $Secrets) {
        if (-not (Get-EnvValue $k)) { Set-EnvValue $k (New-Secret); $filled += $k }
    }
    if ($filled.Count -gt 0) { Ok "Generated $($filled -join ' ') (never printed; see: deploy.ps1 info --reveal)" }
}

# The project Compose itself runs under: -p or COMPOSE_PROJECT_NAME when given, otherwise the
# folder name. The database volume is named after it, so the default is never overridden.
function Get-ProjectName {
    $line = & docker compose @DcArgs config 2>$null | Where-Object { $_ -match '^name: ' } | Select-Object -First 1
    if ($line) { return ($line -replace '^name: ', '').Trim('"', ' ') }
    $name = $env:COMPOSE_PROJECT_NAME
    if (-not $name) { $name = Get-EnvValue 'COMPOSE_PROJECT_NAME' }
    if (-not $name) { $name = Split-Path -Leaf $RepoDir }
    return ($name.ToLowerInvariant() -replace '[^a-z0-9_-]', '')
}

function Get-WebPortSetting {
    $p = $O.WebPort
    if (-not $p) { $p = Get-EnvValue 'WEB_PORT' }
    if (-not $p) { $p = '80' }
    return $p
}
function Get-WebHost {
    $wp = Get-WebPortSetting
    $addr = ''
    if ($wp.Contains(':')) { $addr = $wp.Substring(0, $wp.LastIndexOf(':')).Trim('[', ']') }
    if ($addr -in @('', '0.0.0.0', '::')) { return '127.0.0.1' }
    return $addr
}
function Get-WebPortNumber { $wp = Get-WebPortSetting; return $wp.Substring($wp.LastIndexOf(':') + 1) }

# TRUST_PROXY=gateway believes X-Forwarded-For from the Docker network's gateway. A proxy on this
# host arrives from there, but so does whatever Docker's userland proxy forwards: every IPv6 client
# (web listens on IPv4 only), and on hosts without iptables NAT every client. With web published on
# every address, any of them could claim to be anyone. True when that is the setup.
function Test-GatewayExposed {
    $entries = @((Get-EnvValue 'TRUST_PROXY') -split '[, ]+' | Where-Object { $_ })
    if ($entries -notcontains 'gateway') { return $false }
    $wp = Get-WebPortSetting
    return -not ($wp -match '\A(127\.[0-9.]+|\[::1\]|localhost):[0-9]+\z')
}

function Invoke-Dc { & docker compose @DcArgs @args }

function Test-Running([string]$Service) {
    $id = & docker compose @DcArgs ps --status running -q $Service 2>$null
    return [bool]$id
}

# --- actions ---------------------------------------------------------------------------
function Invoke-Preflight {
    Step 'Preflight'
    $failed = $false
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
        Bad 'docker is not installed: Docker Desktop, or Docker Engine with Linux containers'
        return $false
    }
    Ok "docker: $(& docker --version)"

    $v = & docker compose version --short 2>$null
    $major = 0
    if ($v) { [void][int]::TryParse(($v -replace '^v', '').Split('.')[0], [ref]$major) }
    if ($major -ge 2) { Ok "docker compose $v" } else { Bad 'Docker Compose v2 is missing (docker compose version)'; $failed = $true }

    $os = & docker info --format '{{.OSType}}' 2>$null
    if ($LASTEXITCODE -ne 0 -or -not $os) {
        Bad 'cannot reach the Docker daemon; start Docker Desktop (or the docker service)'
        return $false
    }
    Ok 'Docker daemon is up'
    if ($os -ne 'linux') { Bad "Docker runs $os containers; the stack needs Linux containers (Docker Desktop: Switch to Linux containers)"; $failed = $true }

    if ((Test-Path -LiteralPath (Join-Path $RepoDir 'compose.yaml')) -and (Test-Path -LiteralPath $ExamplePath)) { Ok "compose.yaml and .env.example in $RepoDir" }
    else { Bad "compose.yaml or .env.example missing in $RepoDir"; $failed = $true }

    if (Test-GatewayExposed) {
        Bad "TRUST_PROXY=gateway with WEB_PORT=$(Get-WebPortSetting): any client reaching the port could claim any address. Keep it on the loopback: --set WEB_PORT=127.0.0.1:$(Get-WebPortNumber) --reconfigure"
        $failed = $true
    }

    $port = [int](Get-WebPortNumber); $webHost = Get-WebHost
    $client = New-Object System.Net.Sockets.TcpClient
    $inUse = $false
    try { $inUse = $client.ConnectAsync($webHost, $port).Wait(1000) -and $client.Connected } catch { $inUse = $false }
    $client.Close()
    if ($inUse) {
        $published = & docker port (& docker compose @DcArgs ps -q web 2>$null) 2>$null
        if ((Test-Running 'web') -and (@($published) -match ":$port`$")) { Ok "port $port is this stack's own web" }
        else { Bad "port $port on $webHost is in use by something else; pick another with --web-port"; $failed = $true }
    }
    else { Ok "port $port is free" }

    $drive = (Get-Item -LiteralPath $RepoDir).PSDrive
    if ($drive -and $drive.Free) {
        $mb = [int]($drive.Free / 1MB)
        if ($mb -lt 1024) { Bad "only $mb MB free on $($drive.Root); the first build needs about 3.5 GB"; $failed = $true }
        elseif ($mb -lt 5120) { Warn "$mb MB free on $($drive.Root); 5 GB leaves room for images and backups" }
        else { Ok "$mb MB free on $($drive.Root)" }
    }
    return (-not $failed)
}

function Invoke-Install {
    Step 'Configure .env'
    if (Test-Path -LiteralPath $EnvPath) {
        Ok '.env exists; keeping it'
        Add-MissingSecrets
        if ($O.WebPort -or $O.Sets.Count -gt 0) {
            if ($O.Reconfigure -or ((Test-Interactive) -and (Confirm-Choice 'Write the given settings into the existing .env? Secrets are kept.' $false))) { Set-FlagsInEnv }
            else { Warn 'settings given but .env left unchanged; add --reconfigure to apply them' }
        }
        elseif ($O.Reconfigure -or ((Test-Interactive) -and (Confirm-Choice 'Change the port and tunables in the existing .env? Secrets are kept.' $false))) {
            Read-Tunables
        }
    }
    else {
        Write-Lines $EnvPath (Read-Lines $ExamplePath)
        Protect-EnvFile
        Ok 'created .env from .env.example'
        Add-MissingSecrets
        # Pin the project, which names the database volume, to the one Compose picks now (the
        # folder name, or -p), so a renamed or moved checkout keeps its data. Written once, here.
        $name = if ($O.Project) { $O.Project } else { Get-ProjectName }
        Set-EnvValue 'COMPOSE_PROJECT_NAME' $name
        Ok "COMPOSE_PROJECT_NAME=$name (names the database volume, ${name}_db-data)"
        if ($O.WebPort -or $O.Sets.Count -gt 0 -or -not (Test-Interactive)) { Set-FlagsInEnv } else { Read-Tunables }
    }
    Protect-EnvFile
    Ok "web port $(Get-WebPortSetting), project $(Get-ProjectName)"
}

function Invoke-MaybePull {
    & git -C $RepoDir rev-parse --is-inside-work-tree 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) { return }
    if ($O.Pull -eq $false) { return }
    $dirty = & git -C $RepoDir status --porcelain --untracked-files=no 2>$null
    if ($dirty) { Warn 'local changes in the checkout; not pulling'; return }
    if ($O.Pull -ne $true) {
        if (-not (Test-Interactive)) { return }
        if (-not (Confirm-Choice 'Pull the latest code (git pull --ff-only)?' $true)) { return }
    }
    $before = & git -C $RepoDir rev-parse HEAD
    & git -C $RepoDir pull --ff-only
    if ($LASTEXITCODE -ne 0) { Fail 'git pull failed; resolve it or deploy with --no-pull' }
    $after = & git -C $RepoDir rev-parse HEAD
    if ($before -ne $after) {
        Ok "updated $($before.Substring(0, 7)) -> $($after.Substring(0, 7)); restarting with the new script"
        $exe = (Get-Process -Id $PID).Path
        & $exe -NoProfile -ExecutionPolicy Bypass -File $PSCommandPath @OrigArgs --no-pull
        exit $LASTEXITCODE
    }
    Ok 'code already up to date'
}

function Assert-Secrets {
    foreach ($k in $Secrets) { if (-not (Get-EnvValue $k)) { Fail "$k is empty in .env; run: deploy.ps1 install" } }
}

function Test-Health([int]$Tries) {
    $url = "http://$(Get-WebHost):$(Get-WebPortNumber)/api/health"
    $body = ''
    for ($i = 1; $i -le $Tries; $i++) {
        try { $body = (Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 5).Content } catch { $body = '' }
        if ($body -match '"ok"') { Ok "$url -> $body"; return $true }
        if ($i -lt $Tries) { Start-Sleep -Seconds 2 }
    }
    Bad "$url did not answer ok"
    return $false
}

function Get-SiteUrl {
    $port = Get-WebPortNumber; $h = Get-WebHost
    if ($h -eq '127.0.0.1') { $h = [Environment]::MachineName.ToLowerInvariant() }
    if ($port -eq '80') { return "http://$h/" }
    return "http://${h}:$port/"
}

function Invoke-Deploy {
    if (-not (Test-Path -LiteralPath $EnvPath)) { Invoke-Install }
    Assert-Secrets
    Invoke-MaybePull
    if (-not (Invoke-Preflight)) { Fail 'preflight failed; fix the [FAIL] lines above' }
    # A plain `up --build` reuses whatever node and nginx base images are cached, so a server
    # would never get their security patches; --pull checks for newer ones on every deploy.
    Step 'Build with fresh base images (docker compose build --pull)'
    Invoke-Dc build --pull
    if ($LASTEXITCODE -ne 0) { Warn 'the build with --pull failed (no registry?); the next step builds from the local cache' }
    Step 'Build and start (docker compose up -d --build --wait)'
    Invoke-Dc up -d --build --remove-orphans --wait --wait-timeout 600
    if ($LASTEXITCODE -ne 0) {
        Invoke-Dc ps
        Write-Host 'Last api log lines:'; Invoke-Dc logs --tail 40 api
        Fail 'the stack did not become healthy'
    }
    Step 'Health through web'
    if (-not (Test-Health 30)) { Fail 'the stack is up but /api/health through web failed; see: deploy.ps1 logs' }
    Write-Host ''
    Write-Line "Deployed. Dashboard: $(Get-SiteUrl)  (Settings needs the Admin token: deploy.ps1 info --reveal)" 'Green'
}

function Invoke-Status {
    if (-not (Test-Path -LiteralPath $EnvPath)) { Fail 'not installed here yet (no .env); run: deploy.ps1 deploy' }
    Step "Containers ($(Get-ProjectName))"
    Invoke-Dc ps
    Step 'Health'
    if (-not (Test-Running 'web')) { Bad 'web is not running'; Fail 'the stack is not running' }
    if (-not (Test-Health 3)) { Fail 'unhealthy' }
}

function Invoke-Logs {
    $a = @('logs', '--tail', $O.Tail)
    if ($O.Follow) { $a += '-f' }
    if ($O.Service) { $a += $O.Service }
    Invoke-Dc @a
}

# The dump is made and checked inside the db container and copied out, so no binary data
# passes through a PowerShell pipeline.
function Invoke-Backup {
    Step 'Back up the database'
    if (-not (Test-Running 'db')) { Fail 'db is not running; start the stack first (deploy.ps1 deploy)' }
    if (-not (Test-Path -LiteralPath $BackupDir)) { New-Item -ItemType Directory -Path $BackupDir | Out-Null }
    $name = "$(Get-ProjectName)_$(Get-Date -Format 'yyyyMMdd-HHmmss').sql.gz"
    $tmp = "/tmp/$name"
    $dump = "MYSQL_PWD=`$MYSQL_ROOT_PASSWORD mysqldump -uroot --single-transaction --routines --triggers --no-tablespaces $DbName | gzip > $tmp && gzip -dc $tmp | tail -n 1 | grep -q 'Dump completed'"
    Invoke-Dc exec -T db sh -c $dump
    if ($LASTEXITCODE -ne 0) { Invoke-Dc exec -T db rm -f $tmp; Fail 'mysqldump failed or the dump is incomplete; nothing kept' }
    $file = Join-Path $BackupDir $name
    Invoke-Dc cp "db:$tmp" $file 2>&1 | Out-Null
    $copied = $LASTEXITCODE
    Invoke-Dc exec -T db rm -f $tmp
    if ($copied -ne 0 -or -not (Test-Path -LiteralPath $file)) { Fail 'could not copy the dump out of the db container' }
    Ok "backups\$name ($([int]((Get-Item -LiteralPath $file).Length / 1KB)) KB)"
    $script:LastBackup = $file
}

function Select-Backup {
    $files = @(Get-ChildItem -LiteralPath $BackupDir -Filter '*.sql.gz' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending)
    if ($files.Count -eq 0) { Fail 'no backups in backups\; give one with --file' }
    if (-not (Test-Interactive)) { Fail 'restore needs --file FILE' }
    for ($i = 0; $i -lt $files.Count; $i++) { Write-Host "  $($i + 1)) backups\$($files[$i].Name)" }
    $choice = 0
    [void][int]::TryParse((Ask 'Restore which' '1'), [ref]$choice)
    if ($choice -lt 1 -or $choice -gt $files.Count) { Fail 'no such backup' }
    $O.File = $files[$choice - 1].FullName
}

function Invoke-Restore {
    Step 'Restore the database'
    if (-not (Test-Running 'db')) { Fail 'db is not running; start the stack first (deploy.ps1 deploy)' }
    if (-not $O.File) { Select-Backup }
    $path = $O.File
    if (-not [IO.Path]::IsPathRooted($path)) { $path = Join-Path $RepoDir $path }
    if (-not (Test-Path -LiteralPath $path)) { Fail "$($O.File) does not exist" }
    $tmp = '/tmp/restore.sql.gz'
    Invoke-Dc cp $path "db:$tmp" 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { Fail 'could not copy the backup into the db container' }
    Invoke-Dc exec -T db gzip -t $tmp
    if ($LASTEXITCODE -ne 0) { Invoke-Dc exec -T db rm -f $tmp; Fail "$($O.File) is not a readable .sql.gz" }
    try { Confirm-Typed "This replaces the whole $(Get-ProjectName) database with $($O.File): every table, including any the backup does not have." }
    catch { Invoke-Dc exec -T db rm -f $tmp; throw }
    Invoke-Backup
    Ok "the current database is saved in $script:LastBackup"
    Invoke-Dc stop api
    # Into an empty database, so a table the dump lacks (one a later version added) does not survive
    # with rows from after the backup (.scratch/prodtest/resilience.md S5). The temperature user's
    # grant is on the database name and survives the drop; the api's migrations recreate whatever
    # newer tables the dump lacks, empty, when it starts.
    Invoke-Dc exec -T db sh -c "MYSQL_PWD=`$MYSQL_ROOT_PASSWORD mysql -uroot -e 'DROP DATABASE IF EXISTS ``$DbName``; CREATE DATABASE ``$DbName``'"
    if ($LASTEXITCODE -ne 0) {
        Invoke-Dc exec -T db rm -f $tmp
        Invoke-Dc up -d --wait api
        Fail "could not empty the database before the restore; put the previous state back with: deploy.ps1 restore --file $script:LastBackup"
    }
    Invoke-Dc exec -T db sh -c "gzip -dc $tmp | MYSQL_PWD=`$MYSQL_ROOT_PASSWORD mysql -uroot $DbName"
    $restored = $LASTEXITCODE
    Invoke-Dc exec -T db rm -f $tmp
    if ($restored -ne 0) {
        Invoke-Dc up -d --wait api
        Fail "the restore failed part-way; put the previous state back with: deploy.ps1 restore --file $script:LastBackup"
    }
    Ok "restored $($O.File)"
    Invoke-Dc up -d --wait api
    if ($LASTEXITCODE -ne 0) { Fail 'api did not come back healthy; see: deploy.ps1 logs --service api' }
    if (-not (Test-Health 30)) { Fail 'unhealthy after the restore' }
}

function Invoke-MigrateLegacy {
    if (-not (Test-Running 'api')) { Fail 'api is not running; start the stack first (deploy.ps1 deploy)' }
    Invoke-Backup
    Step 'Legacy migration (npm run migrate:legacy)'
    Invoke-Dc exec -T api npm run migrate:legacy
    if ($LASTEXITCODE -ne 0) { Fail 'the legacy migration failed; see the lines above and DEPLOYMENT.md' }
    Write-Host "Each 'legacy:' line names a row it skipped. Verify the counts as DEPLOYMENT.md describes."
}

function Hide-Secret([string]$Value) {
    if ($O.Reveal) { return $Value }
    if ($Value.Length -le 8) { return '********' }
    return "$($Value.Substring(0, 4))...$($Value.Substring($Value.Length - 4))"
}

function Invoke-Info {
    if (-not (Test-Path -LiteralPath $EnvPath)) { Fail 'no .env yet; run: deploy.ps1 install' }
    if (-not $O.Reveal -and (Test-Interactive) -and (Confirm-Choice 'Show the tokens in full on this screen?' $false)) { $O.Reveal = $true }
    $url = Get-SiteUrl
    $interval = Get-EnvValue 'REPORT_INTERVAL_SECONDS'
    Step "Temperature Alarms ($(Get-ProjectName))"
    Write-Host "  Dashboard     $url"
    Write-Host "  Admin token   $(Hide-Secret (Get-EnvValue 'ADMIN_TOKEN'))   (Settings page)"
    Write-Host "  Device token  $(Hide-Secret (Get-EnvValue 'DEVICE_TOKEN'))"
    Write-Host "  DB password   $(Hide-Secret (Get-EnvValue 'DB_PASSWORD'))"
    Write-Host ''
    Write-Host '  For arduino/TemperatureAlarms/config.h:'
    Write-Host "    #define SERVER_URL `"$($url.TrimEnd('/'))`""
    Write-Host "    #define DEVICE_TOKEN `"$(Hide-Secret (Get-EnvValue 'DEVICE_TOKEN'))`""
    if ($interval -and $interval -ne '30') { Write-Host "    #define REPORT_INTERVAL_SECONDS $interval" }
    if (-not $O.Reveal) { Write-Line '  Masked. Add --reveal to print them in full.' 'DarkGray' }
}

function Invoke-Stop {
    Step 'Stop'
    Invoke-Dc stop
    if ($LASTEXITCODE -ne 0) { Fail 'docker compose stop failed' }
    Ok 'stopped; data and .env kept. Start again with: deploy.ps1 deploy'
}

function Invoke-Uninstall {
    Step 'Uninstall'
    if (-not $O.Wipe -and (Test-Interactive) -and (Confirm-Choice 'Also delete the database volume (every Reading, Campus, and Device)?' $false)) { $O.Wipe = $true }
    if ($O.Wipe) {
        Confirm-Typed "This deletes the $(Get-ProjectName) database volume for good. Back up first if in doubt."
        Invoke-Dc down -v --rmi local --remove-orphans
        if ($LASTEXITCODE -ne 0) { Fail 'docker compose down failed' }
        Ok 'containers, built images, and the database volume removed'
    }
    else {
        Invoke-Dc down --rmi local --remove-orphans
        if ($LASTEXITCODE -ne 0) { Fail 'docker compose down failed' }
        Ok 'containers and built images removed; the database volume stays (--wipe deletes it)'
    }
    # A nightly backup of a removed stack fails every night; the task is the operator's to delete.
    if ($IsWindows -ne $false -and (Get-Command schtasks.exe -ErrorAction SilentlyContinue)) {
        schtasks.exe /Query /TN 'Temperature Alarms backup' *> $null
        if ($LASTEXITCODE -eq 0) { Warn 'the nightly backup task is still scheduled; remove it with: schtasks /Delete /F /TN "Temperature Alarms backup"' }
    }
    Write-Host "  .env and backups\ are left in $RepoDir."
}

# --- demo ------------------------------------------------------------------------------
# Everything below runs against the demo's own project and .env.demo, never the real ones.
function Use-Demo {
    $script:EnvPath = Join-Path $RepoDir '.env.demo'
    $script:DcArgs = @('-p', $DemoProject, '--env-file', '.env.demo', '-f', 'compose.yaml', '-f', 'compose.demo.yaml')
}

function New-DemoEnv {
    Write-Lines $EnvPath @(
        '# Throwaway settings for deploy.ps1 demo (compose.demo.yaml). deploy.ps1 demo --down deletes this file.'
        "COMPOSE_PROJECT_NAME=$DemoProject"
        "WEB_PORT=$DemoPort"
    )
    Protect-EnvFile
    foreach ($k in $Secrets) { Set-EnvValue $k (New-Secret) }
    Ok 'created .env.demo with fresh secrets'
}

function Invoke-Demo {
    if (-not (Test-Path -LiteralPath (Join-Path $RepoDir 'compose.demo.yaml'))) { Fail "compose.demo.yaml is missing in $RepoDir" }
    Use-Demo
    if ($O.Down) {
        Step "Remove the demo ($DemoProject)"
        # down reads the files, and compose.yaml needs the secrets set, so a missing file is remade first.
        if (-not (Test-Path -LiteralPath $EnvPath)) { New-DemoEnv }
        Invoke-Dc down -v --rmi local --remove-orphans
        if ($LASTEXITCODE -ne 0) { Fail 'docker compose down failed' }
        Remove-Item -LiteralPath $EnvPath -Force
        $left = & docker volume ls -q --filter "label=com.docker.compose.project=$DemoProject"
        if ($left) { Fail "a $DemoProject volume is still there: docker volume ls --filter label=com.docker.compose.project=$DemoProject" }
        Ok 'containers, images, the demo database volume, and .env.demo removed'
        return
    }
    Step 'Demo settings (.env.demo)'
    if (Test-Path -LiteralPath $EnvPath) { Ok '.env.demo exists; keeping its secrets' } else { New-DemoEnv }
    Set-FlagsInEnv
    if (-not (Invoke-Preflight)) { Fail 'preflight failed; fix the [FAIL] lines above' }
    Step "Build and start the demo (project $DemoProject)"
    Invoke-Dc up -d --build --remove-orphans --wait --wait-timeout 600
    if ($LASTEXITCODE -ne 0) {
        Invoke-Dc ps
        Write-Host 'Last demo log lines:'; Invoke-Dc logs --tail 40 demo api
        Fail 'the demo did not come up'
    }
    Step 'Health through web'
    if (-not (Test-Health 30)) { Fail "the demo is up but /api/health through web failed; see: docker compose -p $DemoProject logs" }
    Write-Host ''
    Write-Line "Demo running. Dashboard: $(Get-SiteUrl)" 'Green'
    Write-Host '  The first minute seeds 4 Campuses and 24 Devices and writes a week of history; then'
    Write-Host '  the closets loop through Hot, Dry, Mold risk, Cold, late, and Offline every 10 minutes.'
    Write-Host "  Admin token for Settings (throwaway): $(Get-EnvValue 'ADMIN_TOKEN')"
    Write-Host "  Watch it:  docker compose -p $DemoProject logs -f demo"
    Write-Host '  Remove it: deploy\deploy.ps1 demo --down'
}

function Show-ScheduleHint([string]$Name) {
    Warn 'Windows has no cron; schedule the backup with Task Scheduler. In a Command Prompt:'
    if ($Name -eq 'schedule-backup') {
        if ($O.At -notmatch '^([01]?[0-9]|2[0-3]):[0-5][0-9]$') { Fail '--at must be HH:MM (24-hour), e.g. 02:00' }
        $at = '{0:D2}:{1}' -f [int]$O.At.Split(':')[0], $O.At.Split(':')[1]
        $project = if ($O.Project) { " -p $($O.Project)" } else { '' }
        Write-Host "    schtasks /Create /F /TN `"Temperature Alarms backup`" /SC DAILY /ST $at /TR `"powershell.exe -NoProfile -ExecutionPolicy Bypass -File \`"$PSCommandPath\`" backup --yes$project`""
    }
    else { Write-Host '    schtasks /Delete /F /TN "Temperature Alarms backup"' }
    Fail 'nothing was scheduled here; run the line above'
}

function Invoke-Action([string]$Name) {
    switch ($Name) {
        'preflight' { if (-not (Invoke-Preflight)) { Fail 'preflight failed' } }
        'install' { Invoke-Install }
        { $_ -in 'deploy', 'upgrade' } { Invoke-Deploy }
        'status' { Invoke-Status }
        'logs' { Invoke-Logs }
        'backup' { Invoke-Backup }
        'restore' { Invoke-Restore }
        'migrate-legacy' { Invoke-MigrateLegacy }
        'info' { Invoke-Info }
        'stop' { Invoke-Stop }
        'uninstall' { Invoke-Uninstall }
        'demo' { Invoke-Demo }
        'bootstrap' { Fail 'bootstrap prepares a Linux server; run it there (deploy/deploy.sh bootstrap), or from here with --host USER@SERVER. On Windows, install Docker Desktop.' }
        { $_ -in 'schedule-backup', 'unschedule-backup' } { Show-ScheduleHint $Name }
        default { Fail "unknown action '$Name' (see --help)" }
    }
}

function Show-Menu {
    $map = @{ '1' = 'preflight'; '2' = 'install'; '3' = 'deploy'; '4' = 'status'; '5' = 'logs'; '6' = 'backup'
        '7' = 'restore'; '8' = 'migrate-legacy'; '9' = 'info'; '10' = 'stop'; '11' = 'uninstall'; '12' = 'demo' }
    while ($true) {
        Write-Host ''
        Write-Line "Temperature Alarms deploy  $RepoDir  (project $(Get-ProjectName), port $(Get-WebPortSetting))" 'Cyan'
        Write-Host '   1) Preflight checks          7) Restore the database'
        Write-Host '   2) First install (.env)      8) Run the legacy migration'
        Write-Host '   3) Deploy / upgrade          9) Show URL and tokens'
        Write-Host '   4) Status                   10) Stop'
        Write-Host '   5) Logs                     11) Uninstall'
        Write-Host '   6) Back up the database     12) Demo, no hardware needed'
        Write-Host '                                q) Quit'
        $choice = Read-Host '  Choose'
        if ($null -eq $choice -or $choice -in @('q', 'quit', 'exit')) { return }
        if (-not $map.ContainsKey($choice.Trim())) { Warn 'no such choice'; continue }
        $action = $map[$choice.Trim()]
        try { Invoke-Action $action }
        catch { Write-Line "Error: $($_.Exception.Message)" 'Red'; Warn "$action did not finish" }
        $O.File = ''; $O.Reveal = $false; $O.Wipe = $false; $O.Down = $false
        # The demo points these at its own project and .env.demo; the next action gets the real ones.
        $script:EnvPath = Join-Path $RepoDir '.env'; $script:DcArgs = @()
    }
}

# --- remote ----------------------------------------------------------------------------
function ConvertTo-ShQuoted([string]$Text) { return "'" + $Text.Replace("'", "'\''") + "'" }

# The remote side is a Linux or macOS server: this runs deploy.sh there. The script travels
# base64-encoded, so no quoting survives two shells and Windows argument passing.
function Invoke-RemoteHost([string]$Target) {
    $cmd = 'bash deploy/deploy.sh'
    foreach ($a in $O.Pass) { $cmd += ' ' + (ConvertTo-ShQuoted $a) }
    if ($O.Action -in @('deploy', 'upgrade') -and $null -eq $O.Pull) { $cmd += ' --pull' }
    $remote = @(
        'set -e'
        "dir=$(ConvertTo-ShQuoted $O.Dir); repo=$(ConvertTo-ShQuoted $O.Repo); branch=$(ConvertTo-ShQuoted $O.Branch)"
        'case "$dir" in ''~/''*) dir="$HOME/${dir#??}" ;; esac'
        'command -v git >/dev/null 2>&1 || { echo ''git is not installed on this server'' >&2; exit 2; }'
        'if [ ! -d "$dir/.git" ]; then'
        '  if [ -e "$dir" ]; then echo "$dir exists and is not a git checkout" >&2; exit 2; fi'
        '  [ -n "$repo" ] || { echo ''no checkout here and no --repo to clone'' >&2; exit 2; }'
        '  echo "Cloning $repo into $dir"'
        '  git clone ${branch:+--branch "$branch"} "$repo" "$dir"'
        'fi'
        'cd "$dir"'
        "exec $cmd"
    ) -join "`n"
    $b64 = [Convert]::ToBase64String($Utf8NoBom.GetBytes($remote + "`n"))
    $wrapper = "f=`$(mktemp) && echo $b64 | base64 -d > `$f && bash `$f; rc=`$?; rm -f `$f; exit `$rc"
    $sshArgs = @()
    if ((Test-Interactive) -and -not [Console]::IsOutputRedirected) { $sshArgs += '-t' }
    if ($O.SshOpts) { $sshArgs += @($O.SshOpts -split '\s+' | Where-Object { $_ }) }
    $sshArgs += @($Target, $wrapper)
    # Called as a statement, so ssh writes straight to the console (prompts included) and
    # only the exit code comes back, through $script:RemoteExit.
    & ssh @sshArgs
    $script:RemoteExit = $LASTEXITCODE
}

# bootstrap on a server that may have no git and no checkout yet: deploy.sh goes over on its
# own, base64 on stdin (no long command line; the server keeps only base64 characters, since
# Windows PowerShell 5.1 adds a BOM and CRLF), and runs from a temp file. No double quotes
# in the remote commands, which Windows PowerShell 5.1 would mangle on the way to ssh.
function Invoke-RemoteBootstrap([string]$Target) {
    $opts = @()
    if ($O.SshOpts) { $opts = @($O.SshOpts -split '\s+' | Where-Object { $_ }) }
    $b64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes((Join-Path $ScriptDir 'deploy.sh')))
    $tmp = "$($b64 | & ssh @opts $Target 'umask 077; f=$(mktemp) || exit 1; if tr -cd ''A-Za-z0-9+/='' | base64 -d > $f; then echo $f; else rm -f $f; exit 1; fi')".Trim()
    if ($LASTEXITCODE -ne 0 -or -not $tmp) { Bad "could not copy deploy.sh to $Target"; $script:RemoteExit = 1; return }
    $cmd = "bash $tmp bootstrap"
    if ($O.Yes) { $cmd += ' --yes' }
    $cmd += "; rc=`$?; rm -f $tmp; exit `$rc"
    $sshArgs = @()
    if (-not [Console]::IsInputRedirected -and -not [Console]::IsOutputRedirected) { $sshArgs += '-t' }
    & ssh @sshArgs @opts $Target $cmd
    $script:RemoteExit = $LASTEXITCODE
}

function Invoke-Remote {
    if ($O.Servers) {
        if (-not (Test-Path -LiteralPath $O.Servers)) { Fail "$($O.Servers) does not exist" }
        foreach ($line in (Get-Content -LiteralPath $O.Servers)) {
            $entry = ($line -replace '#.*$', '').Trim().Split(' ', [StringSplitOptions]::RemoveEmptyEntries)
            if ($entry.Count -gt 0) { $O.Hosts += $entry[0] }
        }
    }
    if ($O.Hosts.Count -eq 0) { Fail "no hosts in $($O.Servers)" }
    foreach ($h in $O.Hosts) {
        if (-not (Test-SshHost $h)) { Fail "'$h' is not a host: give USER@SERVER (ssh options go in --ssh-opts)" }
    }
    if (-not $O.Action -and $O.Hosts.Count -gt 1) { Fail 'give an action for more than one host' }
    if (-not $O.Action -and -not (Test-Interactive)) { Fail 'give an action, or run interactively for the menu' }
    if (-not (Get-Command ssh -ErrorAction SilentlyContinue)) { Fail 'ssh is not installed here (Windows: Settings > Optional features > OpenSSH Client)' }
    if (-not $O.Repo) { $O.Repo = "$(& git -C $RepoDir remote get-url origin 2>$null)" }
    $results = @(); $failed = $false
    $label = if ($O.Action) { $O.Action } else { 'menu' }
    if ($O.Bootstrap -and $O.Action -notin @('deploy', 'upgrade')) { Fail '--bootstrap goes with deploy' }
    foreach ($h in $O.Hosts) {
        Step "${h}: $label"
        if ($O.Action -eq 'bootstrap') {
            Invoke-RemoteBootstrap $h
        }
        else {
            # Each ssh is a fresh login, so the deploy that follows already has the docker group.
            if ($O.Bootstrap) {
                Invoke-RemoteBootstrap $h
                if ($script:RemoteExit -ne 0) { $results += "FAIL  $h (bootstrap)"; $failed = $true; continue }
            }
            Invoke-RemoteHost $h
        }
        if ($script:RemoteExit -eq 0) { $results += "ok    $h" } else { $results += "FAIL  $h"; $failed = $true }
    }
    Step "Summary ($label)"
    $results | ForEach-Object { Write-Host "  $_" }
    if ($failed) { exit 1 }
    exit 0
}

# --- main ------------------------------------------------------------------------------
try {
    Read-Args $OrigArgs
    if ($O.Hosts.Count -gt 0 -or $O.Servers) { Invoke-Remote }
    if ($O.Bootstrap) { Fail '--bootstrap is for deploys to servers (--host, --servers)' }
    Set-Location -LiteralPath $RepoDir
    if ($O.Project) { $env:COMPOSE_PROJECT_NAME = $O.Project }
    if (-not $O.Action) {
        if (-not (Test-Interactive)) { Show-Usage; exit 1 }
        Show-Menu
        exit 0
    }
    Invoke-Action $O.Action
    exit 0
}
catch {
    Write-Line "Error: $($_.Exception.Message)" 'Red'
    exit 1
}
