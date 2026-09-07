<#
.SYNOPSIS
    Starts the Bind Poker Normal server on a Windows PC for a LAN test — no Docker, no HTTPS.

.DESCRIPTION
    The Normal edition is normally a Docker Compose stack (deploy/normal/). This script is the other
    way in: one Windows machine, an already-built `dist/`, and a free hosted Postgres. It is a
    launcher, not a service wrapper — read README.md beside it before using it for anything but a
    test on your own network.

    Two decisions are worth knowing up front.

    **Nothing is ever written into `apps/normal-server`.** `main.ts` builds its config as
    `{ ...readDotenv('.env'), ...process.env }` — `process.env` spreads last and wins, so a stray
    `.env` left in that directory would only ever be *outranked* by this kit's variables, never the
    other way round. That is not why we avoid it: a file dropped into a git working tree survives the
    test and can be committed by accident. Simpler to never write one — every variable is set into
    `$env:` of this PowerShell session and inherited by the child process. The checkout stays exactly
    as `git status` found it.

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

.EXAMPLE
    .\run.ps1 -DryRun

.EXAMPLE
    .\run.ps1 -Port 9090

.EXAMPLE
    .\run.ps1 -LanIp 192.168.1.50
#>
[CmdletBinding()]
param(
    [string] $EnvFile,
    [switch] $DryRun,
    [switch] $NoMigrate,
    [string] $Port,
    [string] $LanIp
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

function Write-Info([string] $Message) { Write-Output $Message }

# Warnings go to stdout, not the warning stream: an operator reading a console and a test reading a
# captured pipe should both see them in order, next to the line they qualify.
function Write-Note([string] $Message) { Write-Output "[warn] $Message" }

function Stop-WithError([string] $Message) {
    [Console]::Error.WriteLine("[error] $Message")
    exit 1
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
            Stop-WithError "$Path dòng $($lineNumber): không phải dạng KEY=VALUE — '$(Get-SafeLinePreview $line)'"
        }
        $key = $line.Substring(0, $split).Trim()
        if ($key -notmatch '^[A-Za-z_][A-Za-z0-9_]*$') {
            Stop-WithError "$Path dòng $($lineNumber): tên biến không hợp lệ — '$(Get-SafeLinePreview $key)'"
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

if (-not [string]::IsNullOrWhiteSpace($LanIp)) {
    $lanIp = $LanIp
} else {
    $lanIp = Get-LanIPv4
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
    Write-Info "[dry-run] Không có gì được chạy. Bỏ -DryRun để khởi động thật."
    exit 0
}

# --- 9. Refuse to start a second copy ----------------------------------------------------------

if (Test-Path -LiteralPath $pidFile) {
    $existing = (Get-Content -LiteralPath $pidFile -Raw).Trim()
    $alive = $null
    if ($existing -match '^\d+$') { $alive = Get-Process -Id ([int] $existing) -ErrorAction SilentlyContinue }
    if ($null -ne $alive -and $alive.ProcessName -eq 'node') {
        Stop-WithError "Đã có một server đang chạy (pid $existing). Dừng bằng .\stop.ps1 rồi chạy lại."
    }
    Write-Note "Xoá $pidFile cũ (pid $existing không còn chạy) — dấu vết của một lần tắt không sạch."
    Remove-Item -LiteralPath $pidFile -Force
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

foreach ($log in @($outLog, $errLog)) { if (Test-Path -LiteralPath $log) { Remove-Item -LiteralPath $log -Force } }

$process = Start-Process -FilePath $nodeExe -ArgumentList 'dist/main.js' -WorkingDirectory $serverDir `
    -NoNewWindow -PassThru -RedirectStandardOutput $outLog -RedirectStandardError $errLog
Set-Content -LiteralPath $pidFile -Value $process.Id -Encoding ASCII

# Waiting for the port to answer — rather than printing a URL the moment Start-Process returns — is
# what turns a bad DATABASE_URL from "the browser shows nothing and no one knows why" into the actual
# error, here, on this console. This polls `GET /health` rather than grepping the log for the
# `listening` line `main.ts` writes with `log.info`: `LOG_LEVEL=warn` or `error` drops `info`-level
# logs entirely, which used to make a perfectly healthy start wait the full 30 s and then print a
# false "chưa báo listening" warning.
$deadline = (Get-Date).AddSeconds(30)
$listening = $false
while ((Get-Date) -lt $deadline) {
    if ($process.HasExited) { break }
    if (Test-ServerListening $effectivePortNum) { $listening = $true; break }
    Start-Sleep -Milliseconds 250
}

if ($process.HasExited) {
    Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
    # `ExitCode` is null on a `Start-Process -PassThru` handle even after the process is gone — the
    # cmdlet does not keep the OS handle the property needs, and `WaitForExit()` cannot conjure it
    # back. Reported when it happens to be there, dropped when it is not; what an operator needs from
    # this message is the server's own words below, not a number.
    $code = ''
    try { $process.WaitForExit(); if ($null -ne $process.ExitCode) { $code = " (mã $($process.ExitCode))" } } catch { }
    $details = ((Read-FileShared $errLog) + (Read-FileShared $outLog)).Trim()
    if ($details.Length -eq 0) { $details = "(server không in ra gì — xem $outLog và $errLog)" }
    Stop-WithError ("Server thoát ngay khi khởi động$($code):`n$details")
}

if (-not $listening) {
    Write-Note "Server chưa báo 'listening' sau 30 giây nhưng vẫn đang chạy (pid $($process.Id)). Xem $outLog và $errLog."
}

Write-Info ''
Write-Info "Bind Poker Normal đang chạy — pid $($process.Id), log ở $outLog"
Write-Info "  Máy này:        http://localhost:$effectivePort"
Write-Info "  Máy khác trong LAN: http://$($lanIp):$effectivePort"
Write-Info ''
Write-Info 'Nếu máy khác không vào được, mở PowerShell bằng quyền Administrator và chạy một lần:'
Write-Info "  New-NetFirewallRule -DisplayName `"Bind Poker Normal`" -Direction Inbound -Protocol TCP -LocalPort $effectivePort -Profile Private -Action Allow"
Write-Info ''
Write-Info 'Dừng server:  .\stop.ps1   (tắt cứng — đóng hết phòng trước, xem README.md mục 7)'
exit 0
