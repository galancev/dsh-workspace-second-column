# Запуск tools/asar.mjs в ASAR-aware runtime установленного DSH.
# Пример: powershell -File tools/asar.ps1 ls pkg:dsh-client-ui-sidebar
param([Parameter(ValueFromRemainingArguments = $true)][string[]]$CommandArgs)

[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$start = [System.Diagnostics.ProcessStartInfo]::new($env:DSH_NODE_EXECUTABLE)
$start.ArgumentList.Add((Join-Path $PSScriptRoot "asar.mjs"))
foreach ($argument in $CommandArgs) { $start.ArgumentList.Add($argument) }
$start.Environment['ELECTRON_RUN_AS_NODE'] = '1'
$start.UseShellExecute = $false
$start.RedirectStandardOutput = $true
$start.RedirectStandardError = $true
$start.StandardOutputEncoding = [System.Text.Encoding]::UTF8
$start.StandardErrorEncoding = [System.Text.Encoding]::UTF8
$process = [System.Diagnostics.Process]::Start($start)
$stderr = $process.StandardError.ReadToEndAsync()
$stdout = $process.StandardOutput.ReadToEnd()
$process.WaitForExit()
[Console]::Out.Write($stdout)
$err = $stderr.Result
if ($err -and $err -notmatch 'crashpad') { [Console]::Error.Write($err) }
exit $process.ExitCode
