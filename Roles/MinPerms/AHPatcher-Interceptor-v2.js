// =============================================================================
// Author: Andrew Hatton
//
// Disclaimer: THIS CODE AND INFORMATION IS PROVIDED "AS IS" WITHOUT WARRANTY
// OF ANY KIND, EITHER EXPRESSED OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE
// IMPLIED WARRANTIES OF MERCHANTABILITY AND/OR FITNESS FOR A PARTICULAR
// PURPOSE. IMPORTANT: Please take care when executing this script on a live
// database or system. It is recommended that a full backup is first performed.
//
// Personal Liability Disclaimer: The author (Andrew Hatton) accepts no
// personal liability for any issues, data loss, misconfiguration, or
// unintended consequences arising from the execution of this script against
// any environment. This script modifies live role permissions and security
// policies in Ivanti Neurons for ITSM. It is your responsibility to validate
// all changes in a lower environment (Staging, UAT, Dev, or equivalent)
// before executing against any Production tenant. By running this script you
// accept all risk associated with its use.
// =============================================================================

// =============================================================================
// AHPatcher - Role Object Permissions Capture
// Browser console script (not an ISM server-side Quick Action)
//
// What it does:
//   Intercepts the next SaveRole call on any role's Object Permissions page
//   and exports two files WITHOUT making any changes to the role:
//
//     <RoleID>_snapshot_<timestamp>.json   -- full raw RolePolicy (use with Rollback script)
//     <RoleID>_permissions_<timestamp>.yaml -- human-readable BO rights summary
//
//   The save itself proceeds normally -- nothing is modified.
//   The interceptor re-installs itself after each capture so you can keep
//   triggering saves without re-pasting.
//
// HOW TO USE:
//   1. Admin > Roles > [any role] > Object Permissions
//   2. F12 > Console > paste this script > Enter
//   3. Tick or untick any checkbox on the page (just to enable the Save button)
//   4. Click Save
//   5. Two files download, console prints a summary
//   6. The interceptor re-installs -- repeat for another role if needed
// =============================================================================

(function AHCapture() {

  var LOG          = '[AHCapture]';
  var captureCount = 0;

  var RIGHTS_LABEL = {
    0 : 'NotSet',
    1 : 'View',
    3 : 'View, Add',
    5 : 'View, Edit',
    7 : 'View, Add, Edit',
    15: 'View, Add, Edit, Delete'
  };

  // ---------------------------------------------------------------------------
  // HELPERS
  // ---------------------------------------------------------------------------

  function getTimestamp() {
    return new Date().toISOString().replace(/:/g, '-').slice(0, 19);
  }

  function downloadFile(filename, content, mime) {
    var blob = new Blob([content], { type: mime || 'text/plain' });
    var url  = URL.createObjectURL(blob);
    var a    = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }

  function rightsLabel(n) {
    return RIGHTS_LABEL[n] !== undefined ? RIGHTS_LABEL[n] : 'Rights_' + n;
  }

  function findObjectEnd(str, startIdx) {
    var depth = 0, inStr = false, esc = false;
    for (var i = startIdx; i < str.length; i++) {
      var c = str[i];
      if (esc) { esc = false; continue; }
      if (inStr) {
        if (c === '\\') esc = true;
        else if (c === '"') inStr = false;
      } else {
        if      (c === '"') inStr = true;
        else if (c === '{') depth++;
        else if (c === '}') { depth--; if (depth === 0) return i + 1; }
      }
    }
    return -1;
  }

  // ---------------------------------------------------------------------------
  // YAML REPORT
  // ---------------------------------------------------------------------------

  function buildYaml(roleId, rp, ts) {
    var lines = [];
    lines.push('# ISM Role - Object Permissions Capture');
    lines.push('# Generated  : ' + ts);
    lines.push('# Script     : AHCapture');
    lines.push('');
    lines.push('role_id: ' + roleId);
    lines.push('');

    // Global defaults
    var defBOR  = rp.match(/"DefaultBusinessObjectRights"\s*:\s*(\d+)/);
    var defBOFR = rp.match(/"DefaultBusinessObjectFieldRights"\s*:\s*(\d+)/);
    lines.push('defaults:');
    lines.push('  DefaultBusinessObjectRights     : ' + (defBOR  ? rightsLabel(parseInt(defBOR[1],  10)) : 'not found'));
    lines.push('  DefaultBusinessObjectFieldRights: ' + (defBOFR ? rightsLabel(parseInt(defBOFR[1], 10)) : 'not found'));
    lines.push('');

    // BusinessObjectRights
    var BOR_KEY = '"BusinessObjectRights":';
    var bkIdx   = rp.indexOf(BOR_KEY);
    if (bkIdx !== -1) {
      var bStart = bkIdx + BOR_KEY.length;
      while (bStart < rp.length && (rp[bStart] === ' ' || rp[bStart] === '\t')) bStart++;
      if (rp[bStart] === '{') {
        var bEnd = findObjectEnd(rp, bStart);
        if (bEnd !== -1) {
          try {
            var bor    = JSON.parse(rp.slice(bStart, bEnd));
            var boKeys = Object.keys(bor);

            // Separate into granted and locked for readability
            var granted = [];
            var locked  = [];
            for (var i = 0; i < boKeys.length; i++) {
              var entry = bor[boKeys[i]];
              if (entry && entry.Rights > 0) {
                granted.push(boKeys[i]);
              } else {
                locked.push(boKeys[i]);
              }
            }

            lines.push('business_object_rights:');
            lines.push('');
            lines.push('  # --- Granted (' + granted.length + ' BOs with Rights > 0) ---');
            for (var g = 0; g < granted.length; g++) {
              var gbo    = granted[g];
              var gentry = bor[gbo];
              var hasFR  = gentry.FieldRights !== null && gentry.FieldRights !== undefined &&
                           typeof gentry.FieldRights === 'object' &&
                           Object.keys(gentry.FieldRights).length > 0;
              var dfr    = (gentry.DefaultFieldRights !== null && gentry.DefaultFieldRights !== undefined)
                           ? rightsLabel(gentry.DefaultFieldRights) : 'null (locked)';

              if (hasFR) {
                // Multi-line format for BOs that have explicit field-level rights
                lines.push('  "' + gbo + '":');
                lines.push('    rights             : ' + rightsLabel(gentry.Rights));
                lines.push('    default_field_rights: ' + dfr);
                lines.push('    field_rights:');
                var frKeys = Object.keys(gentry.FieldRights);
                for (var f = 0; f < frKeys.length; f++) {
                  var fName = frKeys[f];
                  var fVal  = gentry.FieldRights[fName];
                  lines.push('      ' + fName + ': ' + rightsLabel(fVal));
                }
              } else {
                // One-liner for standard BOs
                var dfrNote = (gentry.DefaultFieldRights !== null && gentry.DefaultFieldRights !== undefined)
                              ? '  # DefaultFieldRights: ' + rightsLabel(gentry.DefaultFieldRights) : '';
                lines.push('  "' + gbo + '": ' + rightsLabel(gentry.Rights) + dfrNote);
              }
            }

            lines.push('');
            lines.push('  # --- Explicitly locked to NotSet (' + locked.length + ' BOs with Rights: 0) ---');
            lines.push('  # Not listed individually for brevity.');

            lines.push('');
            lines.push('  summary:');
            lines.push('    total_explicit : ' + boKeys.length);
            lines.push('    granted        : ' + granted.length);
            lines.push('    locked         : ' + locked.length);

          } catch (e) {
            lines.push('  # ERROR parsing BusinessObjectRights: ' + e.message);
          }
        }
      }
    }

    // BusinessObjectRowConditions
    var RC_KEY = '"BusinessObjectRowConditions":';
    var rcIdx  = rp.indexOf(RC_KEY);
    if (rcIdx !== -1) {
      var rcStart = rcIdx + RC_KEY.length;
      while (rcStart < rp.length && (rp[rcStart] === ' ' || rp[rcStart] === '\t')) rcStart++;
      if (rp[rcStart] === '{') {
        var rcEnd = findObjectEnd(rp, rcStart);
        if (rcEnd !== -1) {
          try {
            var rc     = JSON.parse(rp.slice(rcStart, rcEnd));
            var rcKeys = Object.keys(rc);
            lines.push('');
            lines.push('row_conditions:');
            lines.push('  # ' + rcKeys.length + ' business object(s) have row conditions.');
            for (var r = 0; r < rcKeys.length; r++) {
              var rbo  = rcKeys[r];
              var rcnd = rc[rbo];
              // Determine type and summarise without deep-diving the tree
              var rcType = 'unknown';
              if (rcnd.Conditions !== undefined) {
                var leafCount = Array.isArray(rcnd.Conditions) ? rcnd.Conditions.length : '?';
                rcType = 'group (' + leafCount + ' leaf/leaves, Operator=' + rcnd.Operator + ')';
              } else if (rcnd.ExpressionString !== undefined) {
                rcType = 'single: ' + rcnd.ExpressionString;
              } else if (rcnd.RowFieldRef !== undefined) {
                rcType = 'relation: ' + rcnd.RowFieldRef;
              }
              var perm = rcnd.Permission === 1 ? 'Write' : (rcnd.Permission === 0 ? 'Read' : rcnd.Permission);
              lines.push('  "' + rbo + '":');
              lines.push('    Permission : ' + perm);
              lines.push('    Not        : ' + rcnd.Not);
              lines.push('    Type       : ' + rcType);
            }
          } catch (e) {
            lines.push('  # ERROR parsing BusinessObjectRowConditions: ' + e.message);
          }
        }
      }
    }

    return lines.join('\n');
  }

  // ---------------------------------------------------------------------------
  // INTERCEPTOR
  // ---------------------------------------------------------------------------

  var _origInvoke = Sys.Net.WebServiceProxy.invoke;

  function installInterceptor() {
    Sys.Net.WebServiceProxy.invoke = function (servicePath, methodName, useGet, params,
                                               onSuccess, onFailure, userContext, timeout,
                                               enableJsonp, jsonpCallbackParameter) {

      if (methodName === 'SaveRole' && params && params.data && params.data.RolePolicy) {

        // Uninstall, capture, then re-install.
        Sys.Net.WebServiceProxy.invoke = _origInvoke;

        captureCount++;
        var roleId = params.data.RoleID || 'Unknown';
        var ts     = getTimestamp();
        var rp     = params.data.RolePolicy;

        console.group(LOG + ' Capture #' + captureCount + ' -- Role: ' + roleId + ' -- ' + ts);

        // Raw snapshot -- works directly with ISM_SelfService_Rollback.js
        downloadFile(roleId + '_snapshot_' + ts + '.json', rp, 'application/json');
        console.log(LOG, 'Snapshot saved: ' + roleId + '_snapshot_' + ts + '.json (' + rp.length + ' chars)');

        // Human-readable YAML summary
        try {
          var yaml = buildYaml(roleId, rp, ts);
          downloadFile(roleId + '_permissions_' + ts + '.yaml', yaml, 'text/yaml');
          console.log(LOG, 'Permissions report saved: ' + roleId + '_permissions_' + ts + '.yaml');
        } catch (e) {
          console.error(LOG, 'YAML build failed:', e.message);
        }

        // Quick console summary
        var defBOR  = rp.match(/"DefaultBusinessObjectRights"\s*:\s*(\d+)/);
        var defBOFR = rp.match(/"DefaultBusinessObjectFieldRights"\s*:\s*(\d+)/);
        console.log(LOG, 'DefaultBusinessObjectRights     :', defBOR  ? defBOR[1]  : 'not found');
        console.log(LOG, 'DefaultBusinessObjectFieldRights:', defBOFR ? defBOFR[1] : 'not found');

        console.groupEnd();

        // Re-install so next save is also captured.
        installInterceptor();
        console.log(LOG, 'Re-installed. Next save captured as #' + (captureCount + 1) + '.');
      }

      // Pass through completely unchanged -- nothing is modified.
      return _origInvoke.apply(this, [
        servicePath, methodName, useGet, params,
        onSuccess, onFailure, userContext, timeout,
        enableJsonp, jsonpCallbackParameter
      ]);
    };
  }

  installInterceptor();

  console.log(LOG, '=================================================');
  console.log(LOG, ' AHCapture - Role Permissions Capture            ');
  console.log(LOG, '-------------------------------------------------');
  console.log(LOG, ' Does NOT modify anything -- pure capture mode.  ');
  console.log(LOG, ' Re-installs automatically after each save.      ');
  console.log(LOG, '-------------------------------------------------');
  console.log(LOG, ' 1. Tick or untick any checkbox on the page      ');
  console.log(LOG, ' 2. Click Save                                   ');
  console.log(LOG, ' 3. Check Downloads for .json and .yaml files    ');
  console.log(LOG, '=================================================');

})();