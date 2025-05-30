<#
.SYNOPSIS
  Removes all XML sections from an Ivanti ISM *.MetadataPatch file whose <… Seq="###"> value
  matches any “seq = ###” error lines in an import-result log.

.PARAMETER PatchFile
  Path to the original *.MetadataPatch file.

.PARAMETER ErrorFile
  Path to the log / text file that contains lines such as:
      Error during metadata commit operation for seq = 32281

.PARAMETER OutputFile
  (Optional) Path for the cleaned patch file.  
  Defaults to "<original-name>.cleaned.MetadataPatch" in the same folder.

.EXAMPLE
  .\Clean-MetadataPatch.ps1 -PatchFile 'C:\Temp\Package.MetadataPatch' `
                            -ErrorFile 'C:\Temp\ImportResult.txt'
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory)] [string] $PatchFile,
    [Parameter(Mandatory)] [string] $ErrorFile,
    [string] $OutputFile
)

#--- 1. Validate & set defaults ----------------------------------------------
if (-not (Test-Path $PatchFile)) { throw "Patch file not found: $PatchFile" }
if (-not (Test-Path $ErrorFile)) { throw "Error file not found: $ErrorFile" }

if (-not $OutputFile) {
    $OutputFile = [IO.Path]::ChangeExtension($PatchFile, '.cleaned.MetadataPatch')
}

Write-Host "Patch   : $PatchFile"
Write-Host "Errors  : $ErrorFile"
Write-Host "Output  : $OutputFile"
Write-Host

#--- 2. Collect the Seq numbers mentioned in the error log --------------------
Write-Host "Parsing error log for Seq numbers…"
$seqNumbers = Select-String -Path $ErrorFile -Pattern 'seq\s*=\s*(\d+)' -AllMatches |
              ForEach-Object { $_.Matches } |
              ForEach-Object { $_.Groups[1].Value } |
              Sort-Object -Unique

$seqHash = @{}
foreach ($seq in $seqNumbers) { $seqHash[$seq] = $true }

Write-Host ("  Found {0:N0} unique Seq IDs to remove." -f $seqHash.Count)

#--- 3. Load the XML patch ----------------------------------------------------
Write-Host "Loading XML patch (this can take a few seconds) …"
[xml]$xml = Get-Content $PatchFile -Raw

#--- 4. Find every node with a Seq attribute that matches an error -----------
$nodesToRemove = @()
$xml.SelectNodes('//*[@Seq]') | ForEach-Object {
    if ($seqHash.ContainsKey($_.Seq)) { $nodesToRemove += $_ }
}

Write-Host ("  Matched {0:N0} nodes for deletion." -f $nodesToRemove.Count)

#--- 5. Remove matched nodes --------------------------------------------------
foreach ($node in $nodesToRemove) {
    $null = $node.ParentNode.RemoveChild($node)
}

#--- 6. Save the cleaned file -------------------------------------------------
$xml.Save($OutputFile)
Write-Host "Done!  Cleaned file saved to: $OutputFile"
