<#
.SYNOPSIS
    Stops the Normal server started by run.ps1. This is a hard stop.

.DESCRIPTION
    Blind Luck Poker Lite has `--stop`: a loopback request the server answers by cancelling live hands and
    refunding every wagered point before it exits. The Normal server has no such thing — it stops
    gracefully on SIGTERM under Docker, and Windows has no way to send one to a detached process.

    So this script does the only thing left: `Stop-Process`. **Every stack sitting on a table — Hold'em
    buy-ins and Blind table limits alike, up to 250.000 per Blind seat — and Blind B's carry-over pot are
    lost.** Recorded balances in Postgres are safe either way. Close the rooms first (`/health` must say
    `rooms:0`) — see README.md section 7.

    `run.ps1` normally runs the server as a scheduled task (`BlindLuckPoker-Normal`) whose action is a
    hidden PowerShell waiting on node. node is stopped first, by the pid in `normal.pid` — the task's
    own stop ends only that wrapper, never the node it started — and then the task, if it is still
    running. The task stays registered for the next `run.ps1`; `-Remove` unregisters it.

    Only this kit's own things are ever stopped: the pid must still be `node … dist/main.js`, and the
    task must be the one whose action runs the `run.ps1` beside this script with `-Serve`. A task of
    the same name that is anything else is left alone, and `-Remove` refuses it outright.

.PARAMETER PidFile
    The pid file to read. Default: `normal.pid` beside this script.

.PARAMETER TaskName
    The scheduled task `run.ps1` registered. Default: `BlindLuckPoker-Normal`. Letters, digits and
    `. _ -` only — never a wildcard pattern.

.PARAMETER Remove
    After stopping, also unregister the scheduled task — to uninstall the kit, or to drop an
    `-AutoStart` logon trigger for good.
#>
[CmdletBinding()]
param(
    [string] $PidFile,
    [string] $TaskName,
    [switch] $Remove
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false } catch { }

if ([string]::IsNullOrWhiteSpace($PidFile)) { $PidFile = Join-Path $PSScriptRoot 'normal.pid' }
if ([string]::IsNullOrWhiteSpace($TaskName)) { $TaskName = 'BlindLuckPoker-Normal' }

# The ScheduledTasks cmdlets read -TaskName as a wildcard pattern: `-Remove -TaskName *` would stop
# and unregister every task in the root folder this account may delete. So the name must be a plain
# one — the rule run.ps1 applies when it creates the task — checked before any task is looked at,
# and it is matched with -eq below as well, never handed to a cmdlet as a pattern.
if ($TaskName -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]*$') {
    [Console]::Error.WriteLine("[error] -TaskName chỉ được gồm chữ, số và . _ - (nhận được '$TaskName'). Không dừng, không gỡ gì cả.")
    exit 1
}

# The copy of run.ps1 whose task this script may stop: the one beside it.
$runScript = Join-Path $PSScriptRoot 'run.ps1'

# The root-folder task named exactly $TaskName, or $null — also on a Windows without the
# ScheduledTasks module, where run.ps1 can only have used -Foreground and there is no task to stop.
function Get-KitTask {
    if ($null -eq (Get-Command Get-ScheduledTask -ErrorAction SilentlyContinue)) { return $null }
    $found = @(Get-ScheduledTask -TaskPath '\' -ErrorAction SilentlyContinue | Where-Object { $_.TaskName -eq $TaskName })
    if ($found.Count -eq 0) { return $null }
    return $found[0]
}

function Test-KitTaskRunning {
    $task = Get-KitTask
    return ($null -ne $task -and "$($task.State)" -eq 'Running')
}

<#
    Whether a task is this kit's: one exec action running powershell.exe on the run.ps1 beside this
    script with -Serve (the same test run.ps1 applies before it overwrites a task). Anything else
    with the name — another program's task, another checkout's kit — is never stopped or removed.
#>
function Test-OwnTask($Task) {
    $actions = @($Task.Actions)
    if ($actions.Count -ne 1 -or $actions[0].CimClass.CimClassName -ne 'MSFT_TaskExecAction') { return $false }
    $execute = "$($actions[0].Execute)".Trim().Trim('"')
    $arguments = "$($actions[0].Arguments)"
    if ([System.IO.Path]::GetFileName($execute) -ine 'powershell.exe') { return $false }
    if ($arguments.IndexOf("-File `"$runScript`"", [System.StringComparison]::OrdinalIgnoreCase) -lt 0) { return $false }
    return ($arguments -match '(^|\s)-Serve(\s|$)')
}

# A command line that runs `dist/main.js` — the only thing this kit ever starts node with.
function Test-MainJsCommand($CommandLine) {
    if ($null -eq $CommandLine) { return $false }
    $command = "$CommandLine".Trim().TrimEnd('"')
    return ($command.EndsWith('dist/main.js', [System.StringComparison]::OrdinalIgnoreCase) -or
        $command.EndsWith('dist\main.js', [System.StringComparison]::OrdinalIgnoreCase))
}

# The pid names this kit's server only while it is `node.exe` running `dist/main.js`: a pid Windows
# has handed to another node since — a dev server, say — must not be killed for a stale file.
function Test-KitNode([int] $Id) {
    $proc = Get-CimInstance Win32_Process -Filter "ProcessId = $Id" -ErrorAction SilentlyContinue
    return ($null -ne $proc -and "$($proc.Name)" -ieq 'node.exe' -and (Test-MainJsCommand $proc.CommandLine))
}

<#
    The node the task's wrapper started, found without normal.pid — needed when the task runs but
    the file did not lead to node (deleted by hand, not written yet): stopping the task ends only the
    wrapper, and that node would keep the port with nothing left that knows its pid.

    The wrapper is the powershell.exe whose executable is the action's and whose command line *ends
    with* the action's arguments (not merely contains them: a second task of this kit with one more
    argument must not match). A child counts only if it is node.exe running `dist/main.js` and was
    created no earlier than the wrapper — a process whose parent pid merely equals the wrapper's,
    because Windows reused a dead parent's pid, is not the wrapper's child.
#>
function Get-TaskNode($Task) {
    $action = @($Task.Actions)[0]
    $execute = "$($action.Execute)".Trim().Trim('"')
    $arguments = "$($action.Arguments)".Trim()
    if ($arguments.Length -eq 0) { return @() }
    $found = @()
    try {
        $wrappers = @(Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" -ErrorAction Stop | Where-Object {
                $null -ne $_.CommandLine -and $null -ne $_.ExecutablePath -and
                ($(if ([System.IO.Path]::IsPathRooted($execute)) { "$($_.ExecutablePath)" -ieq $execute } else { [System.IO.Path]::GetFileName("$($_.ExecutablePath)") -ieq $execute })) -and
                "$($_.CommandLine)".TrimEnd().EndsWith(" $arguments", [System.StringComparison]::OrdinalIgnoreCase)
            })
        foreach ($wrapper in $wrappers) {
            $children = @(Get-CimInstance Win32_Process -Filter "ParentProcessId = $($wrapper.ProcessId) AND Name = 'node.exe'" -ErrorAction Stop)
            foreach ($child in $children) {
                if ((Test-MainJsCommand $child.CommandLine) -and $child.CreationDate -ge $wrapper.CreationDate) { $found += $child }
            }
        }
    } catch { }
    return $found
}

<#
    After node, the task — only if it is this kit's. Its wrapper exits by itself once node is gone
    (removing its own pid record), so it gets a moment to do that before it is stopped. Never
    unregistered here unless -Remove asked for it — the next run.ps1 reuses the task.
#>
function Complete-KitTask([bool] $NodeStopped) {
    $task = Get-KitTask
    if ($null -eq $task) {
        if ($Remove) { Write-Output "Không có scheduled task '$TaskName' — không có gì để gỡ." }
        return
    }
    if (-not (Test-OwnTask $task)) {
        # -Remove refused this before anything was stopped (below); a plain stop just leaves it be.
        Write-Output "[warn] Scheduled task '$TaskName' không chạy $runScript -Serve — không phải của bộ kit này, để nguyên."
        return
    }
    if ("$($task.State)" -eq 'Running') {
        if ($NodeStopped) {
            $deadline = (Get-Date).AddSeconds(5)
            while ((Test-KitTaskRunning) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 250 }
        } else {
            foreach ($orphan in @(Get-TaskNode $task)) {
                Write-Output "⚠ Scheduled task '$TaskName' đang chạy node pid $($orphan.ProcessId) mà $PidFile không ghi — tắt cứng pid đó."
                Stop-Process -Id $orphan.ProcessId -Force -ErrorAction SilentlyContinue
            }
        }
        $task = Get-KitTask
        if ($null -ne $task -and "$($task.State)" -eq 'Running') {
            $task | Stop-ScheduledTask
            Write-Output "Đã dừng scheduled task '$TaskName'."
        }
    }
    if ($Remove -and $null -ne $task) {
        $task | Unregister-ScheduledTask -Confirm:$false
        Write-Output "Đã gỡ scheduled task '$TaskName' (run.ps1 lần sau sẽ tạo lại)."
    }
}

# A pid problem ends the stop with an error — but an uninstall (-Remove) still completes first:
# the task is this kit's (checked below) and the pid file only ever concerned node.
function Exit-WithPidError([string] $Message) {
    [Console]::Error.WriteLine("[error] $Message")
    if ($Remove) { Complete-KitTask $false }
    exit 1
}

# -Remove on a task of this name that is not this kit's: refused before anything at all is stopped.
if ($Remove) {
    $named = Get-KitTask
    if ($null -ne $named -and -not (Test-OwnTask $named)) {
        [Console]::Error.WriteLine("[error] Scheduled task '$TaskName' không chạy $runScript -Serve — nó là của chương trình khác, hoặc của bộ kit ở thư mục khác. Không dừng, không gỡ gì cả; tự xem nó trong Task Scheduler (taskschd.msc).")
        exit 1
    }
}

if (-not (Test-Path -LiteralPath $PidFile)) {
    Write-Output "Không thấy $PidFile — server không chạy, hoặc nó được khởi động bằng cách khác."
    Complete-KitTask $false
    exit 0
}

$recorded = (Get-Content -LiteralPath $PidFile -Raw).Trim()
if ($recorded -notmatch '^\d+$') {
    Exit-WithPidError "$PidFile không chứa một pid hợp lệ ('$recorded'). Xoá file này rồi tìm tiến trình bằng: Get-Process node"
}

$target = Get-Process -Id ([int] $recorded) -ErrorAction SilentlyContinue
if ($null -eq $target) {
    Write-Output "pid $recorded không còn chạy. Xoá $PidFile."
    Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
    Complete-KitTask $false
    exit 0
}

# Windows reuses pids, and a pid file outlives the process that wrote it. Killing whatever now holds
# that number — an editor, a build, someone's browser — because a stale file named it would be a far
# worse bug than failing to stop a server.
if ($target.ProcessName -ne 'node') {
    Exit-WithPidError "pid $recorded bây giờ là '$($target.ProcessName)', không phải node — Windows đã cấp lại pid cho chương trình khác. Không dừng nó. Xoá $PidFile rồi kiểm tra bằng: Get-Process node"
}
# The same reuse, by another node: only `node … dist/main.js` is this kit's server.
if (-not (Test-KitNode $target.Id)) {
    Exit-WithPidError "pid $recorded là một tiến trình node khác (không chạy dist/main.js) — không phải server của bộ kit này. Không dừng nó. Xoá $PidFile rồi kiểm tra bằng: Get-Process node"
}

Write-Output "⚠ Tắt cứng pid $recorded. Mọi chồng đang trên bàn (buy-in Hold'em và hạn mức Blind) cùng pot cộng dồn của Blind B sẽ mất; số dư đã ghi trong database thì an toàn."
Stop-Process -Id $target.Id -Force
$target.WaitForExit(10000) | Out-Null
if (-not $target.HasExited) {
    Exit-WithPidError "pid $recorded vẫn chưa thoát sau 10 giây. Thử: Stop-Process -Id $recorded -Force"
}

# The task's wrapper may have removed it already, having seen node exit.
Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
Write-Output "Đã dừng. Xoá $PidFile."
Complete-KitTask $true
exit 0
