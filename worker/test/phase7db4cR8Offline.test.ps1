param(
  [string]$R7Path = 'C:\Users\sacoo\AppData\Local\Temp\phase7db3-executor-instrumented-frozen-20260905-r7.ps1',
  [string]$R8Path = 'C:\Users\sacoo\AppData\Local\Temp\phase7db3-executor-instrumented-frozen-20260905-r8.ps1'
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
function Check([bool]$Condition, [string]$Label) {
  if (-not $Condition) { throw "OFFLINE_TEST_FAILED: $Label" }
}
function Parse-Source([string]$Path) {
  $tokens = $null
  $errors = $null
  $ast = [Management.Automation.Language.Parser]::ParseFile($Path, [ref]$tokens, [ref]$errors)
  Check ($errors.Count -eq 0) 'parser'
  return $ast
}
function Functions($Ast) {
  $result = @{}
  foreach ($node in $Ast.FindAll({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst]}, $false)) {
    Check (-not $result.ContainsKey($node.Name)) 'unique functions'
    $result[$node.Name] = $node
  }
  return $result
}
function Calls($Ast, [string]$Name) {
  return ,@($Ast.FindAll({param($n)
    $n -is [Management.Automation.Language.CommandAst] -and $n.GetCommandName() -ceq $Name
  }.GetNewClosure(), $true))
}
function Must-Fail([scriptblock]$Action, [string]$Label) {
  $failed = $false
  try { & $Action } catch { $failed = $true }
  Check $failed $Label
}
$expectedR7 = '8D1537D45197B94295B5F72D462812BFEF8478D7C0B2F2479133B7F600129DE1'
Check ((Get-FileHash -LiteralPath $R7Path -Algorithm SHA256).Hash -ceq $expectedR7) 'frozen R7 hash'
$r7 = [IO.File]::ReadAllText($R7Path)
$r8 = [IO.File]::ReadAllText($R8Path)
$r7Ast = Parse-Source $R7Path
$r8Ast = Parse-Source $R8Path
$oldFunctions = Functions $r7Ast
$newFunctions = Functions $r8Ast
$writeNames = @('Invoke-Write1FinalizeA', 'Invoke-Write2PatchB', 'Invoke-Write3FinalizeB', 'Invoke-Write4PatchC', 'Invoke-Write5FinalizeC', 'Invoke-Write6FinalizeD', 'Invoke-Write7FinalizeE')
$writeLabels = @('FINALIZE_A', 'PATCH_B', 'FINALIZE_B', 'PATCH_C', 'FINALIZE_C', 'FINALIZE_D', 'FINALIZE_E')
$newNames = @('Test-WorkerTimestamp', 'Assert-WorkerTimestampWireValue', 'Assert-WorkerReportTimestamps', 'Assert-WriteHttpSuccess')
$changedNames = @('Assert-V1DraftWireShape', 'Get-ExecutionStopStatus') + $writeNames
Check ($newFunctions.Count -eq $oldFunctions.Count + $newNames.Count) 'function inventory'
foreach ($name in $newFunctions.Keys) {
  Check ($oldFunctions.ContainsKey($name) -or $name -cin $newNames) 'only scoped new functions'
}
foreach ($name in $oldFunctions.Keys) {
  Check ($newFunctions.ContainsKey($name)) 'no removed functions'
  if ($name -cnotin $changedNames) {
    Check ($newFunctions[$name].Extent.Text -ceq $oldFunctions[$name].Extent.Text) "unchanged function $name"
  }
}
for ($i = 0; $i -lt 7; $i++) {
  $name = $writeNames[$i]
  $body = $newFunctions[$name].Extent.Text
  $newAssertion = 'Assert-WriteHttpSuccess ' + ($i + 1) + ' $response.StatusCode'
  $oldAssertion = 'Assert-True ($response.StatusCode -eq 200) ''WRITE_' + ($i + 1) + '_' + $writeLabels[$i] + '_FAILED'''
  Check ($body.Contains($newAssertion)) 'diagnostic call at each write'
  Check ($body.Replace($newAssertion, $oldAssertion) -ceq $oldFunctions[$name].Extent.Text) 'business write body unchanged'
  Check ((Calls $newFunctions[$name] 'Invoke-WebRequest').Count -eq 1) 'one HTTP dispatch per write'
  Check ((Calls $newFunctions[$name] 'Complete-Write').Count -eq 1) 'completion ledger unchanged'
  Check ((Calls $newFunctions['Invoke-ControlledExecution'] $name).Count -eq 1) 'one ordered call per write'
  $loops = @($newFunctions[$name].FindAll({param($n)
    $n -is [Management.Automation.Language.LoopStatementAst]
  }, $true))
  Check ($loops.Count -eq 0) 'no per-write retry loop'
}
$businessCalls = @($newFunctions['Invoke-ControlledExecution'].FindAll({param($n)
  $n -is [Management.Automation.Language.CommandAst] -and $n.GetCommandName() -cmatch '^Invoke-Write'
}, $true) | ForEach-Object { $_.GetCommandName() })
Check (($businessCalls -join '|') -ceq ($writeNames -join '|')) 'exact seven-write order'
Check ((Calls $r8Ast 'Invoke-WebRequest').Count -eq (Calls $r7Ast 'Invoke-WebRequest').Count) 'no added HTTP dispatch'
Check ($r8 -notmatch '(?i)MaximumRetryCount|RetryIntervalSec') 'no HTTP retry options'

# Strip functions for an independent top-level diff; only status path and bounded code registration may differ.
function Top-LevelText([string]$Source, $Map) {
  foreach ($node in @($Map.Values | Sort-Object { $_.Extent.StartOffset } -Descending)) {
    $Source = $Source.Remove($node.Extent.StartOffset, $node.Extent.EndOffset - $node.Extent.StartOffset)
  }
  return $Source
}
$registration = @($r8Ast.EndBlock.Statements | Where-Object {
  $_ -is [Management.Automation.Language.ForEachStatementAst] -and $_.Variable.VariablePath.UserPath -ceq 'writeNumber'
})
Check ($registration.Count -eq 1) 'bounded diagnostic registration'
Check ($registration[0].Extent.Text -ceq @'
foreach ($writeNumber in 1..7) {
  foreach ($httpClass in @('400', '401', '403', '404', '409', '5XX', 'OTHER')) {
    [void]$script:AllowedExecutionStatusCodes.Add("WRITE_${writeNumber}_HTTP_$httpClass")
  }
}
'@) 'closed diagnostic allowlist'
$top8 = (Top-LevelText $r8 $newFunctions).Replace($registration[0].Extent.Text, '').Replace('status-20260905-r8.log', 'status-20260905-r7.log')
$top7 = Top-LevelText $r7 $oldFunctions
Check (($top8 -replace '\s+', ' ') -ceq ($top7 -replace '\s+', ' ')) 'top-level diff limited to status path and registration'
$oldTimestamp = @'
  foreach ($name in @('createdAt', 'updatedAt')) {
    $timestamp = Get-FieldString $Report $name
    $parsed = [DateTimeOffset]::MinValue
    Assert-True ($null -ne $timestamp -and [DateTimeOffset]::TryParse($timestamp, [ref]$parsed)) "REPORT_TIMESTAMP_INVALID_$name"
  }
'@
Check ($newFunctions['Assert-V1DraftWireShape'].Extent.Text.Replace('  Assert-WorkerReportTimestamps $Report', $oldTimestamp) -ceq $oldFunctions['Assert-V1DraftWireShape'].Extent.Text) 'preflight diff scope'
$stopAddition = @'
  if ($null -ne $SafeErrorCode -and $script:AllowedExecutionStatusCodes.Contains($SafeErrorCode) -and
      $SafeErrorCode -cmatch '\AWRITE_([1-7])_HTTP_(400|401|403|404|409|5XX|OTHER)\z') {
    return "EXECUTOR_STOP_WRITE_$($Matches[1])"
  }

'@
Check ($newFunctions['Get-ExecutionStopStatus'].Extent.Text.Replace($stopAddition + "`n", '') -ceq $oldFunctions['Get-ExecutionStopStatus'].Extent.Text) 'stop classification diff scope'
Write-Output 'PASS: R7 hash, R8 parser/AST, exact diff scope, seven unchanged writes, no retries'

# Load only audited pure helpers. Neither executor top-level nor any business/network/auth function is invoked.
$pure = @(
  'Assert-True', 'Has-Property', 'Get-PropertyValue', 'Get-FieldNames',
  'Get-FieldValueObject', 'Get-FieldString', 'Get-FieldArrayValues', 'Get-FieldArrayStrings',
  'Test-FieldNull', 'Assert-ExactSet', 'Assert-ValidParts', 'Assert-V1DraftWireShape',
  'Assert-ReportStructurallyFinalizable', 'Test-WorkerTimestamp', 'Assert-WorkerTimestampWireValue',
  'Assert-WorkerReportTimestamps', 'Assert-WriteHttpSuccess', 'Write-ExecutionStatus',
  'Get-ExecutionStopStatus', 'Get-ActivePrewriteStopStatus'
)
foreach ($name in $pure) {
  Check ((Calls $newFunctions[$name] 'Invoke-WebRequest').Count -eq 0) 'pure helper has no network'
  . ([scriptblock]::Create($newFunctions[$name].Extent.Text))
}
$script:AllowedServiceActions = @('repair', 'replace-part', 'replace-product', 'claim-factory', 'return-to-customer')
$script:AllowedResultStatuses = @('repaired', 'awaiting-part', 'sent-for-claim', 'replaced', 'returned', 'unable-to-repair')
$script:AllowedExecutionStatusCodes = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
$statusRegistration = @($r8Ast.EndBlock.Statements | Where-Object {
  $_ -is [Management.Automation.Language.ForEachStatementAst] -and $_.Variable.VariablePath.UserPath -ceq 'statusCode'
})
Check ($statusRegistration.Count -eq 1) 'original status allowlist present'
. ([scriptblock]::Create($statusRegistration[0].Extent.Text))
. ([scriptblock]::Create($registration[0].Extent.Text))
$script:GlobalPrewriteActive = $false
$script:LastExecutionStatus = $null
$script:ExecutionStatusInitialized = $true
$script:ExecutionStatusWriter = [IO.StringWriter]::new()
$script:ExecutionStatusWriter.NewLine = "`n"
for ($write = 1; $write -le 7; $write++) {
  foreach ($http in 100..599) {
    [void]$script:ExecutionStatusWriter.GetStringBuilder().Clear()
    if ($http -eq 200) {
      Assert-WriteHttpSuccess $write $http
      Check ($script:ExecutionStatusWriter.ToString() -ceq '') '200 emits no failure'
      continue
    }
    $class = if ($http -in @(400,401,403,404,409)) { [string]$http } elseif ($http -ge 500) { '5XX' } else { 'OTHER' }
    $expected = "WRITE_${write}_HTTP_$class"
    $caught = $null
    try { Assert-WriteHttpSuccess $write $http } catch { $caught = $_.Exception.Message }
    Check ($caught -ceq $expected) 'fixed exception code'
    Check ($script:ExecutionStatusWriter.ToString() -ceq ($expected + "`n")) 'fixed status code only'
    Check ((Get-ExecutionStopStatus $caught) -ceq "EXECUTOR_STOP_WRITE_$write") 'write stop classification preserved'
  }
}
foreach ($value in @($null, 'SECRET_SENTINEL', [pscustomobject]@{ Content = 'PRIVATE_BODY'; token = 'PRIVATE_TOKEN'; uid = 'PRIVATE_UID' })) {
  [void]$script:ExecutionStatusWriter.GetStringBuilder().Clear()
  Must-Fail { Assert-WriteHttpSuccess 1 $value } 'malformed HTTP class rejected'
  Check ($script:ExecutionStatusWriter.ToString() -ceq "WRITE_1_HTTP_OTHER`n") 'no private status material'
}
[void]$script:ExecutionStatusWriter.GetStringBuilder().Clear()
Must-Fail { Write-ExecutionStatus 'PRIVATE_TOKEN_OR_IDENTIFIER' } 'status writer rejects private strings'
Check ($script:ExecutionStatusWriter.ToString() -ceq '') 'privacy rejection writes nothing'
Must-Fail { Assert-WriteHttpSuccess 8 400 } 'no eighth diagnostic write'
$script:ExecutionStatusWriter.Dispose()
Write-Output 'PASS: 3,500 HTTP status cases, fixed privacy-safe codes, stop classification, no status file'

function New-Report {
  return ConvertFrom-Json -DateKind String -NoEnumerate @'
{"fields":{"id":{"stringValue":"offline-report"},"serviceJobId":{"stringValue":"offline-job"},"reportNo":{"stringValue":"FR-2026-000001"},"status":{"stringValue":"draft"},"createdAt":{"stringValue":"2026-08-17T15:04:53.988Z"},"updatedAt":{"timestampValue":"2026-08-17T15:07:54.201164Z"},"finalizedAt":{"nullValue":null},"technician":{"stringValue":"Offline"},"customerReportedProblem":{"stringValue":"Fault"},"inspectionFindings":{"stringValue":"Fault reproduced"},"serviceActions":{"arrayValue":{"values":[{"stringValue":"repair"}]}},"parts":{"arrayValue":{}},"technicianRemark":{"stringValue":""},"resultStatus":{"stringValue":"repaired"},"resultDetail":{"stringValue":""},"evidenceAttachmentIds":{"arrayValue":{}},"claimNo":{"nullValue":null},"factoryReference":{"nullValue":null},"snapshot":{"nullValue":null}}}
'@
}
$valid = @(
  '0001-01-01T00:00:00Z', '0099-12-31T23:59:59Z', '2000-02-29T00:00:00Z',
  '2024-02-29T00:00:00Z', '2026-09-05T07:00:00+07:00', '2026-09-05T00:00:00-23:59',
  '9999-12-31T23:59:59.999999999Z'
) + @(1..9 | ForEach-Object { '2026-09-05T00:00:00.' + ('1' * $_) + 'Z' })
foreach ($value in $valid) {
  Check (Test-WorkerTimestamp $value) 'valid Worker timestamp'
  $report = New-Report
  $report.fields.createdAt = [pscustomobject]@{ timestampValue = $value }
  $report.fields.updatedAt.timestampValue = $value
  Assert-ReportStructurallyFinalizable $report
}
Assert-ReportStructurallyFinalizable (New-Report)
$invalid = @(
  $null, 0, $true, '', '2026-09-05', '2026-09-05T00:00:00',
  '2026-02-29T00:00:00Z', '1900-02-29T00:00:00Z', '2026-04-31T00:00:00Z',
  '2026-00-01T00:00:00Z', '2026-13-01T00:00:00Z', '2026-01-00T00:00:00Z',
  '2026-01-01T24:00:00Z', '2026-01-01T00:60:00Z', '2026-01-01T00:00:60Z',
  '2026-01-01T00:00:00+24:00', '2026-01-01T00:00:00+00:60',
  '2026-01-01T00:00:00.1234567890Z', '0000-01-01T00:00:00Z',
  '0001-01-01T00:00:00+00:01', '9999-12-31T23:59:59-00:01',
  ' 2026-01-01T00:00:00Z', "2026-01-01T00:00:00Z`n"
)
foreach ($value in $invalid) {
  Check (-not (Test-WorkerTimestamp $value)) 'invalid Worker timestamp'
  foreach ($field in @('createdAt', 'updatedAt', 'finalizedAt')) {
    $report = New-Report
    $report.fields.$field = [pscustomobject]@{ timestampValue = $value }
    Must-Fail { Assert-V1DraftWireShape $report } 'malformed timestamp preflight'
  }
}
foreach ($value in @(
  [pscustomobject]@{ timestampValue = '2026-09-05T00:00:00Z'; nullValue = $null },
  [pscustomobject]@{ timestampValue = '2026-09-05T00:00:00Z'; stringValue = '2026-09-05T00:00:00Z' },
  [pscustomobject]@{ timestampValue = @() },
  [pscustomobject]@{ timestampValue = [pscustomobject]@{} }
)) {
  $report = New-Report
  $report.fields.updatedAt = $value
  Must-Fail { Assert-V1DraftWireShape $report } 'malformed timestamp union/type'
}
foreach ($value in @(
  [pscustomobject]@{ nullValue = 'NULL_VALUE' },
  [pscustomobject]@{ nullValue = $null; timestampValue = 'bad' },
  [pscustomobject]@{ timestampValue = '2026-09-05T00:00:00Z' }
)) {
  $report = New-Report
  $report.fields.finalizedAt = $value
  Must-Fail { Assert-V1DraftWireShape $report } 'draft finalizedAt exact null'
}
$report = New-Report
$nested = ConvertFrom-Json -DateKind String '{"mapValue":{"fields":{"array":{"arrayValue":{"values":[{"timestampValue":"2026-09-05T00:00:00.123456789Z"}]}}}}}'
$report.fields | Add-Member -NotePropertyName offlineNested -NotePropertyValue $nested
Assert-V1DraftWireShape $report
$nested.mapValue.fields.array.arrayValue.values[0].timestampValue = 'invalid'
Must-Fail { Assert-V1DraftWireShape $report } 'nested timestamp fail closed'
Write-Output 'PASS: A-style preflight, string/server timestamps, calendar/precision/range, malformed/nested/nullable timestamp guards'

$r8StatusPath = 'C:\Users\sacoo\AppData\Local\Temp\phase7db3-executor-instrumented-status-20260905-r8.log'
Check (-not (Test-Path -LiteralPath $r8StatusPath)) 'R8 status path absent'
Check ((Get-FileHash -LiteralPath $R7Path -Algorithm SHA256).Hash -ceq $expectedR7) 'R7 remains untouched'
Check ((Get-Item -LiteralPath $R8Path).IsReadOnly) 'R8 frozen read-only'
Write-Output 'PASS: R8 never executed; R8 status absent; R7 hash unchanged; R8 read-only'
