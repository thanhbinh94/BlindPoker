<#
.SYNOPSIS
    Starts the Blind Luck Poker Normal server on a Windows PC for a LAN test — no Docker, no HTTPS.

.DESCRIPTION
    The Normal edition is normally a Docker Compose stack (deploy/normal/). This script is the other
    way in: one Windows machine, an already-built `dist/`, and a free hosted Postgres. It is a
    launcher, not a service wrapper — read README.md beside it before using it for anything but a
    test on your own network.

    Three decisions are worth knowing up front.

    **The server does not belong to the window that started it.** Started with
    `Start-Process -NoNewWindow`, node was attached to the launching console and lived in its process
    tree, so closing that window — or losing the session it ran in — killed the server without one
    line in its logs (bug log R2-5). By default this script now registers a per-user scheduled task
    (`BlindLuckPoker-Normal`: the current user, logged-on only, no admin, no stored password, no
    time limit) whose action is this same script with the internal `-Serve` switch, starts it, and
    waits for `/health` exactly as before. `-Serve` runs in a hidden PowerShell owned by Task
    Scheduler: it loads the same `.env` (sections 1-7), starts node in its foreground, records
    node's pid in `normal.pid` and exits with node's exit code. `-Foreground` keeps the old attached
    launch for debugging. `stop.ps1` stops node by pid and then the task; `stop.ps1 -Remove`
    unregisters it.

    **Nothing is ever written into `apps/normal-server`.** `main.ts` builds its config as
    `{ ...readDotenv('.env'), ...process.env }` — `process.env` spreads last and wins, so a stray
    `.env` left in that directory would only ever be *outranked* by this kit's variables, never the
    other way round. That is not why we avoid it: a file dropped into a git working tree survives the
    test and can be committed by accident. Simpler to never write one — every variable is set into
    `$env:` of the PowerShell session that starts node (the task's hidden one, or this one under
    `-Foreground`) and inherited by the child process. The checkout stays exactly as `git status`
    found it. Nor does any secret reach the scheduled task: its action carries paths, and the port
    and LAN address when they were passed, nothing else — `-Serve` reads the secrets from the file
    itself.

    **`PUBLIC_DIR` is made absolute here.** `apps/normal-server/src/app.ts` resolves a relative
    `PUBLIC_DIR` against `process.cwd()`, which is fine when the operator can see what the cwd is
    and confusing when a launcher chose it. Normalising it means the path printed by `-DryRun` is
    the path the server will open.

.PARAMETER EnvFile
    The environment file to read. Default: `.env` beside this script (copy `.env.example`).

.PARAMETER DryRun
    Print the normalised configuration — secrets masked — and the commands that would run, then
    exit 0. Touches neither the database nor the port.

.PARAMETER NoMigrate
    Skip `node dist/migrate-cli.js`. Use it when the schema is already applied.

.PARAMETER Port
    Override `PORT` from the environment file, for a one-off run on a different port.

.PARAMETER LanIp
    Skip network-adapter detection and use this address as the LAN URL and as the substitution for
    `<IP-LAN>` in `ALLOWED_ORIGINS`. Use it when the automatic pick is wrong — a Hyper-V default
    switch, WSL or a VPN adapter can end up with a lower interface metric than the real Wi-Fi/Ethernet
    card. Find the right address with `ipconfig` or `Get-NetIPAddress -AddressFamily IPv4`.

.PARAMETER Foreground
    The old launch: node attached to this console instead of the scheduled task. For debugging —
    closing this window stops the server.

.PARAMETER AutoStart
    Also give the scheduled task an `AtLogOn` trigger for the current user, so the server starts
    whenever that user logs on to Windows. A run without it removes the trigger again: the task
    always matches the flags of the last run.

.PARAMETER TaskName
    The scheduled task's name. Default `BlindLuckPoker-Normal`; `stop.ps1 -TaskName` must be given
    the same name.

.PARAMETER Serve
    Internal — the scheduled task's action. Loads the configuration like any run, then starts node
    in the foreground of this (hidden) process, records its pid, and exits with node's exit code.
    Never migrates, never registers anything.

.EXAMPLE
    .\run.ps1 -DryRun

.EXAMPLE
    .\run.ps1 -Port 9090

.EXAMPLE
    .\run.ps1 -LanIp 192.168.1.50

.EXAMPLE
    .\run.ps1 -AutoStart
#>
[CmdletBinding()]
param(
    [string] $EnvFile,
    [switch] $DryRun,
    [switch] $NoMigrate,
    [string] $Port,
    [string] $LanIp,
    [switch] $Foreground,
    [switch] $AutoStart,
    [string] $TaskName,
    [switch] $Serve
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

# The output of this script is Vietnamese prose, and PowerShell 5.1 hands the console whatever
# `[Console]::OutputEncoding` says — the OEM code page by default, which mangles every diacritic the
# moment the output is piped or redirected. (The script file itself carries a UTF-8 BOM for the same
# reason: 5.1 reads a BOM-less .ps1 as ANSI.)
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false } catch { }

$MIN_NODE = [version] '22.13.0'
$BUILD_HINT = 'pnpm build:normal'
$PLACEHOLDER = 'CHANGE_ME'
$LAN_TOKEN = '<IP-LAN>'
$MIN_SECRET_LENGTH = 32
$DEFAULT_TASK_NAME = 'BlindLuckPoker-Normal'

# Under -Serve nobody reads this process's console: Task Scheduler started it hidden. Its warnings
# and refusals (node missing from the task's PATH, an .env edited since the launcher checked it, a
# LAN address that never came) are also appended to normal.serve.log — a file of its own, because
# node's redirected output truncates normal.log and normal.err.log the moment node starts. The
# launcher reads it back: on failure beside the server's logs, on success to repeat the warnings.
$serveLog = Join-Path $PSScriptRoot 'normal.serve.log'
$serveLogWrite = [bool] $Serve
if ($Serve -and (Test-Path -LiteralPath $serveLog)) { Remove-Item -LiteralPath $serveLog -Force -ErrorAction SilentlyContinue }

function Write-ServeLog([string] $Line) {
    if (-not $serveLogWrite) { return }
    try { [System.IO.File]::AppendAllText($serveLog, "$Line`r`n", (New-Object System.Text.UTF8Encoding $false)) } catch { }
}

function Write-Info([string] $Message) { Write-Output $Message }

# Warnings go to stdout, not the warning stream: an operator reading a console and a test reading a
# captured pipe should both see them in order, next to the line they qualify.
function Write-Note([string] $Message) {
    Write-ServeLog "[warn] $Message"
    Write-Output "[warn] $Message"
}

function Stop-WithError([string] $Message) {
    [Console]::Error.WriteLine("[error] $Message")
    Write-ServeLog "[error] $Message"
    exit 1
}

# Where a malformed `.env` line is. On a console it comes with a masked, truncated preview; under
# -Serve the message lands in a file that outlives the run, so even that much of the line stays out.
function Format-EnvLineContext([string] $Text) {
    if ($Serve) { return '' }
    return " — '$(Get-SafeLinePreview $Text)'"
}

<#
    Reads a `KEY=VALUE` file the way the operator wrote it: blank lines and `#` comments dropped, the
    split on the *first* `=` so a password or a connection string may contain more, and one matching
    pair of surrounding quotes removed. A malformed line is refused rather than skipped — a typo in a
    connection string should not read as "the variable was never set".
#>
function Read-EnvFile([string] $Path) {
    $values = New-Object 'System.Collections.Specialized.OrderedDictionary'
    $lineNumber = 0
    foreach ($raw in [System.IO.File]::ReadAllLines($Path, [System.Text.Encoding]::UTF8)) {
        $lineNumber++
        $line = $raw.Trim()
        if ($line.Length -eq 0 -or $line.StartsWith('#')) { continue }
        $split = $line.IndexOf('=')
        if ($split -lt 1) {
            Stop-WithError "$Path dòng $($lineNumber): không phải dạng KEY=VALUE$(Format-EnvLineContext $line)"
        }
        $key = $line.Substring(0, $split).Trim()
        if ($key -notmatch '^[A-Za-z_][A-Za-z0-9_]*$') {
            Stop-WithError "$Path dòng $($lineNumber): tên biến không hợp lệ$(Format-EnvLineContext $key)"
        }
        $value = $line.Substring($split + 1).Trim()
        if ($value.Length -ge 2) {
            $first = $value[0]
            if (($first -eq '"' -or $first -eq "'") -and $value[$value.Length - 1] -eq $first) {
                $value = $value.Substring(1, $value.Length - 2)
            }
        }
        $values[$key] = $value
    }
    return $values
}

<#
    The LAN address to print and to substitute into `ALLOWED_ORIGINS`.

    The metric that decides "which route is primary" lives on `Get-NetIPInterface`, not on
    `Get-NetAdapter` — `Get-NetAdapter`'s own `InterfaceMetric` property is always `$null`, so sorting
    on it is a no-op that silently falls back to whatever order the adapters happened to enumerate in.
    This walks `Up` adapters' IPv4 interfaces sorted by their real `InterfaceMetric` (lowest = most
    preferred — Windows' own idea of the default route) and returns the first non-loopback, non-APIPA
    `Preferred` address found. `169.254.*` is excluded because an APIPA address means DHCP failed: it
    is an address no other machine can reach, and printing it would send the operator hunting a
    firewall problem that is not there.

    A machine with a Hyper-V default switch, WSL, VirtualBox host-only network or a VPN adapter can
    still end up with a virtual adapter at a lower metric than the real one — `-LanIp` exists for
    exactly that case; see `README.md`.
#>
function Get-LanIPv4 {
    try {
        $upIndexes = @(Get-NetAdapter -ErrorAction Stop | Where-Object { $_.Status -eq 'Up' } | Select-Object -ExpandProperty InterfaceIndex)
        if ($upIndexes.Count -eq 0) { return $null }
        $ordered = @(Get-NetIPInterface -AddressFamily IPv4 -ErrorAction Stop |
            Where-Object { $upIndexes -contains $_.InterfaceIndex -and $_.ConnectionState -eq 'Connected' } |
            Sort-Object InterfaceMetric)
        foreach ($iface in $ordered) {
            $addresses = @(Get-NetIPAddress -AddressFamily IPv4 -InterfaceIndex $iface.InterfaceIndex -ErrorAction SilentlyContinue |
                Where-Object { $_.IPAddress -ne '127.0.0.1' -and -not $_.IPAddress.StartsWith('169.254.') -and $_.AddressState -eq 'Preferred' })
            if ($addresses.Count -gt 0) { return $addresses[0].IPAddress }
        }
    } catch {
        # Get-NetAdapter/Get-NetIPInterface are absent on Windows Server Core installs without the
        # NetAdapter module, and on anything older than Windows 8. Not a reason to refuse to start.
    }
    return $null
}

# `postgres://user:password@host/db` → `postgres://user:***@host/db`. The URL is printed so the
# operator can confirm they pasted the right *host*; the password is never part of that question.
function Format-DatabaseUrl([string] $Value) {
    return [System.Text.RegularExpressions.Regex]::Replace($Value, '(?<=://[^:/@]{1,200}:)[^@]*(?=@)', '***')
}

# A malformed `.env` line is the likeliest place a mis-pasted Neon connection string — password and
# all — would otherwise land on the console verbatim. Mask anything that looks like `user:pass@` and
# then cut it well short of where a password would sit; the line number already tells the operator
# where to look, and the content should never be worth more than that.
function Get-SafeLinePreview([string] $Text) {
    $masked = Format-DatabaseUrl $Text
    $limit = 24
    if ($masked.Length -le $limit) { return $masked }
    return "$($masked.Substring(0, $limit))…"
}

# `http(s)://host[:port]` and nothing else — no path, no query, no trailing slash, no userinfo.
# Mirrors `isAbsoluteOrigin` in apps/normal-server/src/config.ts (`url.origin === value`): reconstruct
# the origin from the parsed URI and require it to match the text verbatim.
function Test-AbsoluteOrigin([string] $Value) {
    $uri = $null
    try { $uri = [uri] $Value } catch { return $false }
    if ($null -eq $uri -or -not $uri.IsAbsoluteUri) { return $false }
    if ($uri.Scheme -ne 'http' -and $uri.Scheme -ne 'https') { return $false }
    $isDefaultPort = ($uri.Scheme -eq 'http' -and $uri.Port -eq 80) -or ($uri.Scheme -eq 'https' -and $uri.Port -eq 443)
    $expected = if ($isDefaultPort) { "$($uri.Scheme)://$($uri.Host)" } else { "$($uri.Scheme)://$($uri.Host):$($uri.Port)" }
    return $Value -ceq $expected
}

# Polls `GET /health` instead of grepping the log for the `listening` line `main.ts` writes with
# `log.info`: `createJsonLogger` drops `info` when `LOG_LEVEL` is `warn` or `error`, which made the
# old grep hang the full 30 s and print a false "server chưa báo listening" for a server that was
# already serving. Any HTTP response — including the 503 `/health` itself returns while the database
# is still unreachable — means the port is open and the process is answering; only a refused or timed
# out connection means it is not.
function Test-ServerListening([int] $Port) {
    $request = [System.Net.WebRequest]::Create("http://127.0.0.1:$Port/health")
    $request.Method = 'GET'
    $request.Timeout = 250
    try {
        $response = $request.GetResponse()
        $response.Close()
        return $true
    } catch [System.Net.WebException] {
        if ($null -ne $_.Exception.Response) {
            $_.Exception.Response.Close()
            return $true
        }
        return $false
    } catch {
        return $false
    }
}

function Read-FileShared([string] $Path) {
    try {
        $stream = [System.IO.File]::Open($Path, 'Open', 'Read', 'ReadWrite')
        try {
            $reader = New-Object System.IO.StreamReader($stream)
            return $reader.ReadToEnd()
        } finally { $stream.Close() }
    } catch { return '' }
}

# The pid in `normal.pid`, or $null while the file is absent, half-written or not a pid.
function Read-PidFile([string] $Path) {
    if (-not (Test-Path -LiteralPath $Path)) { return $null }
    $text = (Read-FileShared $Path).Trim()
    if ($text -match '^\d+$') { return [int] $text }
    return $null
}

# The root-folder task named exactly $Name, or $null — also when this Windows has no ScheduledTasks
# module, so the checks built on it degrade to "no task" instead of failing a -Foreground. The
# ScheduledTasks cmdlets treat -TaskName as a wildcard pattern; the name is validated in section 0
# and matched here with -eq as well, so no pattern ever reaches Task Scheduler from this script.
function Get-KitTask([string] $Name) {
    if ($null -eq (Get-Command Get-ScheduledTask -ErrorAction SilentlyContinue)) { return $null }
    $found = @(Get-ScheduledTask -TaskPath '\' -ErrorAction SilentlyContinue | Where-Object { $_.TaskName -eq $Name })
    if ($found.Count -eq 0) { return $null }
    return $found[0]
}

function Test-KitTaskRunning([string] $Name) {
    $task = Get-KitTask $Name
    return ($null -ne $task -and "$($task.State)" -eq 'Running')
}

<#
    Whether the run started at $StartedAt has already ended. Not merely "not Running": right after
    Start-ScheduledTask the task can still read Ready or Queued, and that is a start still coming,
    not one that failed. Ended means neither Running nor Queued *and* a last run time at or after the
    start (less two seconds: Task Scheduler keeps whole seconds). A task that has vanished has ended.
#>
function Test-TaskRunEnded([string] $Name, [datetime] $StartedAt) {
    $task = Get-KitTask $Name
    if ($null -eq $task) { return $true }
    $state = "$($task.State)"
    if ($state -eq 'Running' -or $state -eq 'Queued') { return $false }
    $info = $task | Get-ScheduledTaskInfo -ErrorAction SilentlyContinue
    return ($null -ne $info -and $info.LastRunTime -ge $StartedAt.AddSeconds(-2))
}

<#
    Whether a task is this kit's: one exec action running powershell.exe on *this* copy of run.ps1
    with -Serve. A task of the same name that is anything else — another program's, or another
    checkout's kit — is never overwritten, started or stopped by this script.
#>
function Test-OwnTask($Task, [string] $RunScript) {
    $actions = @($Task.Actions)
    if ($actions.Count -ne 1 -or $actions[0].CimClass.CimClassName -ne 'MSFT_TaskExecAction') { return $false }
    $execute = "$($actions[0].Execute)".Trim().Trim('"')
    $arguments = "$($actions[0].Arguments)"
    if ([System.IO.Path]::GetFileName($execute) -ine 'powershell.exe') { return $false }
    if ($arguments.IndexOf("-File `"$RunScript`"", [System.StringComparison]::OrdinalIgnoreCase) -lt 0) { return $false }
    return ($arguments -match '(^|\s)-Serve(\s|$)')
}

# `node.exe` running `dist/main.js`, the only command this kit ever starts. A pid in normal.pid is
# trusted only while this holds: Windows reuses pids, and the one in the file may since have gone to
# another program — including another node, a dev server say, that must never be taken for ours.
function Test-KitNode([int] $Id) {
    $proc = Get-CimInstance Win32_Process -Filter "ProcessId = $Id" -ErrorAction SilentlyContinue
    if ($null -eq $proc -or "$($proc.Name)" -ine 'node.exe' -or $null -eq $proc.CommandLine) { return $false }
    $command = "$($proc.CommandLine)".Trim().TrimEnd('"')
    return ($command.EndsWith('dist/main.js', [System.StringComparison]::OrdinalIgnoreCase) -or
        $command.EndsWith('dist\main.js', [System.StringComparison]::OrdinalIgnoreCase))
}

# --- 0. Which launch ---------------------------------------------------------------------------

if ([string]::IsNullOrWhiteSpace($TaskName)) { $TaskName = $DEFAULT_TASK_NAME }
if ($TaskName -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]*$') {
    Stop-WithError "-TaskName chỉ được gồm chữ, số và . _ - (nhận được '$TaskName')."
}
# -LanIp is printed, substituted into ALLOWED_ORIGINS and written into the task's action, so it is
# held to what it claims to be: a dotted IPv4 address or a plain host name.
if (-not [string]::IsNullOrWhiteSpace($LanIp)) {
    $ipv4 = $LanIp -match '^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$' -and
        @($Matches[1], $Matches[2], $Matches[3], $Matches[4] | Where-Object { [int] $_ -gt 255 }).Count -eq 0
    $hostName = $LanIp -match '^(?=.{1,253}$)[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$' -and
        $LanIp -notmatch '^[\d.]+$'
    if (-not ($ipv4 -or $hostName)) {
        Stop-WithError "-LanIp phải là một địa chỉ IPv4 (ví dụ 192.168.1.50) hoặc một tên máy, nhận được '$LanIp'."
    }
}
if ($Serve -and ($DryRun -or $Foreground -or $AutoStart)) {
    Stop-WithError '-Serve là tham số nội bộ của scheduled task, không đi cùng -DryRun, -Foreground hay -AutoStart. Chạy .\run.ps1 không có -Serve.'
}
if ($Foreground -and $AutoStart) {
    Stop-WithError '-AutoStart thêm trigger đăng nhập cho scheduled task, còn -Foreground không dùng scheduled task — chọn một trong hai.'
}
# The stop command to print: `stop.ps1` finds the default task by itself, a renamed one it must be told.
$stopCommand = if ($TaskName -eq $DEFAULT_TASK_NAME) { '.\stop.ps1' } else { ".\stop.ps1 -TaskName $TaskName" }
# Recorded now because PowerShell names are case-insensitive: section 4's `$lanIp` *is* `$LanIp`,
# and after it the variable holds the detected address whether or not the caller passed one.
$lanIpPassed = -not [string]::IsNullOrWhiteSpace($LanIp)

# --- 1. Where everything is -------------------------------------------------------------------

$kitDir = $PSScriptRoot
$repoRoot = Split-Path -Parent (Split-Path -Parent $kitDir)
$serverDir = Join-Path $repoRoot 'apps\normal-server'
$pidFile = Join-Path $kitDir 'normal.pid'
$outLog = Join-Path $kitDir 'normal.log'
$errLog = Join-Path $kitDir 'normal.err.log'

# --- 2. Prerequisites -------------------------------------------------------------------------

$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if ($null -eq $nodeCommand) {
    Stop-WithError "Không tìm thấy lệnh 'node' trong PATH. Cài Node.js 22.13 trở lên từ https://nodejs.org rồi mở lại PowerShell."
}
$nodeExe = $nodeCommand.Source

$nodeVersionRaw = (& $nodeExe -v | Out-String).Trim()
$nodeVersion = $null
try { $nodeVersion = [version] (($nodeVersionRaw.TrimStart('v') -split '-')[0]) } catch { }
if ($null -eq $nodeVersion) {
    Stop-WithError "Không đọc được phiên bản Node từ '$nodeVersionRaw'. Cần Node $MIN_NODE trở lên."
}
if ($nodeVersion -lt $MIN_NODE) {
    Stop-WithError "Node $nodeVersionRaw quá cũ. Cần $MIN_NODE trở lên — tải bản LTS ở https://nodejs.org."
}

$mainJs = Join-Path $serverDir 'dist\main.js'
$migrateJs = Join-Path $serverDir 'dist\migrate-cli.js'
$webIndex = Join-Path $repoRoot 'apps\normal-web\dist\index.html'
foreach ($artefact in @($mainJs, $migrateJs, $webIndex)) {
    if (-not (Test-Path -LiteralPath $artefact)) {
        Stop-WithError "Thiếu $artefact — chạy '$BUILD_HINT' ở thư mục gốc repo ($repoRoot) trước đã."
    }
}

# --- 3. The environment file ------------------------------------------------------------------

if ([string]::IsNullOrWhiteSpace($EnvFile)) { $EnvFile = Join-Path $kitDir '.env' }
if (-not (Test-Path -LiteralPath $EnvFile)) {
    Stop-WithError "Không thấy file cấu hình $EnvFile. Chép .env.example thành .env rồi điền DATABASE_URL và SESSION_SECRET."
}
$EnvFile = (Resolve-Path -LiteralPath $EnvFile).Path
$settings = Read-EnvFile $EnvFile

$problems = @()
foreach ($key in @('DATABASE_URL', 'SESSION_SECRET')) {
    if (-not $settings.Contains($key) -or [string]::IsNullOrWhiteSpace($settings[$key])) {
        $problems += "$key chưa được đặt trong $EnvFile"
    } elseif ($settings[$key].Contains($PLACEHOLDER)) {
        $problems += "$key vẫn còn giá trị mẫu $PLACEHOLDER — thay bằng giá trị thật"
    }
}
if ($settings.Contains('SESSION_SECRET') -and -not $settings['SESSION_SECRET'].Contains($PLACEHOLDER) -and $settings['SESSION_SECRET'].Length -lt $MIN_SECRET_LENGTH) {
    $problems += "SESSION_SECRET dài $($settings['SESSION_SECRET'].Length) ký tự, cần ít nhất $MIN_SECRET_LENGTH"
}
if ($problems.Count -gt 0) {
    # Every problem at once, the way loadConfig reports its own: an operator filling a fresh file
    # should learn about all of them in one run rather than one per attempt.
    Stop-WithError ("Cấu hình chưa dùng được:`n" + (($problems | ForEach-Object { "  - $_" }) -join "`n"))
}

# --- 4. The LAN address -----------------------------------------------------------------------

$lanIpMissing = $false
if (-not [string]::IsNullOrWhiteSpace($LanIp)) {
    $lanIp = $LanIp
} else {
    $lanIp = Get-LanIPv4
    # A task started by the -AutoStart logon trigger can run before Wi-Fi has an address; falling
    # back to 'localhost' then would lock every other machine out (CORS) until the next restart.
    # Only -Serve waits — an operator at a console would rather see the warning now. The launcher
    # knows it: when its own detection found nothing, section 11 waits these 60 s longer.
    $lanIpMissing = ($null -eq $lanIp)
    if ($null -eq $lanIp -and $Serve) {
        $lanDeadline = (Get-Date).AddSeconds(60)
        while ($null -eq $lanIp -and (Get-Date) -lt $lanDeadline) {
            Start-Sleep -Seconds 2
            $lanIp = Get-LanIPv4
        }
    }
    if ($null -eq $lanIp) {
        $lanIp = 'localhost'
        Write-Note "Không xác định được địa chỉ IPv4 LAN (không có card mạng nào Up, hoặc chỉ có địa chỉ 169.254.*). Dùng tạm 'localhost' — máy khác trong mạng sẽ không vào được cho tới khi bạn sửa ALLOWED_ORIGINS bằng tay, hoặc chạy lại với -LanIp <địa chỉ thật>."
    }
}
foreach ($key in @($settings.Keys | ForEach-Object { $_ })) {
    if ($settings[$key] -is [string] -and $settings[$key].Contains($LAN_TOKEN)) {
        if ($key -eq 'ALLOWED_ORIGINS') {
            $settings[$key] = $settings[$key].Replace($LAN_TOKEN, $lanIp)
        } else {
            Stop-WithError "$key chứa $LAN_TOKEN nhưng script chỉ thay chỗ này trong ALLOWED_ORIGINS. Điền địa chỉ thật ($lanIp) vào $key."
        }
    }
}

# --- 5. PUBLIC_DIR, absolute ------------------------------------------------------------------

$publicDir = $null
if ($settings.Contains('PUBLIC_DIR') -and -not [string]::IsNullOrWhiteSpace($settings['PUBLIC_DIR'])) {
    $publicDir = $settings['PUBLIC_DIR']
} else {
    $publicDir = Join-Path $repoRoot 'apps\normal-web\dist'
}
# A relative PUBLIC_DIR is relative to the server's working directory, which is what the operator
# sees in `.env.example` (`../../apps/normal-web/dist`) and what the server itself would resolve.
if (-not [System.IO.Path]::IsPathRooted($publicDir)) { $publicDir = Join-Path $serverDir $publicDir }
$publicDir = [System.IO.Path]::GetFullPath($publicDir)
$settings['PUBLIC_DIR'] = $publicDir
if (-not (Test-Path -LiteralPath (Join-Path $publicDir 'index.html'))) {
    Write-Note "PUBLIC_DIR=$publicDir không có index.html — server vẫn chạy nhưng chỉ có API, không có giao diện. Chạy '$BUILD_HINT' để dựng lại."
}

# --- 6. Port, origins -------------------------------------------------------------------------
# Both are validated here, before section 8's dry run and before anything in sections 9-11 runs, so
# `-DryRun` catches exactly the class of mistake it exists for: a config the server would refuse.

if (-not [string]::IsNullOrWhiteSpace($Port)) {
    $parsedPort = 0
    if (-not [int]::TryParse($Port, [ref] $parsedPort) -or $parsedPort -lt 1 -or $parsedPort -gt 65535) {
        Stop-WithError "-Port phải là số nguyên 1–65535, nhận được '$Port'. Cổng 0 (ngẫu nhiên) không dùng được với bộ kit này vì ALLOWED_ORIGINS cần một cổng cố định."
    }
    $settings['PORT'] = "$parsedPort"
}
if (-not $settings.Contains('PORT') -or [string]::IsNullOrWhiteSpace($settings['PORT'])) { $settings['PORT'] = '8080' }
if (-not $settings.Contains('HOST') -or [string]::IsNullOrWhiteSpace($settings['HOST'])) { $settings['HOST'] = '0.0.0.0' }
$effectivePort = $settings['PORT']
$effectivePortNum = 0
if (-not [int]::TryParse($effectivePort, [ref] $effectivePortNum) -or $effectivePortNum -lt 1 -or $effectivePortNum -gt 65535) {
    Stop-WithError "PORT phải là số nguyên 1–65535, nhận được '$effectivePort' trong $EnvFile."
}

$origins = @()
if ($settings.Contains('ALLOWED_ORIGINS')) { $origins = @($settings['ALLOWED_ORIGINS'] -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ }) }
if ($origins.Count -eq 0) {
    Stop-WithError "ALLOWED_ORIGINS chưa được đặt trong $EnvFile — cần ít nhất một origin, ví dụ http://localhost:$effectivePort (danh sách cách nhau bằng dấu phẩy)."
}
$badOrigins = @($origins | Where-Object { -not (Test-AbsoluteOrigin $_) })
if ($badOrigins.Count -gt 0) {
    Stop-WithError ("ALLOWED_ORIGINS có origin không hợp lệ trong $($EnvFile):`n" +
        (($badOrigins | ForEach-Object { "  - '$_'" }) -join "`n") +
        "`nMỗi origin phải đúng dạng http(s)://host[:port] — không có path, không có dấu / ở cuối, không có tên đăng nhập.")
}
# A reverse proxy or tunnel — Cloudflare Tunnel, README §8 — puts a different origin between the
# browser and this process: the browser's origin is the tunnel's `https://…trycloudflare.com` on
# 443 while the server itself keeps listening on $effectivePortNum. That is not a misconfiguration,
# it is what fronting the server looks like, so the port-match requirement below only makes sense
# for the direct-LAN case it was written for. Either signal that something is in front is enough to
# skip it: an `https://` origin (this kit never terminates TLS itself, so that origin can only be a
# proxy's), or `TRUST_PROXY` set to anything but `false` (its direct-LAN default, matching
# `config.ts`'s own default).
$trustProxyValue = if ($settings.Contains('TRUST_PROXY')) { $settings['TRUST_PROXY'] } else { 'false' }
$behindProxy = ($trustProxyValue -ne 'false') -or (@($origins | Where-Object { ([uri] $_).Scheme -eq 'https' })).Count -gt 0
if (-not $behindProxy) {
    $matching = @($origins | Where-Object { ([uri] $_).Port -eq $effectivePortNum })
    if ($matching.Count -eq 0) {
        Stop-WithError "ALLOWED_ORIGINS không có origin nào ở cổng $effectivePortNum trong $EnvFile — trình duyệt sẽ bị server từ chối (CORS). Sửa ALLOWED_ORIGINS cho khớp cổng đang chạy, hoặc chạy lại với -Port đúng cổng đã có trong ALLOWED_ORIGINS. (Chạy sau reverse proxy/tunnel như Cloudflare Tunnel — xem README mục 8 — thì đặt origin https:// hoặc TRUST_PROXY khác false để bỏ qua kiểm tra này.)"
    }
}

# --- 7. Into this session's environment, and nowhere else -------------------------------------

foreach ($key in @($settings.Keys | ForEach-Object { $_ })) {
    Set-Item -Path "Env:$key" -Value $settings[$key]
}

# --- 7b. -Serve: the scheduled task's side ------------------------------------------------------
# Everything above ran exactly as for the launcher, so this process's environment is the server's
# configuration. What is left is to run node and to be the process Task Scheduler waits on: node
# lives exactly as long as this hidden PowerShell does not stop waiting for it. Nothing here
# migrates (the launcher did, before it started the task) or touches the task.

if ($Serve) {
    # A second -Serve beside a live server (by hand, or a task started twice) must not delete the
    # running server's logs and overwrite its pid; the launcher refuses the same case in section 9.
    $recordedPid = Read-PidFile $pidFile
    if ($null -ne $recordedPid -and (Test-KitNode $recordedPid)) {
        Stop-WithError "Đã có một server đang chạy (pid $recordedPid, ghi trong $pidFile). -Serve không khởi động bản thứ hai."
    }

    foreach ($log in @($outLog, $errLog)) { if (Test-Path -LiteralPath $log) { Remove-Item -LiteralPath $log -Force } }

    # -NoNewWindow puts node on this process's console, which Task Scheduler created hidden —
    # without it Start-Process would open a visible console window for node.
    $process = Start-Process -FilePath $nodeExe -ArgumentList 'dist/main.js' -WorkingDirectory $serverDir `
        -NoNewWindow -PassThru -RedirectStandardOutput $outLog -RedirectStandardError $errLog
    # Reading `Handle` once makes the Process object keep the OS handle, which is what lets
    # `ExitCode` be read after `WaitForExit()` (see the -Foreground branch of section 11, where it
    # is not, and the code is often missing).
    $null = $process.Handle
    Set-Content -LiteralPath $pidFile -Value $process.Id -Encoding ASCII
    $process.WaitForExit()

    $exitCode = 1
    try { if ($null -ne $process.ExitCode) { $exitCode = [int] $process.ExitCode } } catch { }
    # Only this server's record: a stop.ps1 that got there first already removed it, and a file that
    # names another pid belongs to someone else.
    if ((Read-PidFile $pidFile) -eq $process.Id) { Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue }
    exit $exitCode
}

# --- 7c. How the server will be launched ------------------------------------------------------
# Computed once so the dry run prints the very action section 11 registers. Only paths, and the
# port and LAN address when the caller passed them, go into it: the task's definition is readable
# by anyone who can open Task Scheduler on this account, and `-Serve` reads the secrets from the
# file itself.

$taskUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$taskExe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
if (-not (Test-Path -LiteralPath $taskExe)) { $taskExe = 'powershell.exe' }
$taskArgumentList = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden',
    '-File', "`"$PSCommandPath`"", '-Serve', '-EnvFile', "`"$EnvFile`"")
if (-not [string]::IsNullOrWhiteSpace($Port)) { $taskArgumentList += @('-Port', $settings['PORT']) }
if ($lanIpPassed) { $taskArgumentList += @('-LanIp', "`"$lanIp`"") }
$taskArguments = $taskArgumentList -join ' '

# --- 8. Dry run: say what would happen, then stop ----------------------------------------------

if ($DryRun) {
    Write-Info "[dry-run] Cấu hình chuẩn hoá từ $EnvFile (bí mật đã che):"
    foreach ($key in @($settings.Keys | ForEach-Object { $_ })) {
        $shown = $settings[$key]
        if ($key -eq 'DATABASE_URL') { $shown = Format-DatabaseUrl $shown }
        elseif ($key -eq 'SESSION_SECRET') { $shown = "*** ($($shown.Length) ký tự)" }
        Write-Info "  $key=$shown"
    }
    Write-Info "[dry-run] IP LAN: $lanIp"
    Write-Info "[dry-run] Thư mục làm việc: $serverDir"
    if ($NoMigrate) {
        Write-Info "  (bỏ qua vì -NoMigrate) node dist/migrate-cli.js"
    } else {
        Write-Info "  node dist/migrate-cli.js"
    }
    Write-Info "  node dist/main.js"
    if ($Foreground) {
        Write-Info "[dry-run] Chế độ chạy: foreground (-Foreground) — node gắn vào cửa sổ này; đóng cửa sổ là server dừng."
    } else {
        Write-Info "[dry-run] Chế độ chạy: detached — scheduled task '$TaskName' (người dùng $taskUser, chỉ khi đã đăng nhập, không cần quyền admin); đóng cửa sổ này server vẫn chạy."
        Write-Info "  Action: `"$taskExe`" $taskArguments"
        if ($AutoStart) {
            Write-Info "  Trigger: AtLogOn (-AutoStart) — tự chạy mỗi lần $taskUser đăng nhập Windows."
        } else {
            Write-Info '  Trigger: không có — chỉ chạy khi gọi run.ps1 (thêm -AutoStart để tự chạy khi đăng nhập).'
        }
    }
    Write-Info "[dry-run] Không có gì được chạy. Bỏ -DryRun để khởi động thật."
    exit 0
}

# --- 9. Refuse to start a second copy ----------------------------------------------------------

if (Test-Path -LiteralPath $pidFile) {
    $existing = (Get-Content -LiteralPath $pidFile -Raw).Trim()
    $alive = $null
    if ($existing -match '^\d+$') { $alive = Get-Process -Id ([int] $existing) -ErrorAction SilentlyContinue }
    if ($null -ne $alive -and $alive.ProcessName -eq 'node' -and (Test-KitNode $alive.Id)) {
        Stop-WithError "Đã có một server đang chạy (pid $existing). Dừng bằng $stopCommand rồi chạy lại."
    }
    $staleReason = if ($null -eq $alive) { "pid $existing không còn chạy" } else { "pid $existing giờ là một tiến trình khác, không phải server này" }
    Write-Note "Xoá $pidFile cũ ($staleReason) — dấu vết của một lần tắt không sạch."
    Remove-Item -LiteralPath $pidFile -Force
}
# The pid file is this kit's record, the task is Windows' own: a running task is a server (or one
# on its way up) even when normal.pid was deleted by hand or not written yet. And a task of this
# name that is not this kit's is refused here, before migrations — section 11 would otherwise have
# to overwrite it.
$existingTask = Get-KitTask $TaskName
if ($null -ne $existingTask) {
    if (Test-OwnTask $existingTask $PSCommandPath) {
        if ("$($existingTask.State)" -eq 'Running') {
            Stop-WithError "Scheduled task '$TaskName' đang chạy — server đã được khởi động tách nền từ trước. Dừng bằng $stopCommand rồi chạy lại."
        }
    } elseif (-not $Foreground) {
        Stop-WithError "Đã có một scheduled task tên '$TaskName' nhưng nó không chạy $PSCommandPath -Serve — của chương trình khác, hoặc của bộ kit ở thư mục khác. Không ghi đè. Chạy lại với -TaskName <tên khác>, hoặc tự xem nó trong Task Scheduler (taskschd.msc)."
    }
}

# --- 10. Migrations ----------------------------------------------------------------------------

if (-not $NoMigrate) {
    Write-Info "Đang áp migrations (node dist/migrate-cli.js)…"
    Push-Location $serverDir
    # Captured (not streamed live) so a failure can be inspected before deciding which hint to print —
    # see below. Still printed in full either way. `$ErrorActionPreference` has to drop to 'Continue'
    # for the call: with it at 'Stop', merging a native command's stderr into the pipeline via `2>&1`
    # turns the *first* stderr line into a terminating exception instead of a captured string — which
    # would abort the script on the very output this is trying to read.
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $migrateOutput = @(& $nodeExe 'dist/migrate-cli.js' 2>&1 | ForEach-Object { "$_" })
        $migrateExit = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $prevEap
        Pop-Location
    }
    foreach ($line in $migrateOutput) { Write-Info $line }
    if ($migrateExit -ne 0) {
        # The Neon/DATABASE_URL hint used to appear for *every* migrate-cli failure, including a bad
        # migration file or an ALLOWED_ORIGINS-shaped typo elsewhere — actively misleading for anything
        # that is not a connection problem. Only show it when the output actually looks like one.
        $combined = $migrateOutput -join "`n"
        $hint = ''
        if ($combined -match 'ECONNREFUSED|ETIMEDOUT|ENOTFOUND|ECONNRESET|EHOSTUNREACH|Connection terminated|timeout expired|self[- ]signed certificate|certificate has expired|password authentication failed') {
            $hint = ' Kiểm tra DATABASE_URL (Neon free ngủ sau ~5 phút không dùng — thử chạy lại lần nữa).'
        }
        Stop-WithError "migrate-cli thoát với mã $migrateExit.$hint"
    }
    Write-Info "Migrations xong."
}

# --- 11. Start ---------------------------------------------------------------------------------

# Section 9 looked at this kit's pid file and task. A server started some other way — another
# checkout, a -Foreground window, a node orphaned by a killed wrapper — only shows as an answer on
# the port, and the wait below would take that other server's /health for ours and report a start
# that never happened (while the new node died of EADDRINUSE a moment later).
if (Test-ServerListening $effectivePortNum) {
    Stop-WithError "Cổng $effectivePortNum đã có một server khác trả lời (http://127.0.0.1:$effectivePortNum/health). Tìm tiến trình giữ cổng bằng: Get-NetTCPConnection -LocalPort $effectivePortNum -State Listen — hoặc chạy với -Port khác."
}

foreach ($log in @($outLog, $errLog)) { if (Test-Path -LiteralPath $log) { Remove-Item -LiteralPath $log -Force } }

# Waiting for the port to answer — rather than printing a URL the moment the server is launched — is
# what turns a bad DATABASE_URL from "the browser shows nothing and no one knows why" into the actual
# error, here, on this console. This polls `GET /health` rather than grepping the log for the
# `listening` line `main.ts` writes with `log.info`: `LOG_LEVEL=warn` or `error` drops `info`-level
# logs entirely, which used to make a perfectly healthy start wait the full 30 s and then print a
# false "chưa báo listening" warning.
$listening = $false
$exited = $false
$serverPid = $null
$exitCodeText = ''
$waitSeconds = 30

if ($Foreground) {
    $process = Start-Process -FilePath $nodeExe -ArgumentList 'dist/main.js' -WorkingDirectory $serverDir `
        -NoNewWindow -PassThru -RedirectStandardOutput $outLog -RedirectStandardError $errLog
    $serverPid = $process.Id
    Set-Content -LiteralPath $pidFile -Value $process.Id -Encoding ASCII

    $deadline = (Get-Date).AddSeconds($waitSeconds)
    while ((Get-Date) -lt $deadline) {
        if ($process.HasExited) { break }
        if (Test-ServerListening $effectivePortNum) { $listening = $true; break }
        Start-Sleep -Milliseconds 250
    }
    if ($process.HasExited) {
        $exited = $true
        # `ExitCode` is null on a `Start-Process -PassThru` handle even after the process is gone — the
        # cmdlet does not keep the OS handle the property needs, and `WaitForExit()` cannot conjure it
        # back. Reported when it happens to be there, dropped when it is not; what an operator needs from
        # this message is the server's own words below, not a number.
        try { $process.WaitForExit(); if ($null -ne $process.ExitCode) { $exitCodeText = " (mã $($process.ExitCode))" } } catch { }
    }
} else {
    if ($null -eq (Get-Command Register-ScheduledTask -ErrorAction SilentlyContinue)) {
        Stop-WithError 'Windows này không có module ScheduledTasks (Register-ScheduledTask). Chạy lại với -Foreground — server khi đó gắn vào cửa sổ này.'
    }
    # Section 9 already refused a task of this name that is not this kit's; asked again right here
    # because -Force below replaces whatever definition carries the name.
    $currentTask = Get-KitTask $TaskName
    if ($null -ne $currentTask -and -not (Test-OwnTask $currentTask $PSCommandPath)) {
        Stop-WithError "Scheduled task '$TaskName' không phải của bộ kit này ($PSCommandPath). Không ghi đè — chạy lại với -TaskName <tên khác>."
    }
    $taskAction = New-ScheduledTaskAction -Execute $taskExe -Argument $taskArguments -WorkingDirectory $kitDir
    # Interactive + Limited: runs as this user, only while they are logged on, never elevated, with no
    # stored password — nothing here asks for admin.
    $taskPrincipal = New-ScheduledTaskPrincipal -UserId $taskUser -LogonType Interactive -RunLevel Limited
    # ExecutionTimeLimit zero is "no limit" (the default, 72 hours, would kill the server on day
    # three); IgnoreNew makes a second start of a running task a no-op; the battery and idle rules are
    # off so a laptop keeps serving; priority 4 is normal — the task default, 7, is below normal, and
    # node would inherit it.
    $taskSettings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew `
        -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -DontStopOnIdleEnd -Priority 4
    $registration = @{
        TaskName    = $TaskName
        TaskPath    = '\'
        Action      = $taskAction
        Principal   = $taskPrincipal
        Settings    = $taskSettings
        Description = "Blind Luck Poker Normal (LAN), tạo bởi $PSCommandPath. Dừng bằng stop.ps1 cạnh script đó; gỡ task bằng stop.ps1 -Remove."
        Force       = $true
    }
    # -Force replaces the whole definition, so without -AutoStart a trigger left by an earlier
    # -AutoStart run is gone too: the task always matches the last run's flags.
    if ($AutoStart) { $registration['Trigger'] = New-ScheduledTaskTrigger -AtLogOn -User $taskUser }
    $registeredTask = $null
    try {
        $registeredTask = Register-ScheduledTask @registration
    } catch {
        Stop-WithError "Không đăng ký được scheduled task '$TaskName': $($_.Exception.Message) Chạy lại với -Foreground để chạy gắn vào cửa sổ này."
    }
    if (Test-Path -LiteralPath $serveLog) { Remove-Item -LiteralPath $serveLog -Force }

    # When this launcher's own detection found no LAN address, -Serve spends up to 60 s waiting for
    # one before it starts node (section 4), and the wait here covers that too.
    if ($lanIpMissing -and -not $lanIpPassed) { $waitSeconds = 90 }
    if ($waitSeconds -gt 30) {
        Write-Note "Chưa có địa chỉ LAN: tiến trình nền chờ card mạng tối đa 60 giây trước khi mở server — chờ tối đa $waitSeconds giây."
    }

    $startedAt = Get-Date
    $registeredTask | Start-ScheduledTask
    # node is not this process's child: its pid comes from the file -Serve writes, and its exit is
    # seen through Get-Process.
    $deadline = $startedAt.AddSeconds($waitSeconds)
    while ((Get-Date) -lt $deadline) {
        if ($null -eq $serverPid) { $serverPid = Read-PidFile $pidFile }
        if ($null -ne $serverPid) {
            if ($null -eq (Get-Process -Id $serverPid -ErrorAction SilentlyContinue)) { $exited = $true; break }
        } elseif (Test-TaskRunEnded $TaskName $startedAt) {
            # This start of the task has come and gone and no pid was ever seen: -Serve refused before
            # starting node (its words are in normal.serve.log), or node died before the first look.
            $exited = $true
            break
        }
        if (Test-ServerListening $effectivePortNum) { $listening = $true; break }
        Start-Sleep -Milliseconds 250
    }
    if ($exited) {
        # The task's last result is -Serve's exit code, which is node's. It lands once the wrapper has
        # noticed and exited, a moment after node.
        $settleDeadline = (Get-Date).AddSeconds(5)
        while ((Test-KitTaskRunning $TaskName) -and (Get-Date) -lt $settleDeadline) { Start-Sleep -Milliseconds 250 }
        $endedTask = Get-KitTask $TaskName
        if ($null -ne $endedTask -and "$($endedTask.State)" -ne 'Running') {
            $taskInfo = $endedTask | Get-ScheduledTaskInfo -ErrorAction SilentlyContinue
            if ($null -ne $taskInfo) { $exitCodeText = " (mã $($taskInfo.LastTaskResult))" }
        }
    } elseif ($null -eq $serverPid) {
        $serverPid = Read-PidFile $pidFile
        if ($null -eq $serverPid -and -not $listening) {
            # Neither a pid nor an answer, and the task never got going: Task Scheduler did not run it.
            $idleTask = Get-KitTask $TaskName
            $idleState = if ($null -ne $idleTask) { "$($idleTask.State)" } else { 'không còn' }
            if ($idleState -ne 'Running') {
                Stop-WithError "Scheduled task '$TaskName' không chạy sau $waitSeconds giây (trạng thái: $idleState). Xem Last Run Result trong Task Scheduler (taskschd.msc), hoặc chạy lại với -Foreground."
            }
        }
    }
}

if ($exited) {
    Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
    $serveText = if ($Foreground) { '' } else { Read-FileShared $serveLog }
    $details = ($serveText + (Read-FileShared $errLog) + (Read-FileShared $outLog)).Trim()
    if ($details.Length -eq 0) { $details = "(server không in ra gì — xem $outLog và $errLog)" }
    Stop-WithError ("Server thoát ngay khi khởi động$($exitCodeText):`n$details")
}

$pidText = if ($null -ne $serverPid) { "pid $serverPid" } else { "chưa có $pidFile" }
if (-not $listening) {
    Write-Note "Server chưa báo 'listening' sau $waitSeconds giây nhưng vẫn đang chạy ($pidText). Xem $outLog và $errLog."
}
if (-not $Foreground) {
    # -Serve's own warnings (the same checks as this run's, made again in the hidden window).
    $serveNotes = @((Read-FileShared $serveLog) -split "`r?`n" | Where-Object { $_.Trim().Length -gt 0 })
    if ($serveNotes.Count -gt 0) {
        Write-Info "Tiến trình nền (-Serve) ghi trong $($serveLog):"
        foreach ($note in $serveNotes) { Write-Info "  $note" }
    }
    # The address -Serve waited for may have arrived after this launcher's own look.
    if ($lanIpMissing -and -not $lanIpPassed) {
        $lateLanIp = Get-LanIPv4
        if ($null -ne $lateLanIp) { $lanIp = $lateLanIp }
    }
}

Write-Info ''
Write-Info "Blind Luck Poker Normal đang chạy — $pidText, log ở $outLog"
Write-Info "  Máy này:        http://localhost:$effectivePort"
Write-Info "  Máy khác trong LAN: http://$($lanIp):$effectivePort"
Write-Info ''
if ($Foreground) {
    Write-Info 'Chạy -Foreground: server gắn vào cửa sổ này — đóng cửa sổ (hoặc mất phiên đăng nhập) là server dừng, không để lại dòng lỗi nào.'
} else {
    Write-Info "Chạy tách nền bằng scheduled task '$TaskName' — đóng cửa sổ này server vẫn chạy (đăng xuất Windows thì dừng). Xem trong Task Scheduler (taskschd.msc) hoặc: Get-ScheduledTask $TaskName"
    if ($AutoStart) {
        Write-Info "Tự chạy mỗi lần $taskUser đăng nhập Windows (-AutoStart). Bỏ: chạy lại run.ps1 không có -AutoStart, hoặc $stopCommand -Remove."
    }
}
Write-Info ''
Write-Info 'Nếu máy khác không vào được, mở PowerShell bằng quyền Administrator và chạy một lần:'
Write-Info "  New-NetFirewallRule -DisplayName `"Blind Luck Poker Normal`" -Direction Inbound -Protocol TCP -LocalPort $effectivePort -Profile Private -Action Allow"
Write-Info ''
Write-Info "Dừng server:  $stopCommand   (tắt cứng — đóng hết phòng trước, xem README.md mục 7)"
exit 0
