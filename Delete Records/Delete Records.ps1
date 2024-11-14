################################################
# Author: Andrew Hatton                        #
# Contact Me: https://cronotech.us/contact     #
################################################

# Variables for Ivanti ISM connection
$ismUrl = "{YOUR TENANT URL HERE}/api/odata/businessobject"  # Your Ivanti ISM tenant URL
$ismBO = "employees"  # Business Object name for employees in Ivanti
$ismApiKey = "{YOUR API KEY HERE}"  # API Key for Ivanti

# Variables for loop configuration
$recordsPerLoop = 25  # Number of records to delete per loop (no more than 25 is typically recommended)
$numLoops = 10        # Number of loops to perform (no more than 100 is typically recommended; consult Support for more)

# Headers for API requests
$ismHeaders = @{
    "Authorization" = "$ismApiKey"
    "Content-Type" = "application/json"
}

# Function to retrieve records to delete
function Get-RecordsToDelete {
    param (
        [int]$count
    )
    $queryUrl = "$ismUrl/$ismBO?$top=$count"
    try {
        $response = Invoke-RestMethod -Uri $queryUrl -Headers $ismHeaders -Method Get
        return $response.value
    }
    catch {
        Write-Host "Failed to retrieve records for deletion: $_"
        return $null
    }
}

# Function to delete a single record
function Delete-Record {
    param (
        [string]$recordId
    )
    $deleteUrl = "$ismUrl/$ismBO('$recordId')"
    try {
        Invoke-RestMethod -Uri $deleteUrl -Headers $ismHeaders -Method Delete
        Write-Host "Deleted record with RecId: $recordId"
    }
    catch {
        Write-Host "Failed to delete record with RecId $recordId : $_"
    }
}

# Loop to delete records
for ($loop = 1; $loop -le $numLoops; $loop++) {
    Write-Host "Starting loop $loop of $numLoops"

    # Retrieve a batch of records to delete
    $records = Get-RecordsToDelete -count $recordsPerLoop

    if ($records -and $records.Count -gt 0) {
        foreach ($record in $records) {
            $recordId = $record.RecId
            if ($recordId) {
                Delete-Record -recordId $recordId
            }
        }
    }
    else {
        Write-Host "No more records found for deletion in loop $loop."
        break  # Exit the loop if no records are left
    }
}

Write-Host "Deletion process completed. Thank you for using our script!"
Write-Host "If you would like to find other helpful tools, check out our GitHub: " -NoNewline
Write-Host "https://git.cronotech.us" -ForegroundColor Blue -Underline
