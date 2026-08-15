# ============================================================================
# mgr.ps1 - PowerShell wrapper to call mgr bash script on Win11
# Usage: .\mgr.ps1 status / .\mgr.ps1 push --pr / .\mgr.ps1 sync "feat(x): desc [agent]"
# Platform: Windows only (Linux/macOS run ./mgr directly)
# bash lookup: git-reverse -> registry -> PATH -> multi-drive fallback (no hardcode)
# ============================================================================
param([Parameter(ValueFromRemainingArguments=$true)][string[]]$RestArgs)

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$BashExe = $null

# Strategy 1: reverse from git.exe
$gitCmd = Get-Command git -ErrorAction SilentlyContinue
if ($gitCmd) {
    $rootDir = Split-Path -Parent (Split-Path -Parent $gitCmd.Source)
    $candidate = Join-Path $rootDir 'bin\bash.exe'
    if (Test-Path $candidate) { $BashExe = $candidate }
}

# Strategy 2: registry GitForWindows InstallPath
if (-not $BashExe) {
    $regKeys = @('HKLM:\SOFTWARE\GitForWindows','HKLM:\SOFTWARE\WOW6432Node\GitForWindows','HKCU:\SOFTWARE\GitForWindows')
    foreach ($key in $regKeys) {
        $item = Get-ItemProperty $key -Name InstallPath -ErrorAction SilentlyContinue
        if ($item -and $item.InstallPath) {
            $candidate = Join-Path $item.InstallPath 'bin\bash.exe'
            if (Test-Path $candidate) { $BashExe = $candidate; break }
        }
    }
}

# Strategy 3: bash in PATH
if (-not $BashExe) {
    $found = Get-Command bash -ErrorAction SilentlyContinue
    if ($found) { $BashExe = $found.Source }
}

# Strategy 4: multi-drive fallback
if (-not $BashExe) {
    $drives = 'C','D','E','F','G','H','I'
    foreach ($drive in $drives) {
        $p = $drive + ':\Program Files\Git\bin\bash.exe'
        if (Test-Path $p) { $BashExe = $p }
        $p2 = $drive + ':\Program Files (x86)\Git\bin\bash.exe'
        if (Test-Path $p2) { $BashExe = $p2 }
    }
}

if (-not $BashExe) {
    Write-Host '[ERROR] bash not found. Install Git for Windows or add bash to PATH.' -ForegroundColor Red
    exit 1
}

# Convert Windows path -> Unix path
$Drive = $ScriptDir.Substring(0,1).ToLower()
$PathPart = $ScriptDir.Substring(2).Replace('\\','/')
$UnixPath = '/' + $Drive + $PathPart

# Build arg string: single-quote each arg (bash ignores () inside single quotes)
# Escape single quotes: ' -> '\'' 
$ArgStr = ''
if ($RestArgs) {
    foreach ($a in $RestArgs) {
        $escaped = $a -replace "'", "'\\''"
        $ArgStr = $ArgStr + " '" + $escaped + "'"
    }
}

& $BashExe -c "cd '$UnixPath' && ./mgr$ArgStr"
