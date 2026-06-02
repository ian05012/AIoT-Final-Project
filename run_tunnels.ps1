# PowerShell script to automate Serveo tunnel setup
$PSScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
if ($PSScriptRoot) { Set-Location $PSScriptRoot }

Write-Host "[Serveo] Starting WebSocket tunnel on port 3000..."
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
while ($wsProcess.StandardOutput.EndOfStream -eq $false) {
    $line = $wsProcess.StandardOutput.ReadLine()
    Write-Host "[WS Log] $line"
    if ($line -match "Forwarding HTTP traffic from (https://[a-zA-Z0-9\-\.]+)") {
        $wsUrl = $Matches[1]
        break
    }
    if (((Get-Date) - $startTime).TotalSeconds -gt 30) {
        Write-Host "[Error] Timeout starting WebSocket tunnel!"
        break
    }
}

if ($wsUrl -ne "") {
    $wssUrl = $wsUrl.Replace("http://", "ws://").Replace("https://", "wss://")
    Write-Host "[Success] Got WebSocket URL: $wssUrl"
    
    $config = @{ ws_url = $wssUrl }
    $configJson = $config | ConvertTo-Json
    $configJson | Out-File -FilePath "public/config.json" -Encoding utf8
    Write-Host "[Success] Updated public/config.json"
} else {
    Write-Host "[Error] Failed to get URL from Serveo!"
    exit 1
}

Write-Host "[Serveo] Starting Web server tunnel on port 8000 (Subdomain: aiot-web-ian05012)..."
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
    if (((Get-Date) - $startTime).TotalSeconds -gt 30) {
        Write-Host "[Error] Timeout starting Web server tunnel!"
        break
    }
}

if ($webUrl -ne "") {
    Write-Host "`n======================================================="
    Write-Host "🎉 Online Demo Started Successfully!"
    Write-Host "👉 Public Web URL      : $webUrl"
    Write-Host "👉 Public WebSocket URL: $wssUrl"
    Write-Host "======================================================="
} else {
    Write-Host "[Warning] Failed to reserve fixed subdomain. Retrying with random subdomain..."
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
    Write-Host "🎉 Online Demo Started Successfully (Random Web Subdomain)!"
    Write-Host "👉 Public Web URL      : $webUrl"
    Write-Host "👉 Public WebSocket URL: $wssUrl"
    Write-Host "======================================================="
}

try {
    while ($true) {
        Start-Sleep -Seconds 2
    }
} finally {
    Write-Host "[Serveo] Shutting down tunnels..."
    $wsProcess.Kill()
    if ($webProcess) { $webProcess.Kill() }
    if ($webProcess2) { $webProcess2.Kill() }
}
