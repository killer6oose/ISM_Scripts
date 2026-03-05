// Author: Andrew Hatton
// Disclaimer: THIS CODE AND INFORMATION IS PROVIDED "AS IS" WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESSED OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE IMPLIED WARRANTIES OF MERCHANTABILITY AND/OR FITNESS FOR A PARTICULAR PURPOSE. IMPORTANT: Please take care when executing this script on a live database or system. It is recommended that a full backup is first performed.

// Requires the Graph API permission of `User.Read.All`

// Purpose: Pulls specified Entra AD attributes for the current Employee record using the user's Entra GUID (ID field),
// falling back to email search if the GUID lookup fails, then writes the returned values to the matching ISM fields.
// Please create or modify an existing Scheduled Entry or use another method to execute this script

// ============================================================
// LOGGING CONFIG
// Prevent or allow specific kinds of logs
// ============================================================
var Enable_Debug = false;
var Enable_Warn = false;

// ============================================================
// Custom Logging is disabled by default. To use this functionality
// - Create a new Logging object and place the object's name next to the
// `var Custom_Debug_Obj` including the # symbol
// - Create at least one field to hold the debug msg which contains the 
// Debug and Errors that occur after execution, by creating a record in this object
//
// If you would like to use my custom logging object I built, download it from
// 
// ============================================================

var Enable_Custom_Debug = false;
var Custom_Debug_Obj = 'ead_CustomLogging#';
var Custom_Debug_Fld = 'LogOutput';

// ============================================================
// ENTRA AD CONFIG
// ============================================================

// Your Entra tenant ID and a valid OAuth client credentials token endpoint
var ENTRA_TENANT_ID     = 'YOUR_TENANT_ID_HERE';
var ENTRA_CLIENT_ID     = 'YOUR_CLIENT_ID_HERE';
var ENTRA_CLIENT_SECRET = 'YOUR_CLIENT_SECRET_HERE';
var ENTRA_GRAPH_BASE    = 'https://graph.microsoft.com/v1.0/users/';

// Add or remove Entra attribute names here -- these are passed directly in the $select query param
// Use the exact Graph API property names (camelCase as Microsoft defines them)
// This sample pulls in the user's status, AccountExpiration, and CostCentre of the user
var eadAttributes = [
    'accountEnabled',
    'extension_c757c08fb08b44f09fecf998142a13f1_accountExpires',
    'extension_c757c08fb08b44f09fecf998142a13f1_costCenter'
];

// ============================================================
// FIELD MAPPING -- Entra attribute name -> ISM field name
// Add a pair here for every attribute in eadAttributes that
// does NOT share the exact same name as its ISM counterpart.
// If the names match perfectly, you don't need an entry here.
// Adding values here is needed for the comparison lines down
// below, where it looks to see if the responding field matches
// these specified variables and their values.
// ============================================================

// Entra source field names
// the prefix 'ead...' helps to understand this variable comes from EntraAD
var eadAccntExp   = 'extension_c757c08fb08b44f09fecf998142a13f1_accountExpires';
var eadCostCenter = 'extension_c757c08fb08b44f09fecf998142a13f1_costCenter';
// var eadAttributeNameHere = '{YOUR_CUSTOM_ATTRIBUTE}';

// ISM destination field names (the actual field names on the Employee# record)
var ismAccntExp   = 'AccountExpirationDate'; // This is NOT OOTB, created as a sample field in my tenant
var ismCostCenter = 'CostCentre';
//var ismOtherField = '{INTERNAL_FIELD_NAME}';

// ISM table ref and field names for the current record
var ISM_EMPLOYEE_TABLE = 'Employee#';
var ISM_GUID_FIELD     = 'AzureAD_ID';   // the Entra GUID stored on the ISM Employee record
var ISM_EMAIL_FIELD    = 'PrimaryEmail'; // fallback lookup field in case the user does not yet have an AzureAD_ID

// ============================================================
// LOGGING HELPERS
// ============================================================
var debugLog = '';

function log(message) {
    if (Enable_Debug) {
        console.debug(message);
    }
    if (Enable_Custom_Debug) {
        debugLog = debugLog + '\n' + message;
    }
}

function warn(message) {
    if (Enable_Warn) {
        console.warn(message);
    }
}

// ============================================================
// MAIN
// ============================================================
try {
    var currRecord = Get(ISM_EMPLOYEE_TABLE, '$(RecId)');
    if (!currRecord) {
        console.error('Could not retrieve the current Employee record.');
        throw new Error('Employee record not found for RecId $(RecId)');
    }

    var entraGuid = String(currRecord.Fields[ISM_GUID_FIELD]  || '');
    var userEmail = String(currRecord.Fields[ISM_EMAIL_FIELD] || '');

    log('Employee RecId: $(RecId) | Entra GUID: ' + entraGuid + ' | Email: ' + userEmail);

    // -- Step 1: get an OAuth token via client credentials --
    var tokenUrl = 'https://login.microsoftonline.com/' + ENTRA_TENANT_ID + '/oauth2/v2.0/token';
    var tokenBody = 'grant_type=client_credentials'
        + '&client_id='     + ENTRA_CLIENT_ID
        + '&client_secret=' + ENTRA_CLIENT_SECRET
        + '&scope=https%3A%2F%2Fgraph.microsoft.com%2F.default';

    log('Requesting Entra OAuth token...');
    var tokenResponse;
    try {
        tokenResponse = ExecuteWebRequest('POST', tokenUrl, tokenBody, {
            Headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });
        log('Token response StatusCode: ' + tokenResponse.StatusCode);
    } catch (eToken) {
        console.error('Token request threw an exception: ' + eToken.toString());
        if (Enable_Custom_Debug) { debugLog = debugLog + '\n[ERROR] Token request threw: ' + eToken.toString(); }
        throw eToken;
    }

    if (tokenResponse.StatusCode !== 200) {
        console.error('Token request failed. Status: ' + tokenResponse.StatusCode + ' Body: ' + tokenResponse.Data);
        throw new Error('Could not obtain Entra access token.');
    }

    var tokenJson = JSON.parse(tokenResponse.Data);
    var accessToken = tokenJson.access_token;
    log('Token obtained successfully.');

    // -- Step 2: build the $select query from our attributes array --
    var selectParam = '';
    for (var i = 0; i < eadAttributes.length; i++) {
        selectParam = selectParam + (i > 0 ? ',' : '') + eadAttributes[i];
    }

    var authHeaders = {
        Headers: {
            'Authorization': 'Bearer ' + accessToken,
            'Content-Type':  'application/json'
        }
    };

    // -- Step 3: try GUID lookup first, fall back to email filter --
    var graphUser = null;

    if (entraGuid) {
        log('Looking up Entra user by GUID: ' + entraGuid);
        var guidUrl = ENTRA_GRAPH_BASE + entraGuid + '?$select=' + selectParam;
        var guidResp;
        try {
            guidResp = ExecuteWebRequest('GET', guidUrl, '', authHeaders);
        } catch (eGuid) {
            console.error('GUID lookup threw an exception: ' + eGuid.toString());
            if (Enable_Custom_Debug) { debugLog = debugLog + '\n[ERROR] GUID lookup threw: ' + eGuid.toString(); }
        }

        if (guidResp && guidResp.StatusCode === 200) {
            graphUser = JSON.parse(guidResp.Data);
            log('Entra user found by GUID.');
        } else {
            warn('GUID lookup returned status ' + (guidResp ? guidResp.StatusCode : 'N/A') + '. Will try email fallback.');
        }
    } else {
        warn('No Entra GUID on record -- skipping GUID lookup, going to email fallback.');
    }

    // email fallback -- uses the /users?$filter= endpoint
    if (!graphUser && userEmail) {
        log('Falling back to email lookup for: ' + userEmail);
        var emailUrl = ENTRA_GRAPH_BASE + '?$filter=mail%20eq%20%27' + userEmail + '%27&$select=' + selectParam;
        var emailResp;
        try {
            emailResp = ExecuteWebRequest('GET', emailUrl, '', authHeaders);
        } catch (eEmail) {
            console.error('Email lookup threw an exception: ' + eEmail.toString());
            if (Enable_Custom_Debug) { debugLog = debugLog + '\n[ERROR] Email lookup threw: ' + eEmail.toString(); }
        }

        if (emailResp && emailResp.StatusCode === 200) {
            var emailResult = JSON.parse(emailResp.Data);
            // Graph returns a value array for filter queries
            if (emailResult.value && emailResult.value.length > 0) {
                graphUser = emailResult.value[0];
                log('Entra user found by email.');
            } else {
                warn('Email filter returned no matching users for: ' + userEmail);
            }
        } else {
            warn('Email lookup returned status ' + (emailResp ? emailResp.StatusCode : 'N/A'));
        }
    }

    if (!graphUser) {
        console.error('No Entra user could be found by GUID or email for Employee $(RecId). No fields will be updated.');
        throw new Error('Entra user not found -- aborting ISM update.');
    }

    // -- Step 4: build the ISM update payload --
    // For attributes with matching names, map them straight across.
    // For the ones with different names, use our explicit variables above.
    var ismFields = {};

    for (var j = 0; j < eadAttributes.length; j++) {
        var attr = eadAttributes[j];

        if (attr === eadAccntExp) {
            // accountExpires comes back as a Windows FILETIME -- 100-nanosecond ticks since 1601-01-01.
            // we need to convert it to a readable date before writing to ISM's date field.
            var filetimeTicks = graphUser[attr];
            if (filetimeTicks && filetimeTicks !== 0) {
                var epochOffsetMs = 11644473600000; // ms between 1601-01-01 and 1970-01-01
                var expDateMs = (filetimeTicks / 10000) - epochOffsetMs;
                var expDate = new Date(expDateMs);
                var expMonth = expDate.getUTCMonth() + 1;
                var expDay   = expDate.getUTCDate();
                ismFields[ismAccntExp] = expDate.getUTCFullYear()
                    + '-' + (expMonth < 10 ? '0' + expMonth : String(expMonth))
                    + '-' + (expDay   < 10 ? '0' + expDay   : String(expDay));
                log('Converted accountExpires FILETIME ' + filetimeTicks + ' -> ' + ismFields[ismAccntExp]);
            } else {
                warn('Entra attribute [' + attr + '] was null or zero -- skipping.');
            }

        } else if (attr === eadCostCenter) {
            if (typeof graphUser[attr] !== 'undefined' && graphUser[attr] !== null) {
                ismFields[ismCostCenter] = String(graphUser[attr]);
                log('Mapping ' + attr + ' -> ' + ismCostCenter + ' = ' + ismFields[ismCostCenter]);
            } else {
                warn('Entra attribute [' + attr + '] was null or missing in Graph response.');
            }

        } else {
            // names match -- write directly using the Entra attribute name as the ISM field name
            if (typeof graphUser[attr] !== 'undefined' && graphUser[attr] !== null) {
                ismFields[attr] = String(graphUser[attr]);
                log('Direct mapping ' + attr + ' = ' + ismFields[attr]);
            } else {
                warn('Entra attribute [' + attr + '] was null or missing -- skipping.');
            }
        }
    }

    log('Updating ISM Employee record with ' + Object.keys(ismFields).length + ' field(s)...');
    currRecord.Update(ismFields);
    log('ISM Employee record updated successfully.');

} catch (eTop) {
    console.error('Script failed: ' + eTop.toString());
    if (Enable_Custom_Debug) { debugLog = debugLog + '\n[ERROR] Script failed: ' + eTop.toString(); }
    throw eTop;
}

// write accumulated debug output to a custom record if configured
if (Enable_Custom_Debug && Custom_Debug_Obj && Custom_Debug_Fld) {
    var debugRecord = Create(Custom_Debug_Obj);
    var debugFields = {};
    debugFields[Custom_Debug_Fld] = debugLog;
    debugRecord.Update(debugFields);
}