param(
    [string]$Pattern,
    [switch]$Stop
)
# Find node.exe processes whose command line contains $Pattern.
# Exit 0 if found (or after Stop), 1 if not found.
$found = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
    Where-Object { $_.CommandLine -and $_.CommandLine -like "*$Pattern*" })

if ($Stop) {
    foreach ($p in $found) {
        Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
    }
    exit 0
}
if ($found.Count -gt 0) { exit 0 } else { exit 1 }
