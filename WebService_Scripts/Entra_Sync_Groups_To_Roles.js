// Author: Andrew Hatton
// Disclaimer: THIS CODE AND INFORMATION IS PROVIDED "AS IS" WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESSED OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE IMPLIED WARRANTIES OF MERCHANTABILITY AND/OR FITNESS FOR A PARTICULAR PURPOSE. IMPORTANT: Please take care when executing this script on a live database or system. It is recommended that a full backup is first performed.

// Purpose: Scheduled Quick Action that pulls member lists from up to 5 EntraAD groups via Microsoft
// Graph, matches each member to an Employee# record by LoginID, and sets ROLE_TO_GRANT to the role
// mapped to that group. Only 1 of the 5 group/role slots needs to be filled in for this to run -
// empty slots are skipped without stopping the rest of the job.

// Script created manually. An AI was used to create comments ONLY, and then reviewed each comment manually.

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------
var Enable_Debug        = true;  // set false to silence debug output on production runs
var Enable_Warn         = true;
var Enable_Custom_Debug = false; // set true + fill in the two fields below to write a run log record
var Custom_Debug_Obj    = '';    // table ref to write the debug log to, e.g. 'MyLog#'
var Custom_Debug_Fld    = '';    // field on that object to dump the debug log into
var debugLog            = '';    // accumulates log() output for the custom debug record

function log(message) {
    if (Enable_Debug) { console.debug(message); }
    if (Enable_Custom_Debug) { debugLog = debugLog + '\n' + message; }
}
function warn(message) {
    if (Enable_Warn) { console.warn(message); }
}

// ---------------------------------------------------------------------------
// Config - edit before pasting into ISM
// ---------------------------------------------------------------------------

// EntraAD app registration (client credentials flow). This app needs the
// GroupMember.Read.All application permission, admin consented.
var ENTRA_TENANT_ID     = 'REPLACE_WITH_TENANT_ID';
var ENTRA_CLIENT_ID     = 'REPLACE_WITH_CLIENT_ID';
var ENTRA_CLIENT_SECRET = 'REPLACE_WITH_CLIENT_SECRET';

var GRAPH_BASE_URL = 'https://graph.microsoft.com/v1.0';
var TOKEN_URL       = 'https://login.microsoftonline.com/' + ENTRA_TENANT_ID + '/oauth2/v2.0/token';

// ISM side - table and field names
var EMPLOYEE_TABLE       = 'Employee#';
var EMPLOYEE_LOGIN_FIELD = 'LoginID';        // matched against the EntraAD member's userPrincipalName
var EMPLOYEE_ROLE_FIELD  = 'ROLE_TO_GRANT';  // gets set to the mapped role name

// Group -> Role mapping. Up to 5 slots. Leave GroupId/RoleName blank on any
// slot you're not using - the script skips blank slots and keeps going.
// Slots are processed in order 1 through 5. If an employee belongs to more
// than one mapped group, each match saves ROLE_TO_GRANT before moving to the
// next slot, so the value after the run is whichever slot processed last for
// that employee. Flag this if that's not the intended behavior - it may need
// to become a multi-value field instead.
var GROUP_ROLE_MAP = [
    { GroupId: 'REPLACE_WITH_GROUP_ID_1', RoleName: 'REPLACE_WITH_ROLE_NAME_1' },
    { GroupId: '', RoleName: '' }, // Slot 2 - unused
    { GroupId: '', RoleName: '' }, // Slot 3 - unused
    { GroupId: '', RoleName: '' }, // Slot 4 - unused
    { GroupId: '', RoleName: '' }  // Slot 5 - unused
];

// ---------------------------------------------------------------------------
// Helper - pages through a group's member list via Graph, returns a flat array
// Reused once per configured slot below, so it earns its keep as a function.
// ---------------------------------------------------------------------------
function fetchGroupMembers(groupId, token) {
    var members = [];
    var url = GRAPH_BASE_URL + '/groups/' + groupId + '/members?$select=userPrincipalName,displayName&$top=999';

    while (url) {
        var resp = ExecuteWebRequest('GET', url, '', {
            Headers: {
                'Authorization': 'Bearer ' + token,
                'Accept': 'application/json'
            }
        });

        if (resp.StatusCode !== 200) {
            console.error('Graph member fetch failed for group ' + groupId + ': HTTP ' + resp.StatusCode + ' - ' + resp.Data);
            if (Enable_Custom_Debug) { debugLog = debugLog + '\n[ERROR] Graph member fetch failed for group ' + groupId + ': HTTP ' + resp.StatusCode; }
            break;
        }

        var body = JSON.parse(resp.Data);
        var page = body.value || [];
        for (var p = 0; p < page.length; p++) {
            members.push(page[p]);
        }

        // Graph pages results past $top=999 via @odata.nextLink - follow it until it's gone
        url = body['@odata.nextLink'] || null;
    }

    return members;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
try {
    var totalMatched   = 0;
    var totalUnmatched = 0;

    // get an app-only Graph token via client credentials
    var tokenBody = 'grant_type=client_credentials' +
        '&client_id=' + ENTRA_CLIENT_ID +
        '&client_secret=' + ENTRA_CLIENT_SECRET +
        '&scope=' + encodeURIComponent('https://graph.microsoft.com/.default');

    var tokenResp = ExecuteWebRequest('POST', TOKEN_URL, tokenBody, {
        Headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });

    if (tokenResp.StatusCode !== 200) {
        console.error('Failed to get EntraAD access token: HTTP ' + tokenResp.StatusCode + ' - ' + tokenResp.Data);
        if (Enable_Custom_Debug) { debugLog = debugLog + '\n[ERROR] EntraAD token request failed: HTTP ' + tokenResp.StatusCode; }
        throw new Error('EntraAD authentication failed, aborting. Check ENTRA_TENANT_ID/CLIENT_ID/CLIENT_SECRET.');
    }

    var accessToken = JSON.parse(tokenResp.Data).access_token;
    log('EntraAD token acquired.');

    // walk each configured group/role slot in order - a bad or missing slot
    // only takes itself down, the other slots still run. Each matched
    // employee is saved immediately, so an employee in multiple mapped
    // groups picks up role 1, saves, then role 2 on top, saves, and so on.
    for (var s = 0; s < GROUP_ROLE_MAP.length; s++) {
        var slot = GROUP_ROLE_MAP[s];

        if (!slot.GroupId || !slot.RoleName) {
            log('Slot ' + (s + 1) + ' is not configured, skipping.');
            continue;
        }

        try {
            log('Processing slot ' + (s + 1) + ': group ' + slot.GroupId + ' -> role "' + slot.RoleName + '"');
            var members = fetchGroupMembers(slot.GroupId, accessToken);
            log('Found ' + members.length + ' member(s) in group ' + slot.GroupId);

            for (var m = 0; m < members.length; m++) {
                var upn = members[m].userPrincipalName;
                if (!upn) {
                    warn('Member with no userPrincipalName in group ' + slot.GroupId + ', skipping.');
                    continue;
                }

                try {
                    // fetch fresh each time so this write doesn't clobber a save
                    // made by an earlier slot in this same run
                    var employee = Get(EMPLOYEE_TABLE, EMPLOYEE_LOGIN_FIELD, upn);
                    if (!employee) {
                        warn('No ' + EMPLOYEE_TABLE + ' match for ' + upn + ' (group ' + slot.GroupId + ')');
                        totalUnmatched++;
                        continue;
                    }

                    employee.UpdateField(EMPLOYEE_ROLE_FIELD, slot.RoleName);
                    log('Granted role "' + slot.RoleName + '" to ' + upn + ' and saved the record.');
                    totalMatched++;
                } catch (eEmp) {
                    console.error('Failed to update ' + EMPLOYEE_TABLE + ' for ' + upn + ': ' + eEmp);
                    if (Enable_Custom_Debug) { debugLog = debugLog + '\n[ERROR] Failed to update ' + EMPLOYEE_TABLE + ' for ' + upn + ': ' + eEmp; }
                    totalUnmatched++;
                }
            }
        } catch (eSlot) {
            // one broken slot (bad group id, Graph outage, etc) should not stop the rest
            console.error('Slot ' + (s + 1) + ' failed entirely: ' + eSlot);
            if (Enable_Custom_Debug) { debugLog = debugLog + '\n[ERROR] Slot ' + (s + 1) + ' failed entirely: ' + eSlot; }
        }
    }

    log('Sync complete. Matched: ' + totalMatched + ', Unmatched: ' + totalUnmatched);

} catch (eTop) {
    console.error('Script failed: ' + eTop);
    if (Enable_Custom_Debug) { debugLog = debugLog + '\n[ERROR] Script failed: ' + eTop; }
    throw eTop; // re-throw so ISM surfaces the failure
} finally {
    // write the accumulated log to a record if custom debug is turned on
    if (Enable_Custom_Debug && Custom_Debug_Obj && Custom_Debug_Fld) {
        var debugRecord = Create(Custom_Debug_Obj);
        var fields = {};
        fields[Custom_Debug_Fld] = debugLog;
        debugRecord.Update(fields);
    }
}
