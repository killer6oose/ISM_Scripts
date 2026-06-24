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
// AHPatcher v6 - GitHub-Driven Role Patcher
// Browser console script (not an ISM server-side Quick Action)
//
// Minimum set configurations are loaded from a public GitHub repository rather
// than being hardcoded into the script. This means updating permissions no
// longer requires editing the script itself.
//
// Config repo: killer6oose/ISM_Scripts > Roles/MinPerms/2026.x/
// Each role has its own JSON file, e.g. SelfServiceMobile.json
//
// On paste:
//   1. The script tries to detect which role's Object Permissions page you are on
//   2. A modal opens listing all available role configs from GitHub
//   3. The matching config is pre-selected if found; otherwise you pick from the
//      dropdown or type a custom filename
//   4. File picker opens:
//        - Pick a snapshot JSON -> applies that snapshot to the current role
//        - Cancel              -> applies the loaded GitHub config
//   5. Make any single change on the page and click Save
//
// HOW TO USE:
//   1. Admin > Roles > [Target Role] > Object Permissions
//   2. F12 > Console > paste this script > Enter
//   3. Modal: select or confirm the role config
//   4. File picker: pick snapshot or cancel for config mode
//   5. Tick any checkbox, click Save
// =============================================================================

(async function AHPatcher() {
  'use strict';

  var LOG = '[AHPatcher]';

  // ===========================================================================
  // GITHUB CONFIG
  // ===========================================================================
  var GH_OWNER  = 'killer6oose';
  var GH_REPO   = 'ISM_Scripts';
  var GH_PATH   = 'Roles/MinPerms/2026.x';
  var GH_BRANCH = 'main';
  var GH_API    = 'https://api.github.com/repos/' + GH_OWNER + '/' + GH_REPO + '/contents/' + GH_PATH;
  var GH_RAW    = 'https://raw.githubusercontent.com/' + GH_OWNER + '/' + GH_REPO + '/' + GH_BRANCH + '/' + GH_PATH + '/';

  // ===========================================================================
  // RIGHTS LABELS
  // ===========================================================================
  var RIGHTS_LABEL = {
    0 : 'NotSet',
    1 : 'View',
    3 : 'View, Add',
    5 : 'View, Edit',
    7 : 'View, Add, Edit',
    15: 'View, Add, Edit, Delete'
  };

  // ===========================================================================
  // HELPERS
  // ===========================================================================

  function rightsLabel(n) {
    return RIGHTS_LABEL[n] !== undefined ? RIGHTS_LABEL[n] : 'Rights_' + n;
  }

  function getTimestamp() {
    return new Date().toISOString().replace(/:/g, '-').slice(0, 19);
  }

  function downloadFile(filename, content, mime) {
    var blob = new Blob([content], { type: mime || 'text/plain' });
    var url  = URL.createObjectURL(blob);
    var a    = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }

  function findObjectEnd(str, startIdx) {
    var depth = 0, inStr = false, esc = false;
    for (var i = startIdx; i < str.length; i++) {
      var c = str[i];
      if (esc) { esc = false; continue; }
      if (inStr) { if (c === '\\') esc = true; else if (c === '"') inStr = false; }
      else { if (c === '"') inStr = true; else if (c === '{') depth++; else if (c === '}') { depth--; if (depth === 0) return i + 1; } }
    }
    return -1;
  }

  function replaceIntField(str, fieldName, newValue) {
    var pattern = '"' + fieldName + '":';
    var idx = str.indexOf(pattern);
    if (idx === -1) return str;
    var vs = idx + pattern.length, ve = vs;
    while (ve < str.length && str[ve] !== ',' && str[ve] !== '}') ve++;
    console.log(LOG, 'Set', fieldName + ': ' + str.slice(vs, ve), '->', newValue);
    return str.slice(0, vs) + newValue + str.slice(ve);
  }

  // Generates original, lowercase, title-cased, and camelCase variants of a BO name.
  // Works bidirectionally so 'incident#' produces 'Incident#' and vice versa.
  function getCasingVariants(boName) {
    var seen = {}, variants = [];
    function add(v) { if (!seen.hasOwnProperty(v)) { seen[v] = true; variants.push(v); } }
    add(boName);
    var lower = boName.toLowerCase(); add(lower);
    var titled = lower.replace(/(^|[#_])([a-z])/g, function (m, sep, ch) { return sep + ch.toUpperCase(); });
    add(titled);
    if (titled.length > 0) add(titled.charAt(0).toLowerCase() + titled.slice(1));
    return variants;
  }

  // ===========================================================================
  // ROLE DETECTION FROM PAGE
  // Tries several ISM page patterns to find the current role name before the
  // modal opens, so it can pre-select the matching config file.
  // ===========================================================================
  function detectRoleFromPage() {

    // Pattern 1: URL query parameters
    try {
      var params = new URLSearchParams(window.location.search);
      var urlCandidates = ['roleId', 'role', 'id', 'RoleID', 'roleName', 'RoleName'];
      for (var pi = 0; pi < urlCandidates.length; pi++) {
        var v = params.get(urlCandidates[pi]);
        if (v && v.trim().length > 0) return v.trim();
      }
    } catch (_) {}

    // Pattern 2: Document title - ISM often uses "RoleName - Object Permissions"
    try {
      var title = document.title || '';
      var tm = title.match(/^(.+?)(?:\s*[-|]\s*(?:Object Permissions|ISM|Role Manager).*)?$/i);
      if (tm && tm[1].trim().length > 0 && tm[1].trim().length < 80) return tm[1].trim();
    } catch (_) {}

    // Pattern 3: Known ISM DOM selectors for role name headings
    var selectors = [
      '#lblRoleName', '#roleName', '#RoleName',
      'span[id*="RoleName"]', 'span[id*="roleName"]',
      '.selectedRole', '#selectedRoleName',
      'h1.role-name', '.pageTitle .roleName',
      '.breadcrumb li:last-child a', '.breadcrumb li:last-child'
    ];
    for (var si = 0; si < selectors.length; si++) {
      try {
        var el = document.querySelector(selectors[si]);
        if (el) {
          var txt = el.textContent.trim();
          if (txt.length > 0 && txt.length < 80 && !/^\s*$/.test(txt)) return txt;
        }
      } catch (_) {}
    }

    // Pattern 4: Any leaf text node inside an element whose id/class contains 'role'
    try {
      var all = document.querySelectorAll('[id*="Role"],[id*="role"],[class*="Role"],[class*="role"]');
      for (var ai = 0; ai < all.length; ai++) {
        var el2 = all[ai];
        if (el2.children.length === 0) {
          var t = el2.textContent.trim();
          if (t.length > 2 && t.length < 60 && !/[<>\n]/.test(t)) return t;
        }
      }
    } catch (_) {}

    return null;
  }

  // ===========================================================================
  // GITHUB FETCHERS
  // ===========================================================================

  async function fetchRoleList() {
    var resp = await fetch(GH_API, { headers: { Accept: 'application/vnd.github.v3+json' } });
    if (!resp.ok) throw new Error('GitHub API returned ' + resp.status + ' for ' + GH_PATH);
    var files = await resp.json();
    return files
      .filter(function (f) { return f.type === 'file' && /\.json$/i.test(f.name); })
      .map(function (f) { return { name: f.name, roleName: f.name.replace(/\.json$/i, ''), rawUrl: f.download_url }; });
  }

  async function fetchRoleConfig(rawUrl) {
    var resp = await fetch(rawUrl);
    if (resp.status === 404) throw new Error('not_found');
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    var config = await resp.json();
    if (!config.business_object_rights || typeof config.business_object_rights !== 'object') {
      throw new Error('"business_object_rights" key missing -- is this an AHPatcher config file?');
    }
    return config;
  }

  // ===========================================================================
  // ROLE SELECTION MODAL
  // Injected into the ISM page DOM. Resolves with { config, name, url } or null
  // if the user aborts.
  // ===========================================================================
  function showRoleModal(roleFiles, detectedRole) {
    return new Promise(function (resolve) {

      // Find if the detected role has a matching file
      var matched = null;
      if (detectedRole) {
        for (var i = 0; i < roleFiles.length; i++) {
          if (roleFiles[i].roleName.toLowerCase() === detectedRole.toLowerCase()) {
            matched = roleFiles[i]; break;
          }
        }
      }

      // ---- Inline styles (scoped to avoid ISM CSS collision) ----
      var S = {
        overlay : 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.65);z-index:999998;display:flex;align-items:center;justify-content:center;font-family:Arial,Helvetica,sans-serif;',
        modal   : 'background:#fff;border-radius:6px;width:520px;max-width:92vw;box-shadow:0 8px 40px rgba(0,0,0,0.35);z-index:999999;overflow:hidden;',
        header  : 'background:#1F3864;color:#fff;padding:14px 20px;',
        hTitle  : 'font-size:15px;font-weight:bold;margin:0;font-family:Arial,sans-serif;',
        hSub    : 'font-size:11px;opacity:0.7;margin-top:3px;font-family:Arial,sans-serif;',
        body    : 'padding:20px;',
        label   : 'display:block;font-size:12px;font-weight:bold;color:#404040;margin:14px 0 4px;font-family:Arial,sans-serif;',
        select  : 'width:100%;padding:8px 10px;border:1px solid #BFBFBF;border-radius:4px;font-size:13px;color:#1F1F1F;background:#fff;box-sizing:border-box;font-family:Arial,sans-serif;',
        input   : 'width:100%;padding:8px 10px;border:1px solid #BFBFBF;border-radius:4px;font-size:13px;color:#1F1F1F;background:#fff;box-sizing:border-box;font-family:Arial,sans-serif;margin-top:4px;',
        divider : 'border:none;border-top:1px solid #E8E8E8;margin:18px 0 0;',
        footer  : 'display:flex;gap:10px;justify-content:flex-end;padding:14px 20px;background:#F5F5F5;border-top:1px solid #E0E0E0;',
        btnPri  : 'padding:9px 22px;background:#2E75B6;color:#fff;border:none;border-radius:4px;font-size:13px;font-weight:bold;cursor:pointer;font-family:Arial,sans-serif;',
        btnSec  : 'padding:9px 18px;background:#fff;color:#595959;border:1px solid #BFBFBF;border-radius:4px;font-size:13px;cursor:pointer;font-family:Arial,sans-serif;',
        info    : 'background:#DEEAF1;border-left:4px solid #2E75B6;padding:9px 12px;font-size:12px;color:#1F3864;margin-top:6px;border-radius:0 4px 4px 0;font-family:Arial,sans-serif;',
        warn    : 'background:#FFF2CC;border-left:4px solid #BF8F00;padding:9px 12px;font-size:12px;color:#7F5A00;margin-top:6px;border-radius:0 4px 4px 0;font-family:Arial,sans-serif;',
        err     : 'background:#FCE4D6;border-left:4px solid #C55A11;padding:9px 12px;font-size:12px;color:#833C00;margin-top:8px;border-radius:0 4px 4px 0;font-family:Arial,sans-serif;',
        status  : 'font-size:12px;color:#595959;margin-top:10px;min-height:16px;font-family:Arial,sans-serif;'
      };

      function el(tag, style, text) {
        var e = document.createElement(tag);
        if (style) e.style.cssText = style;
        if (text)  e.textContent = text;
        return e;
      }

      // ---- Build structure ----
      var overlay = el('div', S.overlay); overlay.id = 'ahp-overlay';
      var modal   = el('div', S.modal);

      // Header
      var header = el('div', S.header);
      var hTitle = el('div', S.hTitle, 'AHPatcher - Select Role Configuration');
      var hSub   = el('div', S.hSub, GH_OWNER + '/' + GH_REPO + ' \u203a ' + GH_PATH);
      header.appendChild(hTitle); header.appendChild(hSub);

      // Body
      var body = el('div', S.body);

      // Detected role notice
      if (detectedRole) {
        var noticeStyle = matched ? S.info : S.warn;
        var notice = el('div', noticeStyle);
        notice.innerHTML = '<strong>Detected role:</strong> ' + detectedRole +
          (matched ? ' &ndash; matching config found and pre-selected below.'
                   : ' &ndash; no matching file found. Select from the list or enter a filename.');
        body.appendChild(notice);
      }

      // Dropdown
      var lbl1 = el('label', S.label, roleFiles.length > 0 ? 'Available role configurations:' : 'No configuration files found in repo.');
      body.appendChild(lbl1);

      var sel = document.createElement('select');
      sel.style.cssText = S.select; sel.id = 'ahp-sel';
      var opt0 = document.createElement('option');
      opt0.value = ''; opt0.textContent = '-- select a role --';
      sel.appendChild(opt0);
      for (var fi = 0; fi < roleFiles.length; fi++) {
        var opt = document.createElement('option');
        opt.value = roleFiles[fi].rawUrl;
        opt.textContent = roleFiles[fi].roleName;
        if (matched && roleFiles[fi].roleName.toLowerCase() === detectedRole.toLowerCase()) opt.selected = true;
        sel.appendChild(opt);
      }
      body.appendChild(sel);

      // Divider + custom input
      body.appendChild(el('hr', S.divider));
      var lbl2 = el('label', S.label, 'Or enter a filename (without .json) for a config not in the list:');
      body.appendChild(lbl2);
      var inp = el('input', S.input);
      inp.type = 'text'; inp.id = 'ahp-inp';
      inp.placeholder = 'e.g. MyCustomRole  --  takes precedence over the dropdown above';
      body.appendChild(inp);

      // Status
      var statusEl = el('p', S.status); statusEl.id = 'ahp-status';
      body.appendChild(statusEl);

      // Footer
      var footer  = el('div', S.footer);
      var btnAbort = el('button', S.btnSec, 'Abort');
      var btnLoad  = el('button', S.btnPri, 'Load Configuration');
      footer.appendChild(btnAbort); footer.appendChild(btnLoad);

      modal.appendChild(header);
      modal.appendChild(body);
      modal.appendChild(footer);
      overlay.appendChild(modal);
      document.body.appendChild(overlay);

      // ---- Helpers ----
      function setStatus(msg, style) {
        statusEl.style.cssText = style || S.status;
        statusEl.textContent = msg;
      }
      function cleanup() {
        if (document.body.contains(overlay)) document.body.removeChild(overlay);
      }

      // ---- Events ----
      btnAbort.addEventListener('click', function () { cleanup(); resolve(null); });

      btnLoad.addEventListener('click', async function () {
        var customName = inp.value.trim();
        var rawUrl = '';

        if (customName) {
          // Custom filename - construct raw URL directly
          var filename = /\.json$/i.test(customName) ? customName : customName + '.json';
          rawUrl = GH_RAW + encodeURIComponent(filename);
        } else {
          rawUrl = sel.value;
        }

        if (!rawUrl) {
          setStatus('Select a role from the list or enter a filename.', S.err);
          return;
        }

        btnLoad.textContent = 'Loading...';
        btnLoad.disabled = true;
        setStatus('Fetching from GitHub...');

        try {
          var config = await fetchRoleConfig(rawUrl);
          var name = config.role || (customName || rawUrl.split('/').pop().replace(/\.json$/i, ''));
          var borCount  = Object.keys(config.business_object_rights || {}).length;
          var rcCount   = Object.keys(config.row_conditions || {}).length;
          var frCount   = Object.keys(config.field_rights || {}).length;
          setStatus('Loaded: ' + name + ' -- ' + borCount + ' BOs, ' + rcCount + ' row conditions, ' + frCount + ' field rights entries.');
          setTimeout(function () { cleanup(); resolve({ config: config, name: name, url: rawUrl }); }, 600);
        } catch (err) {
          btnLoad.textContent = 'Load Configuration';
          btnLoad.disabled = false;
          if (err.message === 'not_found') {
            setStatus('File not found in the repo. Check the name and try again.', S.err);
          } else {
            setStatus('Error: ' + err.message, S.err);
          }
        }
      });

      // Enter key in text input triggers load
      inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') btnLoad.click(); });
    });
  }

  // ===========================================================================
  // ROW CONDITION BUILDER -- JSON driven
  // All enum values confirmed from live SaveRole capture (2026-05-26).
  // ===========================================================================
  var _RC = {
    KIND_EXPR: 0, KIND_GROUP: 5,
    PERM_READ: 0, PERM_WRITE: 1, OP_OR: 1,
    NK_LITERAL: 0, NK_FIELD: 1, NK_BINARY: 3, NK_FUNCTION: 5, NK_SEL: 10,
    OP_EQUAL: 0
  };

  // Single leaf: $(fieldName == fnName())
  function buildLeaf(fieldName, fnName) {
    return {
      Expression: {
        Description: null, Name: null, FieldRefs: [fieldName], IsFullExpression: true,
        Source: '$(' + fieldName + ' == ' + fnName + '())', ValidationStatus: 0,
        Tree: {
          Op: _RC.OP_EQUAL,
          Left: { FieldIndex: 0, Details: { Container: null, Selector: fieldName, SubSelector: null, IsObjectSelector: false, Qualifiers: null, Kind: _RC.NK_SEL }, Kind: _RC.NK_FIELD },
          Right: { Arguments: [], FunctionName: fnName, IsMethod: false, Kind: _RC.NK_FUNCTION },
          Kind: _RC.NK_BINARY
        }
      },
      ExpressionString: '$(' + fieldName + ' == ' + fnName + '())',
      Kind: _RC.KIND_EXPR, Not: false, Permission: _RC.PERM_WRITE, uiType: 'fieldEqual'
    };
  }

  // Single leaf: $(fieldName == "value") for strings or $(fieldName == true) for booleans.
  // uiType 'validatedEqual' matches what ISM's own UI writes for literal comparisons.
  function buildLiteralLeaf(fieldName, value, perm) {
    var p = (perm !== undefined) ? perm : _RC.PERM_WRITE;
    var srcVal = (typeof value === 'string') ? '"' + value + '"' : String(value);
    var src = '$(' + fieldName + ' == ' + srcVal + ')';
    return {
      Expression: {
        Description: null, Name: null, FieldRefs: [fieldName], IsFullExpression: true,
        Source: src, ValidationStatus: 0,
        Tree: {
          Op: _RC.OP_EQUAL,
          Left: { FieldIndex: 0, Details: { Container: null, Selector: fieldName, SubSelector: null, IsObjectSelector: false, Qualifiers: null, Kind: _RC.NK_SEL }, Kind: _RC.NK_FIELD },
          Right: { Value: value, LongImage: null, IsHex: false, IsVerbatimText: false, Kind: _RC.NK_LITERAL },
          Kind: _RC.NK_BINARY
        }
      },
      ExpressionString: src,
      Kind: _RC.KIND_EXPR, Not: false, Permission: p, uiType: 'validatedEqual'
    };
  }

  // Mixed Or group from pre-built leaf objects
  function buildMixedOrGroup(leaves, perm) {
    var p = (perm !== undefined) ? perm : _RC.PERM_WRITE;
    return { Operator: _RC.OP_OR, Conditions: leaves, Kind: _RC.KIND_GROUP, Not: false, Permission: p, uiType: null };
  }

  // Build one leaf from a condition spec object
  function buildLeafFromSpec(spec) {
    if (spec.kind === 'function') {
      return buildLeaf(spec.field, spec.fn);
    }
    if (spec.kind === 'literal') {
      var val  = spec.valueType === 'boolean' ? (spec.value === true || spec.value === 'true') : spec.value;
      var perm = spec.permission === 'read' ? _RC.PERM_READ : _RC.PERM_WRITE;
      return buildLiteralLeaf(spec.field, val, perm);
    }
    throw new Error('Unknown leaf kind "' + spec.kind + '" in row condition spec');
  }

  // Build a full condition entry from a JSON spec
  function buildConditionFromSpec(boName, spec, currentRC) {
    var perm = spec.permission === 'read' ? _RC.PERM_READ : _RC.PERM_WRITE;

    // preserve_ootb: keep whatever ISM has stored for this BO unchanged
    if (spec.type === 'preserve_ootb') {
      return currentRC.hasOwnProperty(boName) ? currentRC[boName] : null;
    }

    // single: one expression leaf (function or literal)
    if (spec.type === 'single') {
      var leaf = buildLeafFromSpec(spec);
      // Override permission at the top level since single leaves carry their own
      leaf.Permission = perm;
      return leaf;
    }

    // or_group: multiple leaves joined by OR
    if (spec.type === 'or_group') {
      var leaves = (spec.conditions || []).map(buildLeafFromSpec);
      return buildMixedOrGroup(leaves, perm);
    }

    throw new Error('Unknown row condition type "' + spec.type + '" for ' + boName);
  }

  function buildRowConditions(currentRC, roleConfig) {
    var rcSpec   = roleConfig.row_conditions || {};
    var newRC    = {}, applied = [], removed = [];
    var specKeys = Object.keys(rcSpec);

    for (var i = 0; i < specKeys.length; i++) {
      var bo   = specKeys[i];
      var spec = rcSpec[bo];
      try {
        var built = buildConditionFromSpec(bo, spec, currentRC);
        if (built !== null) {
          newRC[bo] = built;
          if (spec.type === 'preserve_ootb') {
            console.log(LOG, 'Row condition preserved:', bo);
          } else {
            applied.push(bo);
          }
        }
      } catch (err) {
        console.error(LOG, 'Row condition build failed for', bo + ':', err.message);
      }
    }

    // Track conditions that existed before but are not in the new set
    var curKeys = Object.keys(currentRC);
    for (var k = 0; k < curKeys.length; k++) {
      if (!newRC.hasOwnProperty(curKeys[k])) removed.push(curKeys[k]);
    }
    if (removed.length > 0) console.log(LOG, 'Row conditions removed:', removed.join(', '));

    return { rc: newRC, applied: applied, removed: removed };
  }

  // ===========================================================================
  // BOR BUILDER -- JSON driven
  // ===========================================================================
  function buildNewBOR(currentBOR, roleConfig, customObjects) {
    var newBOR  = {};
    var borSpec = roleConfig.business_object_rights || {};
    var frSpec  = roleConfig.field_rights || {};

    // Apply every BO from the config, with casing variants
    var borKeys = Object.keys(borSpec);
    for (var i = 0; i < borKeys.length; i++) {
      var bo       = borKeys[i];
      var rights   = borSpec[bo];
      var variants = getCasingVariants(bo);

      for (var vi = 0; vi < variants.length; vi++) {
        var vbo = variants[vi];
        // Skip if this variant is explicitly listed under its own key in the config
        if (vbo !== bo && borSpec.hasOwnProperty(vbo)) continue;
        if (newBOR.hasOwnProperty(vbo)) continue;

        if (frSpec.hasOwnProperty(bo)) {
          // Field-level rights: lock all unlisted fields on this BO
          newBOR[vbo] = { Rights: rights, FieldRights: frSpec[bo], DefaultFieldRights: null };
          if (vi === 0) console.log(LOG, 'Field-level rights for:', bo, '(' + Object.keys(frSpec[bo]).length + ' fields, unlisted locked)');
        } else {
          newBOR[vbo] = { Rights: rights, FieldRights: null, DefaultFieldRights: 5 };
        }
      }
    }

    // Runtime custom objects, also with casing variants
    var custKeys = Object.keys(customObjects);
    for (var j = 0; j < custKeys.length; j++) {
      var cbo = custKeys[j], cR = customObjects[cbo];
      var cVars = getCasingVariants(cbo);
      for (var cvi = 0; cvi < cVars.length; cvi++) {
        var cvbo = cVars[cvi];
        if (newBOR.hasOwnProperty(cvbo)) continue;
        newBOR[cvbo] = { Rights: cR, FieldRights: null, DefaultFieldRights: cR > 0 ? 5 : null };
      }
    }

    // Explicitly lock everything else already in the role
    var curKeys = Object.keys(currentBOR);
    for (var k = 0; k < curKeys.length; k++) {
      var existing = curKeys[k];
      if (!newBOR.hasOwnProperty(existing)) {
        newBOR[existing] = { Rights: 0, FieldRights: null, DefaultFieldRights: null };
      }
    }

    return newBOR;
  }

  // ===========================================================================
  // CUSTOM OBJECTS PROMPT
  // ===========================================================================
  function promptCustomObjects(contextMsg) {
    var customObjects = {};
    var ask = window.prompt('AHPatcher\n\n' + contextMsg + '\n\nAdd or override any business object rights?\n\nEnter  y  or  n', 'n');
    if (!ask || ask.trim().toLowerCase() !== 'y') return customObjects;

    var adding = true;
    while (adding) {
      var boName = window.prompt('Business object name (include the # symbol)\nLeave blank and press OK to finish.', '');
      if (!boName || !boName.trim()) { adding = false; break; }
      boName = boName.trim();
      var lvlStr = window.prompt('Access level for: ' + boName + '\n\n  0 None\n  1 View\n  3 View + Add\n  5 View + Edit\n  7 View + Add + Edit\n  15 Full (CRUD)', '1');
      var level = parseInt(lvlStr, 10);
      if (isNaN(level) || [0, 1, 3, 5, 7, 15].indexOf(level) === -1) {
        window.alert('Invalid. Valid choices: 0, 1, 3, 5, 7, 15. Skipped.'); continue;
      }
      customObjects[boName] = level;
      console.log(LOG, 'Custom BO queued:', boName, '->', RIGHTS_LABEL[level] || level);
      var another = window.prompt('Added: ' + boName + ' (' + (RIGHTS_LABEL[level] || level) + ')\n\nAdd another?  y / n', 'n');
      if (!another || another.trim().toLowerCase() !== 'y') adding = false;
    }
    return customObjects;
  }

  // ===========================================================================
  // APPLY CONFIG
  // ===========================================================================
  function applyConfig(rpStr, roleConfig, customObjects) {
    var rcApplied = [], rcRemoved = [];

    // Zero global defaults - any BO not explicitly listed gets no access
    rpStr = replaceIntField(rpStr, 'DefaultBusinessObjectRights', 0);
    rpStr = replaceIntField(rpStr, 'DefaultBusinessObjectFieldRights', 0);

    // Replace BusinessObjectRights block
    var BOR_KEY = '"BusinessObjectRights":';
    var bkIdx   = rpStr.indexOf(BOR_KEY);
    if (bkIdx === -1) throw new Error('BusinessObjectRights not found in RolePolicy');
    var bStart = bkIdx + BOR_KEY.length;
    while (bStart < rpStr.length && (rpStr[bStart] === ' ' || rpStr[bStart] === '\t')) bStart++;
    if (rpStr[bStart] !== '{') throw new Error('Expected { at start of BusinessObjectRights');
    var bEnd = findObjectEnd(rpStr, bStart);
    if (bEnd === -1) throw new Error('Could not find closing } for BusinessObjectRights');

    var currentBOR = JSON.parse(rpStr.slice(bStart, bEnd));
    var newBOR     = buildNewBOR(currentBOR, roleConfig, customObjects);
    var borSpec    = roleConfig.business_object_rights || {};
    var grantedCount = Object.keys(borSpec).length + Object.keys(customObjects).length;
    var lockedCount  = Object.keys(newBOR).filter(function (b) { return newBOR[b].Rights === 0; }).length;
    console.log(LOG, 'BOR: existing=' + Object.keys(currentBOR).length + ', granted=' + grantedCount + ', locked=' + lockedCount);
    rpStr = rpStr.slice(0, bStart) + JSON.stringify(newBOR) + rpStr.slice(bEnd);

    // Replace BusinessObjectRowConditions block
    var RC_KEY = '"BusinessObjectRowConditions":';
    var rcIdx  = rpStr.indexOf(RC_KEY);
    if (rcIdx !== -1) {
      var rcStart = rcIdx + RC_KEY.length;
      while (rcStart < rpStr.length && (rpStr[rcStart] === ' ' || rpStr[rcStart] === '\t')) rcStart++;
      if (rpStr[rcStart] === '{') {
        var rcEnd = findObjectEnd(rpStr, rcStart);
        if (rcEnd !== -1) {
          try {
            var currentRC = JSON.parse(rpStr.slice(rcStart, rcEnd));
            var rcResult  = buildRowConditions(currentRC, roleConfig);
            rcApplied = rcResult.applied; rcRemoved = rcResult.removed || [];

            // Guard against ISM's legacy Array.prototype.toJSON double-serialising arrays
            var _savedAtj = Array.prototype.toJSON;
            try { delete Array.prototype.toJSON; } catch (_e) { Array.prototype.toJSON = undefined; }
            var _rcJson;
            try { _rcJson = JSON.stringify(rcResult.rc); }
            finally { if (typeof _savedAtj !== 'undefined') Array.prototype.toJSON = _savedAtj; }

            rpStr = rpStr.slice(0, rcStart) + _rcJson + rpStr.slice(rcEnd);
            if (rcApplied.length > 0) console.log(LOG, 'Row conditions applied:', rcApplied.join(', '));
            if (rcRemoved.length > 0) console.log(LOG, 'Row conditions removed:', rcRemoved.join(', '));
          } catch (rcErr) {
            console.error(LOG, 'Row condition patch failed (BOR still applied):', rcErr.message);
          }
        }
      }
    }

    return { patched: rpStr, newBOR: newBOR, rcApplied: rcApplied, rcRemoved: rcRemoved };
  }

  // ===========================================================================
  // YAML REPORTS
  // ===========================================================================
  function buildPreYaml(roleId, rp, ts, replacedBy) {
    var lines = [];
    lines.push('# ISM Role - Pre-Patcher Permissions Capture');
    lines.push('# Generated  : ' + ts);
    lines.push('# Script     : AHPatcher v5');
    lines.push('# Replaced by: ' + replacedBy);
    lines.push('');
    lines.push('role_id: ' + roleId);
    lines.push('');
    var defBOR  = rp.match(/"DefaultBusinessObjectRights"\s*:\s*(\d+)/);
    var defBOFR = rp.match(/"DefaultBusinessObjectFieldRights"\s*:\s*(\d+)/);
    lines.push('defaults:');
    lines.push('  DefaultBusinessObjectRights     : ' + (defBOR  ? rightsLabel(parseInt(defBOR[1],  10)) : 'not found'));
    lines.push('  DefaultBusinessObjectFieldRights: ' + (defBOFR ? rightsLabel(parseInt(defBOFR[1], 10)) : 'not found'));
    lines.push('');

    var BOR_KEY = '"BusinessObjectRights":';
    var bkIdx   = rp.indexOf(BOR_KEY);
    if (bkIdx !== -1) {
      var bStart = bkIdx + BOR_KEY.length;
      while (bStart < rp.length && (rp[bStart] === ' ' || rp[bStart] === '\t')) bStart++;
      if (rp[bStart] === '{') {
        var bEnd = findObjectEnd(rp, bStart);
        if (bEnd !== -1) {
          try {
            var bor = JSON.parse(rp.slice(bStart, bEnd));
            var boKeys = Object.keys(bor), granted = [], locked = [];
            for (var i = 0; i < boKeys.length; i++) { var e = bor[boKeys[i]]; if (e && e.Rights > 0) granted.push(boKeys[i]); else locked.push(boKeys[i]); }
            lines.push('business_object_rights:'); lines.push('');
            lines.push('  # --- Granted (' + granted.length + ' BOs) ---');
            for (var g = 0; g < granted.length; g++) {
              var gbo = granted[g], ge = bor[gbo];
              var hasFR = ge.FieldRights && typeof ge.FieldRights === 'object' && Object.keys(ge.FieldRights).length > 0;
              if (hasFR) {
                lines.push('  "' + gbo + '":');
                lines.push('    rights             : ' + rightsLabel(ge.Rights));
                lines.push('    default_field_rights: ' + (ge.DefaultFieldRights !== null && ge.DefaultFieldRights !== undefined ? rightsLabel(ge.DefaultFieldRights) : 'null (locked)'));
                lines.push('    field_rights:');
                var frKeys = Object.keys(ge.FieldRights);
                for (var f = 0; f < frKeys.length; f++) lines.push('      ' + frKeys[f] + ': ' + rightsLabel(ge.FieldRights[frKeys[f]]));
              } else {
                var dfr = (ge.DefaultFieldRights !== null && ge.DefaultFieldRights !== undefined) ? '  # DefaultFieldRights: ' + rightsLabel(ge.DefaultFieldRights) : '';
                lines.push('  "' + gbo + '": ' + rightsLabel(ge.Rights) + dfr);
              }
            }
            lines.push('');
            lines.push('  # --- Locked (' + locked.length + ' BOs) -- not listed individually ---');
            lines.push('  summary:');
            lines.push('    total_explicit : ' + boKeys.length);
            lines.push('    granted        : ' + granted.length);
            lines.push('    locked         : ' + locked.length);
          } catch (e2) { lines.push('  # ERROR: ' + e2.message); }
        }
      }
    }
    return lines.join('\n');
  }

  function buildAppliedYaml(roleId, newBOR, roleConfig, customObjects, rcApplied, rcRemoved, ts) {
    var borSpec  = roleConfig.business_object_rights || {};
    var borKeys  = Object.keys(borSpec);
    var custKeys = Object.keys(customObjects);
    var allKeys  = Object.keys(newBOR);
    var lockedCount = allKeys.filter(function (b) { return newBOR[b].Rights === 0 && !borSpec.hasOwnProperty(b) && custKeys.indexOf(b) === -1; }).length;

    var lines = [];
    lines.push('# ISM Role - Applied Permissions Report');
    lines.push('# Generated : ' + ts);
    lines.push('# Script    : AHPatcher v5');
    lines.push('# Config    : ' + (roleConfig.role || 'unknown') + ' (v' + (roleConfig.version || '?') + ')');
    lines.push('');
    lines.push('role_id: ' + roleId);
    lines.push('');
    lines.push('defaults:');
    lines.push('  DefaultBusinessObjectRights     : NotSet (0)');
    lines.push('  DefaultBusinessObjectFieldRights: NotSet (0)');
    lines.push('  # All unlisted BOs (~1200+) are implicitly locked.');
    lines.push('');
    lines.push('business_object_rights:');
    lines.push('  # --- From config (' + borKeys.length + ' entries) ---');
    lines.push('');
    for (var m = 0; m < borKeys.length; m++) {
      var bo = borKeys[m], entry = newBOR[bo] || { Rights: 0 };
      var rcNote = rcApplied.indexOf(bo) !== -1 ? '  # row-condition applied' : '';
      lines.push('  "' + bo + '": ' + rightsLabel(entry.Rights) + rcNote);
    }
    if (custKeys.length > 0) {
      lines.push('');
      lines.push('  # --- Runtime custom (' + custKeys.length + ') ---');
      for (var c = 0; c < custKeys.length; c++) {
        var cbo = custKeys[c], ce = newBOR[cbo] || { Rights: 0 };
        lines.push('  "' + cbo + '": ' + rightsLabel(ce.Rights) + '  # custom');
      }
    }
    lines.push('');
    lines.push('  # --- Locked (' + lockedCount + ') -- not listed individually ---');
    lines.push('');
    lines.push('row_conditions:');
    lines.push('  applied:');
    if (rcApplied.length === 0) { lines.push('    - "(none)"'); }
    else { for (var a = 0; a < rcApplied.length; a++) lines.push('    - "' + rcApplied[a] + '"'); }
    if (rcRemoved.length > 0) {
      lines.push('  removed:');
      for (var rem = 0; rem < rcRemoved.length; rem++) lines.push('    - "' + rcRemoved[rem] + '"');
    }
    return lines.join('\n');
  }

  // ===========================================================================
  // INTERCEPTOR INSTALLER
  // ===========================================================================
  function installInterceptor(getPayload, onSuccessCallback, readyMsg) {
    var _orig = Sys.Net.WebServiceProxy.invoke;
    Sys.Net.WebServiceProxy.invoke = function (servicePath, methodName, useGet, params, onSuccess, onFailure, userContext, timeout, enableJsonp, jsonpCallbackParameter) {
      if (methodName === 'SaveRole' && params && params.data) {
        Sys.Net.WebServiceProxy.invoke = _orig;
        var roleId = params.data.RoleID || 'Unknown';
        var ts     = getTimestamp();
        var currentPolicy = params.data.RolePolicy;
        console.log(LOG, 'Intercepted SaveRole for:', roleId);

        // Save pre-change state
        downloadFile(roleId + '_pre-patcher_snapshot_' + ts + '.json', currentPolicy, 'application/json');
        console.log(LOG, 'Pre-patcher snapshot saved.');

        var result = getPayload(currentPolicy, roleId, ts);

        try {
          var preYaml = buildPreYaml(roleId, currentPolicy, ts, result.replacedBy);
          downloadFile(roleId + '_pre-patcher_permissions_' + ts + '.yaml', preYaml, 'text/yaml');
          console.log(LOG, 'Pre-patcher YAML saved.');
        } catch (e) { console.error(LOG, 'Pre-YAML failed:', e.message); }

        params.data.RolePolicy = result.policy;
        var _ok = onSuccess, _fail = onFailure;

        return _orig.apply(this, [servicePath, methodName, useGet, params,
          function () {
            console.log(LOG, 'PATCHER SUCCEEDED. Navigate away and back to Object Permissions to confirm.');
            onSuccessCallback(roleId, ts, result);
            if (_ok) _ok.apply(this, arguments);
          },
          function (err) {
            console.error(LOG, 'PATCHER FAILED:', err && (err.Message || err));
            Sys.Net.WebServiceProxy.invoke = _orig;
            if (_fail) _fail.apply(this, arguments);
          },
          userContext, timeout, enableJsonp, jsonpCallbackParameter
        ]);
      }
      return _orig.apply(this, [servicePath, methodName, useGet, params, onSuccess, onFailure, userContext, timeout, enableJsonp, jsonpCallbackParameter]);
    };

    console.log(LOG, '==============================================');
    console.log(LOG, ' PATCHER READY');
    console.log(LOG, '----------------------------------------------');
    for (var i = 0; i < readyMsg.length; i++) console.log(LOG, readyMsg[i]);
    console.log(LOG, '----------------------------------------------');
    console.log(LOG, ' Make any change on the page and click Save.');
    console.log(LOG, '==============================================');
  }

  // ===========================================================================
  // MAIN FLOW
  // ===========================================================================

  // Step 1 - Try to detect which role page we are on
  var detectedRole = detectRoleFromPage();
  console.log(LOG, detectedRole ? 'Detected role from page: ' + detectedRole : 'Could not auto-detect role from page');

  // Step 2 - Fetch available configs from GitHub
  var roleFiles = [];
  try {
    roleFiles = await fetchRoleList();
    console.log(LOG, 'GitHub: ' + roleFiles.length + ' config file(s) available');
    roleFiles.forEach(function (f) { console.log(LOG, '  -', f.roleName); });
  } catch (e) {
    console.warn(LOG, 'Could not fetch role list from GitHub:', e.message);
    console.warn(LOG, 'You can still enter a filename manually in the modal.');
  }

  // Step 3 - Show modal and wait for selection
  var selected = await showRoleModal(roleFiles, detectedRole);
  if (!selected) {
    console.warn(LOG, 'Aborted -- no configuration selected.');
    return;
  }

  var roleConfig     = selected.config;
  var roleConfigName = selected.name;
  console.log(LOG, 'Config loaded:', roleConfigName,
    '| BOs:', Object.keys(roleConfig.business_object_rights || {}).length,
    '| Row conditions:', Object.keys(roleConfig.row_conditions || {}).length,
    '| Field rights BOs:', Object.keys(roleConfig.field_rights || {}).length);

  // Step 4 - File picker: snapshot mode vs config mode
  var input = document.createElement('input');
  input.type = 'file'; input.accept = '.json,application/json,text/plain';
  input.style.display = 'none';
  document.body.appendChild(input);
  var pickerResolved = false;

  function onPickerCancel() {
    if (pickerResolved) return;
    pickerResolved = true;
    document.body.removeChild(input);
    console.log(LOG, 'No snapshot file -- applying config: ' + roleConfigName);

    var customObjects = promptCustomObjects(
      'Mode: CONFIG (' + roleConfigName + ')\n' +
      'BOs: ' + Object.keys(roleConfig.business_object_rights || {}).length + '\n' +
      'Everything else will be locked to NotSet.'
    );
    var custCount = Object.keys(customObjects).length;

    installInterceptor(
      function (currentPolicy, roleId, ts) {
        var result = applyConfig(currentPolicy, roleConfig, customObjects);
        console.log(LOG, 'Config applied -- sending to server...');
        return { policy: result.patched, replacedBy: roleConfigName + ' (AHPatcher v5)', newBOR: result.newBOR, rcApplied: result.rcApplied, rcRemoved: result.rcRemoved, mode: 'config', customObjects: customObjects };
      },
      function (roleId, ts, result) {
        try {
          var yaml = buildAppliedYaml(roleId, result.newBOR, roleConfig, result.customObjects, result.rcApplied, result.rcRemoved, ts);
          downloadFile(roleId + '_applied_' + ts + '.yaml', yaml, 'text/yaml');
          console.log(LOG, 'Applied YAML saved.');
        } catch (e) { console.error(LOG, 'Applied YAML failed:', e.message); }
      },
      [' Mode   : CONFIG', ' Config : ' + roleConfigName, ' BOs    : ' + Object.keys(roleConfig.business_object_rights || {}).length, ' Custom : ' + custCount]
    );
  }

  input.addEventListener('change', function () {
    pickerResolved = true;
    var file = input.files[0];
    document.body.removeChild(input);
    if (!file) { onPickerCancel(); return; }

    var reader = new FileReader();
    reader.onload = function (evt) {
      var snapshotJson = evt.target.result;
      try {
        var parsed = JSON.parse(snapshotJson);
        if (!parsed.BusinessObjectRights) throw new Error('BusinessObjectRights key missing -- is this a RolePolicy snapshot?');
        var boCount = Object.keys(parsed.BusinessObjectRights).length;
        var rcCount = parsed.BusinessObjectRowConditions ? Object.keys(parsed.BusinessObjectRowConditions).length : 0;
        console.log(LOG, 'Snapshot validated:', boCount, 'BOs,', rcCount, 'row conditions');
      } catch (err) { console.error(LOG, 'Invalid snapshot file:', err.message); return; }

      var customObjects = promptCustomObjects('Mode: SNAPSHOT\nFile: ' + file.name);
      var custCount = Object.keys(customObjects).length;
      if (custCount > 0) {
        var parsed2 = JSON.parse(snapshotJson);
        var custKeys = Object.keys(customObjects);
        for (var ci = 0; ci < custKeys.length; ci++) {
          var cbo = custKeys[ci];
          parsed2.BusinessObjectRights[cbo] = { Rights: customObjects[cbo], FieldRights: null, DefaultFieldRights: customObjects[cbo] > 0 ? 5 : null };
        }
        snapshotJson = JSON.stringify(parsed2);
        console.log(LOG, 'Custom objects merged into snapshot.');
      }

      installInterceptor(
        function (currentPolicy, roleId, ts) {
          console.log(LOG, 'Applying snapshot:', file.name, '(' + snapshotJson.length + ' chars)');
          return { policy: snapshotJson, replacedBy: file.name, mode: 'snapshot', customObjects: customObjects };
        },
        function (roleId, ts, result) { console.log(LOG, 'Snapshot applied. Pre-patcher files are your record of what changed.'); },
        [' Mode   : SNAPSHOT', ' File   : ' + file.name, ' Custom : ' + custCount]
      );
    };
    reader.onerror = function () { console.error(LOG, 'Failed to read file:', file.name); };
    reader.readAsText(file);
  });

  window.addEventListener('focus', function onFocus() {
    window.removeEventListener('focus', onFocus);
    setTimeout(function () { onPickerCancel(); }, 300);
  });

  console.log(LOG, 'File picker opening...');
  console.log(LOG, '  Pick a snapshot JSON  -->  Snapshot mode');
  console.log(LOG, '  Cancel                -->  Apply ' + roleConfigName + ' config');
  input.click();

})();