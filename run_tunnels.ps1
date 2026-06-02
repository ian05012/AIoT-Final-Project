# PowerShell 腳本：啟動 Serveo 穿透並自動設定 WebSocket 網址
# 確保執行的工作目錄正確
$PSScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
if ($PSScriptRoot) { Set-Location $PSScriptRoot }

# 1. 啟動 WebSocket (埠 3000) 穿透，取得隨機網址
Write-Host "[Serveo] 正在啟動 WebSocket 伺服器 (埠 3000) 穿透..."
$wsProcessInfo = New-Object System.Diagnostics.ProcessStartInfo
$wsProcessInfo.FileName = "ssh"
$wsProcessInfo.Arguments = "-o StrictHostKeyChecking=no -R 80:localhost:3000 serveo.net"
$wsProcessInfo.RedirectStandardOutput = $true
$wsProcessInfo.UseShellExecute = $false
$wsProcessInfo.CreateNoWindow = $true

$wsProcess = New-Object System.Diagnostics.Process
$wsProcess.StartInfo = $wsProcessInfo
$wsProcess.Start() | Out-Null

$wsUrl = ""
$startTime = Get-Date
# 讀取 stdout 直到取得轉發網址
while ($wsProcess.StandardOutput.EndOfStream -eq $false) {
    $line = $wsProcess.StandardOutput.ReadLine()
    Write-Host "[WS Log] $line"
    if ($line -match "Forwarding HTTP traffic from (https://[a-zA-Z0-9\-\.]+)") {
        $wsUrl = $Matches[1]
        break
    }
    # 逾時判定 (30秒)
    if (((Get-Date) - $startTime).TotalSeconds -gt 30) {
        Write-Host "[Error] 啟動 WebSocket 穿透逾時！"
        break
    }
}

if ($wsUrl -ne "") {
    $wssUrl = $wsUrl.Replace("http://", "ws://").Replace("https://", "wss://")
    Write-Host "[Success] 取得 WebSocket 公開網址: $wssUrl"
    
    # 寫入 config.json
    $config = @{ ws_url = $wssUrl }
    $configJson = $config | ConvertTo-Json
    $configJson | Out-File -FilePath "public/config.json" -Encoding utf8
    Write-Host "[Success] 已成功更新 public/config.json"
} else {
    Write-Host "[Error] 無法從 Serveo 取得隨機網址！"
    exit 1
}

# 2. 啟動 Web 服務 (埠 8000) 穿透
Write-Host "[Serveo] 正在啟動 Web 網頁伺服器 (埠 8000) 穿透 (要求固定子網域: aiot-web-ian05012)..."
$webProcessInfo = New-Object System.Diagnostics.ProcessStartInfo
$webProcessInfo.FileName = "ssh"
$webProcessInfo.Arguments = "-o StrictHostKeyChecking=no -R aiot-web-ian05012:80:localhost:8000 serveo.net"
$webProcessInfo.RedirectStandardOutput = $true
$webProcessInfo.UseShellExecute = $false
$webProcessInfo.CreateNoWindow = $true

$webProcess = New-Object System.Diagnostics.Process
$webProcess.StartInfo = $webProcessInfo
$webProcess.Start() | Out-Null

$webUrl = ""
$startTime = Get-Date
while ($webProcess.StandardOutput.EndOfStream -eq $false) {
    $line = $webProcess.StandardOutput.ReadLine()
    Write-Host "[Web Log] $line"
    if ($line -match "Forwarding HTTP traffic from (https://[a-zA-Z0-9\-\.]+)") {
        $webUrl = $Matches[1]
        break
    }
    # 逾時判定 (30秒)
    if (((Get-Date) - $startTime).TotalSeconds -gt 30) {
        Write-Host "[Error] 啟動 Web 穿透逾時！"
        break
    }
}

if ($webUrl -ne "") {
    Write-Host "`n======================================================="
    Write-Host "🎉 線上 Demo 啟動成功！"
    Write-Host "👉 網頁端公開展示網址: $webUrl"
    Write-Host "👉 WebSocket 公開網址 : $wssUrl"
    Write-Host "======================================================="
} else {
    Write-Host "[Warning] 未能取得 Web 固定子網域，可能已被佔用。嘗試隨機網域..."
    # 備用：啟動隨機網域
    $webProcess2Info = New-Object System.Diagnostics.ProcessStartInfo
    $webProcess2Info.FileName = "ssh"
    $webProcess2Info.Arguments = "-o StrictHostKeyChecking=no -R 80:localhost:8000 serveo.net"
    $webProcess2Info.RedirectStandardOutput = $true
    $webProcess2Info.UseShellExecute = $false
    $webProcess2Info.CreateNoWindow = $true

    $webProcess2 = New-Object System.Diagnostics.Process
    $webProcess2.StartInfo = $webProcess2Info
    $webProcess2.Start() | Out-Null
    
    while ($webProcess2.StandardOutput.EndOfStream -eq $false) {
        $line = $webProcess2.StandardOutput.ReadLine()
        Write-Host "[Web Log Backup] $line"
        if ($line -match "Forwarding HTTP traffic from (https://[a-zA-Z0-9\-\.]+)") {
            $webUrl = $Matches[1]
            break
        }
    }
    Write-Host "`n======================================================="
    Write-Host "🎉 線上 Demo 啟動成功 (使用隨機網域)！"
    Write-Host "👉 網頁端公開展示網址: $webUrl"
    Write-Host "👉 WebSocket 公開網址 : $wssUrl"
    Write-Host "======================================================="
}

# 保持腳本運行，以便維護背景的 ssh 進程
try {
    while ($true) {
        Start-Sleep -Seconds 2
    }
} finally {
    # 腳本結束時自動終止子進程
    Write-Host "[Serveo] 正在關閉穿透進程..."
    $wsProcess.Kill()
    if ($webProcess) { $webProcess.Kill() }
    if ($webProcess2) { $webProcess2.Kill() }
}
