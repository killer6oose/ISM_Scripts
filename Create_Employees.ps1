################################################
# Author: Andrew Hatton                        #
# Contact Me: https://cronotech.us/contact     #
################################################
#
# Update Line 114 to decide on how many employees to create, defaulting to 2.
# Variables for Ivanti ISM connection
# Use your base url such as 'https://my-tenant.ivanticloud.com/api/odata/businessobject' do NOT include a trailing /
# If you are ON-PREM be sure to add '/HEAT' between URL and '/api'
$ismUrl = "{YOUR TENANT URL HERE}" 

# Replace with the actual business object name. Ensure you have an 's' on the end. if the business object already ends with an 's' you'll need to add an extra one such as "Incident" becomes "Incidents"
$ismBO = "employees"

# Replace with your actual API token. Ivanti tokens are formatted like "rest_api_key=123456789abcdefghijklmnop"
$ismApiKey = "{YOUR API KEY HERE}"

# Headers for API requests
$ismHeaders = @{
    "Authorization" = "$ismApiKey"
    "Content-Type" = "application/json"
}

# Random data options
$departments = @("Healthcare IT", "Corporate Marketing", "Health and Safety", "Healthcare Finance", "Corporate Purchasing", "Corporate Sales", "Healthcare Admissions", "Healthcare Purchasing", "Healthcare HR", "Healthcare Medical Services", "Corporate IT", "Corporate Customer Service", "Accounting", "Corporate Services and Training", "Patient Services", "Administration", "Corporate Legal", "Corporate Facilities", "Pharmaceutical Services", "Healthcare Facilities", "Corporate HR", "Healthcare Clinical Services", "Corporate Finance", "Executive")
$teams = @("Change Management", "Corporate Audit", "Recruitment", "IT", "Telecommunications Support", "IT Project Management", "Server Support", "Network Administration", "Operations", "Product Marketing", "QA", "Healthcare Benefits", "Service Desk", "Field Sales", "Contracts", "Network Support", "HR", "Emergency Room", "Telephone - Public", "Facilities - Custodial", "Application Development", "Billing Services", "Orthopedic", "Management", "HR Operations")
$titles = @("Facilities Engineer", "Change Manager", "IT Manager", "Change Coordinator", "Product Manager", "Customer Service Rep", "Associate Technician", "Problem Manager", "Tech Support Supervisor", "Administrator", "Jr. Consultant")

# Lists to keep track of unique login IDs and emails
$usedLogins = @{}
$usedEmails = @{}

# Helper functions for generating random data
function Get-RandomAddress {
    $streetNumbers = Get-Random -Minimum 100 -Maximum 9999
    $streets = @("Elm St", "Maple Ave", "Oak Dr", "Pine St", "Main St", "Cedar Rd", "Willow Ave", "Broadway", "Sunset Blvd", "Park Ln")
    $cities = @("New York", "Los Angeles", "Chicago", "Houston", "Phoenix", "San Antonio", "San Diego", "Dallas", "San Jose", "Austin")
    $states = @{
        "NY" = "New York"
        "CA" = "California"
        "IL" = "Illinois"
        "TX" = "Texas"
        "AZ" = "Arizona"
    }
    $stateAbbrev = $states.Keys | Get-Random
    $zip = Get-Random -Minimum 10000 -Maximum 99999

    return @{
        "Address1" = "$streetNumbers $($streets | Get-Random)"
        "City" = $cities | Get-Random
        "State" = $stateAbbrev
        "Country" = "USA"
        "Zip" = "$zip"
    }
}

function Get-RandomName {
    $firstNames = @("John", "Jane", "Alex", "Emily", "Chris", "Sarah", "Michael", "Linda", "Robert", "Karen")
    $lastNames = @("Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis", "Rodriguez", "Martinez")
    $firstName = $firstNames | Get-Random
    $lastName = $lastNames | Get-Random
    return @{
        "FirstName" = $firstName
        "LastName" = $lastName
    }
}

function GenerateUniqueLogin {
    param (
        [string]$firstName,
        [string]$lastName
    )

    $baseLogin = "$firstName.$lastName".ToLower()
    $login = $baseLogin
    $index = 1
    while ($usedLogins.ContainsKey($login)) {
        $login = "$baseLogin$index"
        $index++
    }
    $usedLogins[$login] = $true
    return $login
}

function GenerateUniqueEmail {
    param (
        [string]$firstName,
        [string]$lastName
    )

    $baseEmail = "$firstName.$lastName@random.com".ToLower()
    $email = $baseEmail
    $index = 1
    while ($usedEmails.ContainsKey($email)) {
        $email = "$firstName.$lastName$index@random.com".ToLower()
        $index++
    }
    $usedEmails[$email] = $true
    return $email
}

function Get-RandomPhone {
    $areaCode = Get-Random -Minimum 200 -Maximum 999
    $firstPart = Get-Random -Minimum 100 -Maximum 999
    $secondPart = Get-Random -Minimum 1000 -Maximum 9999
    return "+1 ($areaCode) $firstPart-$secondPart"
}

function Get-RandomBoolean {
    return (Get-Random -Minimum 0 -Maximum 2) -eq 1
}

# Generate and POST records
for ($i = 0; $i -lt 2; $i++) {  # Change the loop count here to adjust the number of records created
    $address = Get-RandomAddress
    $name = Get-RandomName
    $loginId = GenerateUniqueLogin -firstName $name["FirstName"] -lastName $name["LastName"]
    $email = GenerateUniqueEmail -firstName $name["FirstName"] -lastName $name["LastName"]
    $title = $titles | Get-Random
    # will decide if they should have a 'VIP' checkmark or not based on title
    $isVip = $title -like "*Manager" -or $title -like "*Officer"

    $postData = @{
        "Address1"              = $address["Address1"]
        "Address1City"          = $address["City"]
        "Address1Country"       = $address["Country"]
        "Address1State"         = $address["State"]
        "Address1Zip"           = $address["Zip"]
        "CreationMethod"        = "Manually Created"
        "Department"            = $departments | Get-Random
        "EmployeeLocation"      = "USA"
        "FirstName"             = $name["FirstName"]
        "LastName"              = $name["LastName"]
        "ManagerLink"           = "1087342EA6954D7D96140D64B452E597"
        "LoginID"               = $loginId
        "PrimaryPhone"          = Get-RandomPhone
        "Phone1"                = Get-RandomPhone
        "PrimaryEmail"          = $email
        "Status"                = "Active"
        "Team"                  = $teams | Get-Random
        "Title"                 = $title
        "VIP"                   = $isVip
    }

    $jsonPayload = $postData | ConvertTo-Json -Depth 4

    try {
        $response = Invoke-RestMethod -Uri "$ismUrl/$ismBO" -Headers $ismHeaders -Method Post -Body $jsonPayload
        Write-Host "Record $($i + 1) created successfully for $($name["FirstName"]) $($name["LastName"]) with email $email and login $loginId"
    }
    catch {
        Write-Host "Failed to create record $($i + 1): $_"
    }
}

