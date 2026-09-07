<#
.SYNOPSIS
    Stops the Normal server started by run.ps1. This is a hard stop.

.DESCRIPTION
    Bind Poker Lite has `--stop`: a loopback request the server answers by cancelling live hands and
    refunding every wagered point before it exits. The Normal server has no such thing — it stops
    gracefully on SIGTERM under Docker, and Windows has no way to send one to a detached process.

    So this script does the only thing left: `Stop-Process`. **Hold'em stacks sitting on a table and
    Blind B's carry-over pot are lost.** Recorded balances in Postgres are safe either way. Close the
    rooms before running it — see README.md section 7.

.PARAMETER PidFile
    The pid file to read. Default: `normal.pid` beside this script.
#>
[CmdletBinding()]
param(
    [string] $PidFile
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false } catch { }

if ([string]::IsNullOrWhiteSpace($PidFile)) { $PidFile = Join-Path $PSScriptRoot 'normal.pid' }

if (-not (Test-Path -LiteralPath $PidFile)) {
    Write-Output "Không thấy $PidFile — server không chạy, hoặc nó được khởi động bằng cách khác."
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
    Remove-Item -LiteralPath $PidFile -Force
    exit 0
}

# Windows reuses pids, and a pid file outlives the process that wrote it. Killing whatever now holds
# that number — an editor, a build, someone's browser — because a stale file named it would be a far
# worse bug than failing to stop a server.
if ($target.ProcessName -ne 'node') {
    [Console]::Error.WriteLine("[error] pid $recorded bây giờ là '$($target.ProcessName)', không phải node — Windows đã cấp lại pid cho chương trình khác. Không dừng gì cả. Xoá $PidFile rồi kiểm tra bằng: Get-Process node")
    exit 1
}

Write-Output "⚠ Tắt cứng pid $recorded. Stack Hold'em đang trên bàn và pot cộng dồn của Blind B sẽ mất; số dư đã ghi trong database thì an toàn."
Stop-Process -Id $target.Id -Force
$target.WaitForExit(10000) | Out-Null
if (-not $target.HasExited) {
    [Console]::Error.WriteLine("[error] pid $recorded vẫn chưa thoát sau 10 giây. Thử: Stop-Process -Id $recorded -Force")
    exit 1
}

Remove-Item -LiteralPath $PidFile -Force
Write-Output "Đã dừng. Xoá $PidFile."
exit 0
