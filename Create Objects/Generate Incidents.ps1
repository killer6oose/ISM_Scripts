################################################
# Author: Andrew Hatton                        #
# Contact Me: https://cronotech.us/contact     #
################################################
#
# Variables for Ivanti ISM connection
# Update line 75 to control how many incidents are created, default is 5
# Use your base url such as 'https://my-tenant.ivanticloud.com/api/odata/businessobject' do NOT include a trailing /
# If you are ON-PREM be sure to add '/HEAT' between URL and '/api'
$ismUrl = "{YOUR TENANT URL HERE}/api/odata/businessobject" 

# Replace with the actual business object name. Ensure you have an 's' on the end. if the business object already ends with an 's' you'll need to add an extra one such as "Incident" becomes "Incidents"
$empObj = "employees"
$incObj = "incidents"

# Replace with your actual API token. Ivanti tokens are formatted like "rest_api_key=123456789abcdefghijklmnop"
$ismApiKey = "{YOUR API KEY HERE}"

# Headers for API requests
$ismHeaders = @{
    "Authorization" = "$ismApiKey"
    "Content-Type" = "application/json"
}

# Teams from previous script for random selection
$teams = @("Change Management", "Corporate Audit", "Recruitment", "IT", "Telecommunications Support", "IT Project Management", "Server Support", "Network Administration", "Operations", "Product Marketing", "QA", "Healthcare Benefits", "Service Desk", "Field Sales", "Contracts", "Network Support", "HR", "Emergency Room", "Telephone - Public", "Facilities - Custodial", "Application Development", "Billing Services", "Orthopedic", "Management", "HR Operations")

# Helper functions for generating random data
function Get-RandomImpactOrUrgency {
    return @("Low", "Medium", "High") | Get-Random
}

function Get-RandomSubject {
    $subjects = @(
        "System outage in department", "Login issues reported by users",
        "Performance degradation in network", "Unauthorized access alert",
        "Scheduled maintenance notification", "Software update required",
        "Server restart needed", "Password reset request",
        "Data recovery operation", "Account suspension"
    )
    return $subjects | Get-Random
}

function Get-RandomSymptom {
    $symptoms = @(
        "The system is intermittently slow and affecting productivity.",
        "Users are unable to log in and receiving error codes.",
        "Network performance is degraded due to unknown issues.",
        "An unauthorized access attempt was flagged by security.",
        "Maintenance scheduled for servers to improve performance.",
        "A software update is pending and needs immediate attention.",
        "Server requires a restart to apply recent configuration.",
        "Password reset needed as user is locked out.",
        "Recovery operation requested for lost files.",
        "Suspension of account due to security breach detected."
    )
    return $symptoms | Get-Random
}

# GET request to retrieve all employees
try {
    $employeeResponse = Invoke-RestMethod -Uri $ismUrl/$empObj -Headers $ismHeaders -Method Get
    $employees = $employeeResponse.value
    if ($employees.Count -eq 0) {
        Write-Host "No employees found at $empObj"
        return
    }
}
catch {
    Write-Host "Failed to retrieve employees from /$empObj : $_"
    return
}

# Generate and POST random incidents
for ($i = 0; $i -lt 5; $i++) {  # Adjust the loop count here to control the number of incidents created
    $randomEmployee = $employees | Get-Random
    $randomTeam = $teams | Get-Random

    $incidentData = @{
        "ProfileLink_RecId"      = $randomEmployee.RecId
        "ProfileLink_Category"   = "Employee"
        "Category"               = "Demo Category"
        "Impact"                 = Get-RandomImpactOrUrgency
        "Urgency"                = Get-RandomImpactOrUrgency
        "Service"                = "Demo Service"
        "Source"                 = "Email"
        "Status"                 = "Closed"
        "Subject"                = Get-RandomSubject
        "Symptom"                = Get-RandomSymptom
        "OwnerTeam"              = $randomTeam
    }

    $jsonPayload = $incidentData | ConvertTo-Json -Depth 4

    try {
        $response = Invoke-RestMethod -Uri $ismUrl/$incObj -Headers $ismHeaders -Method Post -Body $jsonPayload
        Write-Host "Incident $($i + 1) created successfully for Employee RecId $($randomEmployee.RecId)"
    }
    catch {
        Write-Host "Failed to create incident $($i + 1): $_"
    }
}
