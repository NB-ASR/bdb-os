param(
    [int]$Port = 8080,
    [switch]$NoBrowser
)

$root = (Resolve-Path $PSScriptRoot).Path
$server = $null
$statePath = Join-Path $root '.vanita-stock-server.json'

$mimeTypes = @{
    '.css' = 'text/css; charset=utf-8'
    '.html' = 'text/html; charset=utf-8'
    '.ico' = 'image/x-icon'
    '.js' = 'text/javascript; charset=utf-8'
    '.json' = 'application/json; charset=utf-8'
    '.svg' = 'image/svg+xml'
    '.webmanifest' = 'application/manifest+json; charset=utf-8'
}

function Send-Response {
    param(
        [System.IO.Stream]$Stream,
        [int]$StatusCode,
        [string]$StatusText,
        [string]$ContentType,
        [byte[]]$Body,
        [bool]$IncludeBody = $true
    )

    $headers = "HTTP/1.1 $StatusCode $StatusText`r`nContent-Type: $ContentType`r`nContent-Length: $($Body.Length)`r`nConnection: close`r`nCache-Control: no-cache`r`n`r`n"
    $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($headers)
    $Stream.Write($headerBytes, 0, $headerBytes.Length)
    if ($IncludeBody -and $Body.Length -gt 0) {
        $Stream.Write($Body, 0, $Body.Length)
    }
    $Stream.Flush()
}

try {
    $server = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
    try { $server.Start() }
    catch { throw "Vanita Stock is already running, or another app is using port $Port. Close Vanita Stock first, then try again." }

    Write-Host "Vanita Stock is ready at http://localhost:$Port" -ForegroundColor Green
    Write-Host 'Keep this window open while using the app. Press Ctrl+C to stop it.' -ForegroundColor Yellow
    [pscustomobject]@{ pid = $PID; port = $Port } | ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding UTF8
    if (-not $NoBrowser) {
        Start-Process "http://localhost:$Port"
    }

    while ($true) {
        $client = $server.AcceptTcpClient()
        try {
            $stream = $client.GetStream()
            $reader = [System.IO.StreamReader]::new($stream, [System.Text.Encoding]::ASCII, $false, 1024, $true)
            $requestLine = $reader.ReadLine()
            if ([string]::IsNullOrWhiteSpace($requestLine)) { continue }

            do { $headerLine = $reader.ReadLine() } while (-not [string]::IsNullOrEmpty($headerLine))
            $parts = $requestLine.Split(' ')
            $method = $parts[0]
            if ($parts.Length -lt 2 -or ($method -ne 'GET' -and $method -ne 'HEAD')) {
                $body = [System.Text.Encoding]::UTF8.GetBytes('Method not allowed')
                Send-Response -Stream $stream -StatusCode 405 -StatusText 'Method Not Allowed' -ContentType 'text/plain; charset=utf-8' -Body $body
                continue
            }

            $url = [System.Uri]::new("http://localhost$($parts[1])")
            $requestPath = [System.Uri]::UnescapeDataString($url.AbsolutePath.TrimStart('/'))
            if ([string]::IsNullOrWhiteSpace($requestPath)) { $requestPath = 'index.html' }
            $candidate = [System.IO.Path]::GetFullPath((Join-Path $root $requestPath))

            if (-not $candidate.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path -LiteralPath $candidate -PathType Leaf)) {
                $body = [System.Text.Encoding]::UTF8.GetBytes('Not found')
                Send-Response -Stream $stream -StatusCode 404 -StatusText 'Not Found' -ContentType 'text/plain; charset=utf-8' -Body $body -IncludeBody ($method -eq 'GET')
                continue
            }

            $extension = [System.IO.Path]::GetExtension($candidate).ToLowerInvariant()
            $contentType = if ($mimeTypes.ContainsKey($extension)) { $mimeTypes[$extension] } else { 'application/octet-stream' }
            $body = [System.IO.File]::ReadAllBytes($candidate)
            Send-Response -Stream $stream -StatusCode 200 -StatusText 'OK' -ContentType $contentType -Body $body -IncludeBody ($method -eq 'GET')
        }
        catch {
            Write-Warning $_.Exception.Message
        }
        finally {
            if ($reader) { $reader.Dispose() }
            if ($stream) { $stream.Dispose() }
            $client.Close()
        }
    }
}
finally {
    if ($server) { $server.Stop() }
    Remove-Item -LiteralPath $statePath -Force -ErrorAction SilentlyContinue
}
