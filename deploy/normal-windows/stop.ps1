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

.PARAMETER PidFile
    The pid file to read. Default: `normal.pid` beside this script.

.PARAMETER TaskName
    The scheduled task `run.ps1` registered. Default: `BlindLuckPoker-Normal`.

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

# The kit's scheduled task, or $null — also on a Windows without the ScheduledTasks module, where
# run.ps1 can only have used -Foreground and there is no task to stop.
function Get-KitTask {
    if ($null -eq (Get-Command Get-ScheduledTask -ErrorAction SilentlyContinue)) { return $null }
    return Get-ScheduledTask -TaskName $TaskName -TaskPath '\' -ErrorAction SilentlyContinue
}

function Test-KitTaskRunning {
    $task = Get-KitTask
    return ($null -ne $task -and "$($task.State)" -eq 'Running')
}

<#
    node processes started by the task's wrapper: a `node.exe` whose parent is a `powershell.exe`
    running this task's action. Only needed when the task runs but `normal.pid` did not lead to node
    — the file deleted by hand, or not written yet — because stopping the task alone would leave
    that node running, holding the port, with nothing left that knows its pid.
#>
function Get-TaskNode {
    $task = Get-KitTask
    if ($null -eq $task) { return @() }
    $arguments = @($task.Actions | ForEach-Object { $_.Arguments } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
    if ($arguments.Count -eq 0) { return @() }
    $found = @()
    try {
        $wrappers = @(Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" -ErrorAction Stop |
            Where-Object { $null -ne $_.CommandLine -and $_.CommandLine.Contains($arguments[0]) })
        foreach ($wrapper in $wrappers) {
            $found += @(Get-CimInstance Win32_Process -Filter "ParentProcessId = $($wrapper.ProcessId) AND Name = 'node.exe'" -ErrorAction Stop)
        }
    } catch { }
    return $found
}

<#
    After node, the task: its wrapper exits by itself once node is gone (removing its own pid record),
    so it gets a moment to do that before it is stopped. Never unregistered here unless -Remove asked
    for it — the next run.ps1 reuses the task.
#>
function Complete-KitTask([bool] $NodeStopped) {
    if (Test-KitTaskRunning) {
        if ($NodeStopped) {
            $deadline = (Get-Date).AddSeconds(5)
            while ((Test-KitTaskRunning) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 250 }
        } else {
            foreach ($orphan in @(Get-TaskNode)) {
                Write-Output "⚠ Scheduled task '$TaskName' đang chạy node pid $($orphan.ProcessId) mà $PidFile không ghi — tắt cứng pid đó."
                Stop-Process -Id $orphan.ProcessId -Force -ErrorAction SilentlyContinue
            }
        }
        if (Test-KitTaskRunning) {
            Stop-ScheduledTask -TaskName $TaskName -TaskPath '\'
            Write-Output "Đã dừng scheduled task '$TaskName'."
        }
    }
    if ($Remove) {
        if ($null -ne (Get-KitTask)) {
            Unregister-ScheduledTask -TaskName $TaskName -TaskPath '\' -Confirm:$false
            Write-Output "Đã gỡ scheduled task '$TaskName' (run.ps1 lần sau sẽ tạo lại)."
        } else {
            Write-Output "Không có scheduled task '$TaskName' — không có gì để gỡ."
        }
    }
}

if (-not (Test-Path -LiteralPath $PidFile)) {
    Write-Output "Không thấy $PidFile — server không chạy, hoặc nó được khởi động bằng cách khác."
    Complete-KitTask $false
    exit 0
}

$recorded = (Get-Content -LiteralPath $PidFile -Raw).Trim()
if ($recorded -notmatch '^\d+$') {
    [Console]::Error.WriteLine("[error] $PidFile không chứa một pid hợp lệ ('$recorded'). Xoá file này rồi tìm tiến trình bằng: Get-Process node")
    exit 1
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
    [Console]::Error.WriteLine("[error] pid $recorded bây giờ là '$($target.ProcessName)', không phải node — Windows đã cấp lại pid cho chương trình khác. Không dừng gì cả. Xoá $PidFile rồi kiểm tra bằng: Get-Process node")
    exit 1
}

Write-Output "⚠ Tắt cứng pid $recorded. Mọi chồng đang trên bàn (buy-in Hold'em và hạn mức Blind) cùng pot cộng dồn của Blind B sẽ mất; số dư đã ghi trong database thì an toàn."
Stop-Process -Id $target.Id -Force
$target.WaitForExit(10000) | Out-Null
if (-not $target.HasExited) {
    [Console]::Error.WriteLine("[error] pid $recorded vẫn chưa thoát sau 10 giây. Thử: Stop-Process -Id $recorded -Force")
    exit 1
}

# The task's wrapper may have removed it already, having seen node exit.
Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
Write-Output "Đã dừng. Xoá $PidFile."
Complete-KitTask $true
exit 0
