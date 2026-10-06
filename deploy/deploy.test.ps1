# Tests for deploy.ps1's input gates, the same cases as deploy.test.sh: pwsh deploy/deploy.test.ps1
# (or Windows PowerShell 5.1). Needs no Docker. Exits 1 on any failure.
$ErrorActionPreference = 'Stop'
$script = Join-Path $PSScriptRoot 'deploy.ps1'

# The validators, lifted out of deploy.ps1 so they run without its main.
$ast = [System.Management.Automation.Language.Parser]::ParseFile($script, [ref]$null, [ref]$null)
$wanted = 'Test-IPv4', 'Test-IPv6', 'Test-Address', 'Test-TrustProxy', 'Test-SshHost', 'Get-EnvValue', 'Get-WebPortSetting', 'Test-GatewayExposed'
foreach ($fn in $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $wanted -contains $n.Name }, $true)) {
    . ([scriptblock]::Create($fn.Extent.Text))
}

$fails = 0
function Expect([bool]$Got, [bool]$Want, [string]$What) {
    if ($Got -ne $Want) { Write-Output "FAIL $What"; $script:fails++ }
}

foreach ($v in '', '10.0.0.5', '172.22.0.0/16', '10.0.0.5, 10.0.0.6', 'gateway', 'gateway,10.0.0.5', '2001:db8::/32', 'fd00::1', '::ffff:10.0.0.5') {
    Expect (Test-TrustProxy $v) $true "TRUST_PROXY '$v' refused"
}
foreach ($v in '0.0.0.0/0', '1.2.3.4/00', '0.0.0.0/000', '::/0', '::/00', '::/000', '10.0.0.5,::/00', '1.2.3.4/33', '::/129', '256.1.1.1', 'caddy',
    '1.2.3.4;', '*', '/*', ':', "10.0.0.5`n10.0.0.6", "10.0.0.5`nADMIN_TOKEN=x", "10.0.0.5`n") {
    Expect (Test-TrustProxy $v) $false "TRUST_PROXY '$v' accepted"
}

foreach ($v in 'admin@10.0.0.5', 'admin@server.district.org', 'server', 'deploy_user@fd00::1') {
    Expect (Test-SshHost $v) $true "host '$v' refused"
}
foreach ($v in '-oProxyCommand=id', '-oProxyCommand=touch /tmp/x', '-p2222', 'admin@server -oX', "a`nb", 'a;id', '$(id)', '') {
    Expect (Test-SshHost $v) $false "host '$v' accepted"
}

# TRUST_PROXY=gateway is only safe with web published on the loopback address (deploy.test.sh says why).
$O = @{ WebPort = '' }
$EnvPath = Join-Path ([System.IO.Path]::GetTempPath()) "deploy-test-$PID.env"
function Read-Lines([string]$Path) { if (Test-Path -LiteralPath $Path) { return Get-Content -LiteralPath $Path } else { return @() } }
function Exposed([string]$WebPort, [string]$TrustProxy) {
    Set-Content -LiteralPath $EnvPath -Value @("WEB_PORT=$WebPort", "TRUST_PROXY=$TrustProxy")
    return Test-GatewayExposed
}
try {
    Expect (Exposed '80' 'gateway') $true 'gateway on port 80 (all addresses) not flagged'
    Expect (Exposed '0.0.0.0:8080' '10.0.0.5, gateway') $true 'gateway on 0.0.0.0:8080 not flagged'
    Expect (Exposed '[::]:8080' 'gateway') $true 'gateway on [::]:8080 not flagged'
    Expect (Exposed '127.0.0.1:8080' 'gateway') $false 'gateway on 127.0.0.1:8080 flagged'
    Expect (Exposed '[::1]:8080' 'gateway') $false 'gateway on [::1]:8080 flagged'
    Expect (Exposed '80' '10.0.0.5') $false "a remote proxy's address on port 80 flagged"
    Expect (Exposed '80' '') $false 'empty TRUST_PROXY flagged'
}
finally { Remove-Item -LiteralPath $EnvPath -ErrorAction SilentlyContinue }

if ($fails -eq 0) { Write-Output 'deploy.test.ps1: all passed' } else { Write-Output "deploy.test.ps1: $fails failed"; exit 1 }
