################################################
# Author: Andrew Hatton                        #
# Contact Me: https://cronotech.us/contact     #
################################################
# This script will pull the number of users set on line 13 from the CTECH API and generate Employee records in ISM for them
# Variables for Ivanti ISM connection
$ismUrl = "{YOUR TENANT URL HERE}/api/odata/businessobject"  # Your Ivanti ISM tenant URL
$ismBO = "employees"  # Business Object name for employees in Ivanti
$ismApiKey = "{YOUR API KEY HERE}"  # API Key for ISM in the format of "rest_api_key=123abc456def789ghi"

# Variables for CronoTech API
$userdataEndpoint = "https://api.cronotech.us/api/userdata"  # CronoTech API endpoint for user data
$numUsersToCreate = 10  # Specify how many users to create from the CronoTech API response

# Headers for API requests
$ismHeaders = @{
    "Authorization" = "$ismApiKey"
    "Content-Type" = "application/json"
}

# Teams and Titles for random selection
$teams = @("Change Management", "Corporate Audit", "Recruitment", "IT", "Telecommunications Support", "IT Project Management", "Server Support", "Network Administration", "Operations", "Product Marketing", "QA", "Healthcare Benefits", "Service Desk", "Field Sales", "Contracts", "Network Support", "HR", "Emergency Room", "Telephone - Public", "Facilities - Custodial", "Application Development", "Billing Services", "Orthopedic", "Management", "HR Operations")
$titles = @("Facilities Engineer", "Change Manager", "IT Manager", "Change Coordinator", "Product Manager", "Customer Service Rep", "Associate Technician", "Problem Manager", "Tech Support Supervisor", "Administrator", "Jr. Consultant")

# Helper functions for generating random data
function Get-RandomTitleAndVIPStatus {
    $title = $titles | Get-Random
    $isVip = $title -like "*Manager" -or $title -like "*Officer"
    return @{
        "Title" = $title
        "VIP" = $isVip
    }
}

# Function to parse full name into first and last names
function Parse-Name {
    param (
        [string]$fullName
    )

    $nameParts = $fullName -split ' '
    return @{
        "FirstName" = $nameParts[0]
        "LastName" = $nameParts[-1]
    }
}

# Function to parse address string
function Parse-Address {
    param (
        [string]$addressString
    )

    # Regular expression to match "Street Address, City, State Zip"
    if ($addressString -match "^(.*?),\s*(.*?),\s*([A-Z]{2})\s*(\d{5})$") {
        return @{
            "Address1" = $matches[1]
            "City" = $matches[2]
            "State" = $matches[3]
            "Zip" = $matches[4]
            "Country" = "USA"  # Assuming all addresses are within the USA
        }
    }
    else {
        Write-Host "Address format not recognized for: $addressString"
        return @{
            "Address1" = ""
            "City" = ""
            "State" = ""
            "Zip" = ""
            "Country" = "USA"
        }
    }
}

# GET request to retrieve user data from the CronoTech API
try {
    $userResponse = Invoke-RestMethod -Uri $userdataEndpoint -Headers @{ "Content-Type" = "application/json" } -Method Get
    $users = $userResponse | Select-Object -First $numUsersToCreate  # Limit the number of users based on the variable
    if ($users.Count -eq 0) {
        Write-Host "No users found at $userdataEndpoint"
        return
    }
}
catch {
    Write-Host "Failed to retrieve users from $userdataEndpoint : $_"
    return
}

# POST each user as a new employee
foreach ($user in $users) {
    $name = Parse-Name -fullName $user.fullName
    $titleInfo = Get-RandomTitleAndVIPStatus
    $address = Parse-Address -addressString $user.userAddress
    $randomTeam = $teams | Get-Random

    $postData = @{
        "Address1"              = $address["Address1"]
        "Address1City"          = $address["City"]
        "Address1Country"       = $address["Country"]
        "Address1State"         = $address["State"]
        "Address1Zip"           = $address["Zip"]
        "CreationMethod"        = "API Script"
        "Department"            = "Default Department"
        "EmployeeLocation"      = $address["Country"]
        "FirstName"             = $name["FirstName"]
        "LastName"              = $name["LastName"]
        "LoginID"               = "$($name["FirstName"]).$($name["LastName"])".ToLower()
        "PrimaryPhone"          = $user.userPhone
        "Phone1"                = $user.userPhone
        "PrimaryEmail"          = $user.userEmail
        "Status"                = "Active"
        "Team"                  = $randomTeam
        "Title"                 = $titleInfo["Title"]
        "VIP"                   = $titleInfo["VIP"]
    }

    $jsonPayload = $postData | ConvertTo-Json -Depth 4

    try {
        $response = Invoke-RestMethod -Uri "$ismUrl/$ismBO" -Headers $ismHeaders -Method Post -Body $jsonPayload
        Write-Host "Employee created successfully for $($user.fullName) with email $($user.userEmail)"
    }
    catch {
        Write-Host "Failed to create employee for $($user.fullName): $_"
    }
}
