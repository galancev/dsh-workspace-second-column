# Запуск Node-скрипта или флагов Node в bundled runtime DSH (Electron в режиме Node).
# GUI-subsystem Electron не дожидается через `&`, поэтому запускаем через
# ProcessStartInfo с перенаправленным выводом.
#
# Примеры:
#   powershell -File tools/node.ps1 .verify/check-token.mjs "http://127.0.0.1:52011/?token=..."
#   powershell -File tools/node.ps1 --test --test-isolation=none "test/*.test.mjs"
param([Parameter(ValueFromRemainingArguments = $true)][string[]]$CommandArgs)

[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$start = [System.Diagnostics.ProcessStartInfo]::new($env:DSH_NODE_EXECUTABLE)
if ($CommandArgs.Count -gt 0 -and $CommandArgs[0].StartsWith("-")) {
  foreach ($argument in $CommandArgs) { $start.ArgumentList.Add($argument) }
} else {
  $start.ArgumentList.Add((Resolve-Path $CommandArgs[0]))
  foreach ($argument in $CommandArgs[1..($CommandArgs.Count - 1)]) {
    if ($null -ne $argument) { $start.ArgumentList.Add($argument) }
  }
}
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
