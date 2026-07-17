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
// AHPatcher v5 - Role Patcher
// Browser console script (not an ISM server-side Quick Action)
//
// Minimum set configurations are loaded from a GitHub repository rather
// than being hardcoded into the script. This means updating permissions no
// longer requires editing the script itself.
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
  // ROLE DETECTION VIA GetEditRole INTERCEPT
  // Document title / DOM scraping proved unreliable -- ISM's role editor page
  // title doesn't reliably contain the role name. The one reliable source is
  // the GetEditRole SOAP call ISM fires when an admin clicks a role name from
  // Settings > Roles and Permissions to open its editor: the request payload
  // is {"strRef":"<RoleName>","_csrfToken":"..."}. This hook is installed
  // immediately (before anything else runs) and stays live for the whole
  // session -- Settings pages in ISM swap panels via AJAX rather than full
  // page reloads, so if this script is pasted before clicking into a role
  // (or before switching to a different one), the click that follows will
  // still fire GetEditRole and get captured here.
  // ===========================================================================
  var networkDetectedRole  = null;
  var onNetworkRoleUpdate  = null; // set by Step 2 render to live-refresh the dropdown
  try {
    var _origInvokeForDetect = Sys.Net.WebServiceProxy.invoke;
    Sys.Net.WebServiceProxy.invoke = function (servicePath, methodName, useGet, params, onSuccess, onFailure, userContext, timeout, enableJsonp, jsonpCallbackParameter) {
      if (methodName === 'GetEditRole' && params && params.data && params.data.strRef) {
        networkDetectedRole = params.data.strRef;
        console.log(LOG, 'Detected role from GetEditRole call:', networkDetectedRole);
        if (typeof onNetworkRoleUpdate === 'function') onNetworkRoleUpdate(networkDetectedRole);
      }
      return _origInvokeForDetect.apply(this, [servicePath, methodName, useGet, params, onSuccess, onFailure, userContext, timeout, enableJsonp, jsonpCallbackParameter]);
    };
  } catch (_) {}

  // ===========================================================================
  // GITHUB CONFIG
  // ===========================================================================
  var GH_OWNER  = 'killer6oose';
  var GH_REPO   = 'ISM_Scripts';
  var GH_PATH   = 'Roles/MinPerms/2026.x';
  var GH_BRANCH = 'main';
  var GH_API    = 'https://api.github.com/repos/' + GH_OWNER + '/' + GH_REPO + '/contents/' + GH_PATH;
  var GH_RAW    = 'https://raw.githubusercontent.com/' + GH_OWNER + '/' + GH_REPO + '/' + GH_BRANCH + '/' + GH_PATH + '/';

  // Version check - script compares SCRIPT_VERSION against version.txt in the repo.
  // Create killer6oose/ISM_Scripts/Roles/MinPerms/version.txt containing just: 5.0.0
  // Update both that file and SCRIPT_VERSION here whenever publishing a new release.
  var SCRIPT_VERSION  = '5.6.0';
  var GH_VERSION_URL  = 'https://raw.githubusercontent.com/' + GH_OWNER + '/' + GH_REPO + '/' + GH_BRANCH + '/Roles/MinPerms/version.txt';
  // Link shown when the script is out of date.
  // Change this to any URL - defaults to a pre-filled email to request the latest version.
  // The mailto body is built dynamically in the version check step so it includes version numbers.
  var UPDATE_CONTACT_URL = 'mailto:andrew.hatton@ivanti.com';

  // Direct link to the Troubleshooting section of the README, printed to the
  // console after a successful patch run.
  var TROUBLESHOOTING_URL = 'https://github.com/' + GH_OWNER + '/' + GH_REPO +
    '/blob/' + GH_BRANCH + '/Roles/MinPerms/README.md#troubleshooting';

  // ---------------------------------------------------------------------------
  // GITHUB_PAT -- leave empty for a public repo (default).
  // For a private repo, create a fine-grained Personal Access Token scoped to
  // this repo with Contents: Read-only permission, then paste it here.
  // The token will be visible to anyone who can open devtools on this page,
  // so use a read-only token and set an expiry date.
  //   GitHub > Settings > Developer settings > Fine-grained personal access tokens
  // ---------------------------------------------------------------------------
  var GITHUB_PAT = '';

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
  // SYSTEM PERMISSIONS
  // Bit values below were reverse-engineered from live SaveRole captures
  // (2026-07-06) by toggling one checkbox at a time on a sandbox role and
  // diffing the resulting ModuleRights block:
  //   - "Create (for self)"  ORs/ANDs bits 2+4+8 (Add+Edit+Delete) on the User field
  //   - "Edit (for all)"     ORs/ANDs bits 2+4   (Add+Edit) on the Global field
  //   - "Delete (for all)"   ORs/ANDs bit 8      (Delete) on the Global field
  // Any other bit already on the role (e.g. a pre-existing View=1 on Search) is
  // left alone -- only the specific submask for each checkbox is toggled.
  // ===========================================================================
  var SYSPERM_CREATE_SELF_MASK = 14; // Add + Edit + Delete, for items the user owns
  var SYSPERM_EDIT_ALL_MASK    = 6;  // Add + Edit, for all items
  var SYSPERM_DELETE_ALL_MASK  = 8;  // Delete, for all items

  var SYSPERM_ROWS = [
    { key: 'Fusion.Security.AutoTasks',    label: 'Action'    },
    { key: 'Fusion.Security.SearchGroups', label: 'Search'    },
    { key: 'Orion.Security.Dashboards',    label: 'Dashboard' }
  ];

  // Publish targets shown in the "Allow publishing" section. gateKey is the
  // SYSPERM_ROWS key that must have Edit-for-all or Delete-for-all checked
  // before this target becomes editable. Reports has no checkbox row of its
  // own in ISM's System Permissions UI, so it is always editable (gateKey: null).
  var PUBLISH_TARGETS = [
    { key: 'Publish.QuickAction', label: 'Actions',    gateKey: 'Fusion.Security.AutoTasks'    },
    { key: 'Publish.Search',      label: 'Searches',   gateKey: 'Fusion.Security.SearchGroups' },
    { key: 'Publish.Dashboard',   label: 'Dashboards', gateKey: 'Orion.Security.Dashboards'    },
    { key: 'Publish.Report',      label: 'Reports',    gateKey: null }
  ];

  // Objects covered by the step 4 "Restrictive Object Permissions" alert.
  // "match" decides which row_conditions keys a "No" answer skips for that
  // object -- Journal# covers its extension objects (Journal#Email,
  // Journal#Notes, etc.) by prefix match since they carry the same
  // PublishToWeb restriction. Shared between the wizard UI (showWizard) and
  // the patch logic (buildRowConditions) so both stay in sync on what "No"
  // actually means.
  var ROW_CONDITION_OPT_GROUPS = [
    { key: 'Attachment#',      match: function (bo) { return bo === 'Attachment#'; } },
    { key: 'Journal#',         match: function (bo) { return bo.indexOf('Journal#') === 0; } },
    { key: 'ServiceReqParam#', match: function (bo) { return bo === 'ServiceReqParam#'; } }
  ];

  // Returns true if bo's row condition should be skipped this run because
  // the admin answered "No" in step 4 for the object group it belongs to.
  function isRowConditionOptedOut(bo, rcOptOuts) {
    if (!rcOptOuts) return false;
    for (var g = 0; g < ROW_CONDITION_OPT_GROUPS.length; g++) {
      var grp = ROW_CONDITION_OPT_GROUPS[g];
      if (grp.match(bo) && rcOptOuts.hasOwnProperty(grp.key) && rcOptOuts[grp.key] === false) {
        return true;
      }
    }
    return false;
  }

  // Convenience dropdown list captured from one tenant. Different client tenants
  // will have different role names -- this list is a starting point only. Free
  // text entry is always available in the wizard alongside it. Edit this array
  // directly if reusing the script against a tenant with a very different role set.
  var DEFAULT_ROLE_LIST = [
    'Admin','AdminAUSpark','AssetAdministratorAUSpark','AssetScanner','CallLogSelfService',
    'CallLogSupportDeskAnalyst','CallLogSupportDeskManager','ChangeManager','ConfigurationManager',
    'DiscoveryAnalyst','DiscoveryManager','FacilitiesAdministrator','FacilitiesAnalyst',
    'FacilitiesManager','FinanceManager','GRCAnalyst','GRCManager','Guests','HR Administrator',
    'HRAnalyst','HRManager','HRRecruiter','ivnt_AssetAdministrator','ivnt_AssetManager',
    'ivnt_AssetMobile','ivnt_ChiefInformationSecurityOfficer','ivnt_ContractManager',
    'ivnt_ProcurementManager','ivnt_SecurityAdministrator','ivnt_SecurityAnalyst',
    'ivnt_SecurityManager','ivnt_StorageManager','KnowledgeManager','Level 2 Analyst',
    'MobileAssetManager','nrn_DemandManager','PayrollManager','PortfolioManager','ProblemManager',
    'ProjectManager','ReleaseManager','ReportManager','ResponsiveAnalyst','SelfService',
    'SelfServiceDirect','SelfServiceDirectV3','SelfServiceFM','SelfServiceFMV3','SelfServiceHR',
    'SelfServiceHRV3','SelfServiceIT','SelfServiceITV3','SelfServiceMobile','SelfServicePreview',
    'SelfServiceSecOpsV3','SelfServiceSecurityOperations','ServiceDeskAnalyst','ServiceDeskAUSpark',
    'ServiceDeskManager','ServiceOwner'
  ];

  var ALL_ROLES_SENTINEL = 'ALL_ROLES';

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

    // Pattern 0: GetEditRole network capture (see hook near top of file) --
    // by far the most reliable source since it's the exact strRef ISM itself
    // uses to load the role, not a scraped label.
    if (networkDetectedRole) return networkDetectedRole;

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

  // Returns the correct Authorization header set for the configured access mode.
  // When GITHUB_PAT is empty the Accept header alone is returned (public repo).
  function ghHeaders() {
    var h = { Accept: 'application/vnd.github.v3+json' };
    if (GITHUB_PAT) h['Authorization'] = 'Bearer ' + GITHUB_PAT;
    return h;
  }

  // Decodes the base64-encoded file content that the GitHub Contents API returns.
  function decodeGHContent(b64) {
    return atob(b64.replace(/\n/g, ''));
  }

  // Builds the URL used to fetch an individual config file.
  // Public mode: raw.githubusercontent.com (plain JSON response).
  // Private mode: api.github.com/contents (base64-encoded JSON in response.content).
  function buildFileUrl(filename) {
    if (GITHUB_PAT) {
      return 'https://api.github.com/repos/' + GH_OWNER + '/' + GH_REPO +
             '/contents/' + GH_PATH + '/' + filename;
    }
    return GH_RAW + encodeURIComponent(filename);
  }

  async function fetchRoleList() {
    var resp = await fetch(GH_API, { headers: ghHeaders() });
    if (!resp.ok) throw new Error('GitHub API returned ' + resp.status + ' for ' + GH_PATH);
    var files = await resp.json();
    return files
      .filter(function (f) { return f.type === 'file' && /\.json$/i.test(f.name); })
      .map(function (f) {
        return {
          name    : f.name,
          roleName: f.name.replace(/\.json$/i, ''),
          // Private mode: use the API url (f.url) so auth header can be applied.
          // Public mode:  use download_url (raw githubusercontent, no auth needed).
          rawUrl  : GITHUB_PAT ? f.url : f.download_url
        };
      });
  }

  async function fetchRoleConfig(url) {
    var resp = await fetch(url, { headers: ghHeaders() });
    if (resp.status === 404) throw new Error('not_found');
    if (!resp.ok) throw new Error('HTTP ' + resp.status);

    var config;
    // The GitHub Contents API wraps file data in JSON with a base64 'content' field.
    // A raw URL returns the file directly as JSON -- detect which we have by checking
    // for the presence of 'api.github.com' in the URL or a non-empty PAT.
    if (GITHUB_PAT || url.indexOf('api.github.com') !== -1) {
      var wrapper = await resp.json();
      config = JSON.parse(decodeGHContent(wrapper.content));
    } else {
      config = await resp.json();
    }

    if (!config.business_object_rights || typeof config.business_object_rights !== 'object') {
      throw new Error('"business_object_rights" key missing -- is this an AHPatcher config file?');
    }
    return config;
  }


  // ===========================================================================
  // WIZARD
  // Single 4-step modal: version check, role config, mode selection, overrides.
  // Replaces showRoleModal and promptCustomObjects.
  // ===========================================================================

  async function fetchLatestVersion() {
    // Private mode: use the Contents API so the auth header can be applied.
    // Public mode:  fetch version.txt directly from raw.githubusercontent.com.
    if (GITHUB_PAT) {
      var apiUrl = 'https://api.github.com/repos/' + GH_OWNER + '/' + GH_REPO +
                   '/contents/Roles/MinPerms/version.txt';
      var resp = await fetch(apiUrl, { cache: 'no-store', headers: ghHeaders() });
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      var data = await resp.json();
      return decodeGHContent(data.content).trim();
    }
    var resp = await fetch(GH_VERSION_URL, { cache: 'no-store' });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    return (await resp.text()).trim();
  }

  function compareVersions(a, b) {
    // Returns 1 if a > b, -1 if a < b, 0 if equal
    var ap = a.split('.').map(Number);
    var bp = b.split('.').map(Number);
    for (var i = 0; i < Math.max(ap.length, bp.length); i++) {
      var av = ap[i] || 0, bv = bp[i] || 0;
      if (av > bv) return  1;
      if (av < bv) return -1;
    }
    return 0;
  }

  function showWizard(initialDetectedRole, roleFiles) {
    return new Promise(function (resolve) {

      // Reassignable copy -- the GetEditRole hook (top of file) can still
      // fire after the wizard is already open (e.g. this script was pasted
      // from the role list before clicking into a role), so renderStep2
      // registers onNetworkRoleUpdate to refresh this and itself live.
      var detectedRole = initialDetectedRole;

      var STEP_LABELS = ['Version', 'Role Config', 'Mode', 'Notice', 'Overrides', 'Sys Perms'];
      var TOTAL_STEPS = 6;

      var wState = {
        step: 1,
        versionOk: null, latestVersion: null,
        roleConfig: null, roleConfigName: null,
        mode: 'config',
        snapshotJson: null, snapshotFileName: null,
        customObjects: {},
        sysPerms: {
          'Fusion.Security.AutoTasks':    { createSelf: false, editAll: false, deleteAll: false },
          'Fusion.Security.SearchGroups': { createSelf: true,  editAll: false, deleteAll: false },
          'Orion.Security.Dashboards':    { createSelf: false, editAll: false, deleteAll: false }
        },
        publishRoles: {
          'Publish.QuickAction': [], 'Publish.Search': [], 'Publish.Dashboard': [], 'Publish.Report': []
        },
        downloadRights: false,     // "Allow Microsoft Excel download from saved searches"
        emailSearchRights: false,  // "Allow email to yourself from saved searches"
        // Step 4 (Restrictive Object Permissions) - whether to apply the
        // built-in row condition for each object. true = apply (default),
        // false = skip that object's row condition entirely this run.
        rowConditionOptOuts: {
          'Attachment#':       true,
          'Journal#':          true,
          'ServiceReqParam#':  true
        }
      };

      var CLR = {
        navy: '#1F3864', blue: '#2E75B6', green: '#375623',
        orange: '#C55A11', grey: '#BFBFBF', white: '#FFFFFF',
        f5: '#F5F5F5', border: '#E0E0E0',
        bgblue: '#DEEAF1', bggreen: '#E2EFDA', bgorange: '#FCE4D6', bgyellow: '#FFF2CC'
      };

      // ---- DOM helpers ----
      function el(tag, cssText, txt) {
        var e = document.createElement(tag);
        if (cssText) e.style.cssText = cssText;
        if (txt !== undefined) e.textContent = txt;
        return e;
      }

      // ---- Overlay + persistent modal structure ----
      var overlay = el('div',
        'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.65);' +
        'z-index:999998;display:flex;align-items:center;justify-content:center;' +
        'font-family:Arial,Helvetica,sans-serif;');
      overlay.id = 'ahp-wiz';

      var modal = el('div',
        'background:#fff;border-radius:6px;width:540px;max-width:92vw;' +
        'box-shadow:0 8px 40px rgba(0,0,0,0.35);z-index:999999;overflow:hidden;' +
        'display:flex;flex-direction:column;max-height:90vh;');

      // Header (title + step indicator)
      var hdrEl = el('div', 'background:' + CLR.navy + ';padding:16px 20px 0;flex-shrink:0;');
      var hTitle = el('div',
        'color:#fff;font-size:15px;font-weight:bold;margin-bottom:14px;', 'AHPatcher v' + SCRIPT_VERSION);
      var stepBar = el('div', 'display:flex;align-items:center;');
      hdrEl.appendChild(hTitle);
      hdrEl.appendChild(stepBar);

      // Body
      var bodyEl = el('div', 'padding:20px;overflow-y:auto;flex:1;min-height:160px;');

      // Footer
      var footerEl = el('div',
        'display:flex;gap:10px;justify-content:flex-end;padding:14px 20px;' +
        'background:' + CLR.f5 + ';border-top:1px solid ' + CLR.border + ';flex-shrink:0;');

      modal.appendChild(hdrEl);
      modal.appendChild(bodyEl);
      modal.appendChild(footerEl);
      overlay.appendChild(modal);
      document.body.appendChild(overlay);

      function cleanup() { if (document.body.contains(overlay)) document.body.removeChild(overlay); }
      function clearBody() { while (bodyEl.firstChild) bodyEl.removeChild(bodyEl.firstChild); }
      function clearFooter() { while (footerEl.firstChild) footerEl.removeChild(footerEl.firstChild); }

      // ---- Step indicator ----
      function renderStepBar(current) {
        while (stepBar.firstChild) stepBar.removeChild(stepBar.firstChild);
        for (var i = 0; i < TOTAL_STEPS; i++) {
          var n = i + 1, done = n < current, active = n === current;
          var wrap = el('div', 'display:flex;flex-direction:column;align-items:center;gap:3px;');
          var bubble = el('div',
            'width:28px;height:28px;border-radius:50%;display:flex;align-items:center;' +
            'justify-content:center;font-size:12px;font-weight:bold;flex-shrink:0;' +
            (done   ? 'background:#375623;color:#fff;border:2px solid #375623;' :
             active ? 'background:#fff;color:#1F3864;border:2px solid #fff;' :
                      'background:transparent;color:rgba(255,255,255,0.35);border:2px solid rgba(255,255,255,0.25);'),
            done ? '✓' : String(n));
          var lbl = el('div',
            'font-size:10px;white-space:nowrap;margin-bottom:8px;' +
            (done ? 'color:rgba(255,255,255,0.65);' : active ? 'color:#fff;font-weight:bold;' : 'color:rgba(255,255,255,0.3);'),
            STEP_LABELS[i]);
          wrap.appendChild(bubble); wrap.appendChild(lbl);
          stepBar.appendChild(wrap);
          if (i < TOTAL_STEPS - 1) {
            stepBar.appendChild(el('div',
              'flex:1;height:2px;margin-bottom:20px;margin:0 4px 20px;' +
              (done ? 'background:#375623;' : 'background:rgba(255,255,255,0.18);'), ''));
          }
        }
      }

      // ---- Shared UI atoms ----
      function mkBtn(txt, primary, disabled) {
        var b = el('button', '', txt);
        b.style.cssText =
          'padding:9px ' + (primary ? '22px' : '18px') + ';border-radius:4px;font-size:13px;' +
          'cursor:' + (disabled ? 'not-allowed' : 'pointer') + ';opacity:' + (disabled ? '0.5' : '1') + ';' +
          'font-family:Arial,sans-serif;font-weight:' + (primary ? 'bold' : 'normal') + ';' +
          (primary ? 'background:#2E75B6;color:#fff;border:none;'
                   : 'background:#fff;color:#595959;border:1px solid #BFBFBF;');
        b.disabled = !!disabled;
        return b;
      }

      function abortBtn() {
        var b = mkBtn('Abort', false);
        b.addEventListener('click', function () { cleanup(); resolve(null); });
        return b;
      }

      function notice(html, type) {
        var C = { info: [CLR.bgblue, CLR.blue, CLR.navy],
                  warn: ['#FFF2CC', '#BF8F00', '#7F5A00'],
                  error:[CLR.bgorange, CLR.orange, '#833C00'],
                  success:[CLR.bggreen, CLR.green, '#375623'] }[type] || [CLR.bgblue, CLR.blue, CLR.navy];
        var d = el('div',
          'background:' + C[0] + ';border-left:4px solid ' + C[1] + ';color:' + C[2] + ';' +
          'padding:9px 12px;font-size:12px;border-radius:0 4px 4px 0;margin-bottom:10px;');
        d.innerHTML = html;
        return d;
      }

      function lbl(txt) {
        return el('label',
          'display:block;font-size:12px;font-weight:bold;color:#404040;margin:12px 0 4px;', txt);
      }

      function textInp(ph, val) {
        var i = el('input',
          'width:100%;padding:8px 10px;border:1px solid #BFBFBF;border-radius:4px;font-size:13px;' +
          'color:#1F1F1F;background:#fff;box-sizing:border-box;font-family:Arial,sans-serif;');
        i.type = 'text'; i.placeholder = ph || ''; i.value = val || '';
        return i;
      }

      function chkInp(checked) {
        var i = document.createElement('input');
        i.type = 'checkbox'; i.checked = !!checked;
        i.style.cssText = 'width:16px;height:16px;cursor:pointer;';
        return i;
      }

      // Small "?" circle that reveals a dark hover tooltip. Used to tuck the
      // "where to adjust this manually in ISM" instructions out of the way so
      // the step 4 alert cards don't get overwhelming with three objects on
      // screen at once.
      function helpIcon(tooltipHtml) {
        var wrap = el('span', 'position:relative;display:inline-block;margin-left:6px;vertical-align:middle;');
        var icon = el('span',
          'display:inline-flex;align-items:center;justify-content:center;width:15px;height:15px;' +
          'border-radius:50%;background:' + CLR.grey + ';color:#fff;font-size:10px;font-weight:bold;' +
          'cursor:help;line-height:1;user-select:none;', '?');
        // Anchored to the icon's LEFT edge (not centered) and opening DOWNWARD,
        // so it can't extend past the modal's left edge or overlap the notice
        // banner above the cards -- the modal itself has overflow:hidden, so
        // anything that goes outside its box gets silently clipped rather than
        // just looking odd, which is what centering on a 15px icon caused.
        var tip = el('div',
          'display:none;position:absolute;top:22px;left:0;' +
          'width:230px;max-width:80vw;background:' + CLR.navy + ';color:#fff;font-size:11px;line-height:1.6;' +
          'padding:8px 10px;border-radius:4px;box-shadow:0 4px 14px rgba(0,0,0,0.3);z-index:20;' +
          'font-weight:normal;text-align:left;');
        tip.innerHTML = tooltipHtml;
        icon.addEventListener('mouseenter', function () { tip.style.display = 'block'; });
        icon.addEventListener('mouseleave', function () { tip.style.display = 'none'; });
        wrap.appendChild(icon);
        wrap.appendChild(tip);
        return wrap;
      }

      // Two-state "Yes / No" pill toggle, styled like a segmented control.
      // Used on step 4 so the admin can opt a specific object out of having
      // its row condition applied this run, without unchecking anything.
      function yesNoPills(defaultYes, onChange) {
        var wrap = el('div',
          'display:inline-flex;border:1px solid ' + CLR.border + ';border-radius:14px;overflow:hidden;flex-shrink:0;');
        var yesBtn = el('button', '', 'Yes');
        var noBtn  = el('button', '', 'No');
        [yesBtn, noBtn].forEach(function (b) {
          b.type = 'button';
          b.style.cssText = 'padding:4px 14px;font-size:11px;font-weight:bold;border:none;' +
            'cursor:pointer;font-family:Arial,sans-serif;background:#fff;color:#595959;';
        });
        var current = !!defaultYes;
        function refresh() {
          yesBtn.style.background = current ? CLR.green  : '#fff';
          yesBtn.style.color      = current ? '#fff'      : '#595959';
          noBtn.style.background  = !current ? CLR.orange : '#fff';
          noBtn.style.color       = !current ? '#fff'     : '#595959';
        }
        yesBtn.addEventListener('click', function () { current = true;  refresh(); onChange(true); });
        noBtn.addEventListener('click',  function () { current = false; refresh(); onChange(false); });
        refresh();
        wrap.appendChild(yesBtn); wrap.appendChild(noBtn);
        return wrap;
      }

      // Wizard-side display text for the step 4 alert cards. The "key" here
      // matches ROW_CONDITION_OPT_GROUPS (defined at script scope) which
      // owns the actual filtering logic used by buildRowConditions -- kept
      // in one place so the wizard's Yes/No answer and the patch behavior
      // can never drift out of sync.
      var STEP4_OBJECTS = [
        {
          key: 'Attachment#',
          label: 'Attachment#',
          blurb: 'Restriction: the user can only see and edit attachments they themselves uploaded.',
          help: 'Admin UI &rsaquo; Users and Permissions &rsaquo; Roles and Permissions &rsaquo; ' +
                '[role] &rsaquo; Attachment &rsaquo; Edit Access Permissions'
        },
        {
          key: 'Journal#',
          label: 'Journal# (including extension objects)',
          blurb: 'Restriction: to limit potentially unintentional information exposure in notes/emails, ' +
                 'permissions require PublishToWeb = true. There may still be journals published to web ' +
                 'that the user will technically have access to via the API.',
          help: 'Admin UI &rsaquo; Users and Permissions &rsaquo; Roles and Permissions &rsaquo; ' +
                '[role] &rsaquo; Journal &rsaquo; Edit Access Permissions'
        },
        {
          key: 'ServiceReqParam#',
          label: 'ServiceReqParam#',
          blurb: 'Restriction: the user will not be able to see a Service Request in the portal if they ' +
                 'were not the user who submitted the request.',
          help: 'Admin UI &rsaquo; Users and Permissions &rsaquo; Roles and Permissions &rsaquo; ' +
                '[role] &rsaquo; ServiceReqParam &rsaquo; Edit Access Permissions'
        }
      ];

      function selEl(opts, defVal) {
        var s = el('select',
          'width:100%;padding:8px 10px;border:1px solid #BFBFBF;border-radius:4px;font-size:13px;' +
          'color:#1F1F1F;background:#fff;box-sizing:border-box;font-family:Arial,sans-serif;');
        opts.forEach(function (o) {
          var opt = document.createElement('option');
          opt.value = o.v; opt.textContent = o.l;
          if (o.v === defVal) opt.selected = true;
          s.appendChild(opt);
        });
        return s;
      }

      // ============================================================
      // STEP 1 - VERSION CHECK
      // ============================================================
      async function renderStep1() {
        renderStepBar(1); clearBody(); clearFooter();
        var h = el('p', 'font-size:13px;font-weight:bold;color:#1F3864;margin:0 0 8px;',
                   'Checking for updates…');
        bodyEl.appendChild(h);

        // Start with Next disabled while the fetch is in flight.
        // enableBtn() corrects both the HTML attribute and the inline opacity/cursor
        // that mkBtn bakes in at creation time.
        var nextBtn = mkBtn('Next ›', true, true);
        nextBtn.addEventListener('click', function () { goToStep(2); });
        footerEl.appendChild(abortBtn()); footerEl.appendChild(nextBtn);

        function enableBtn(btn, label) {
          btn.disabled      = false;
          btn.style.opacity = '1';
          btn.style.cursor  = 'pointer';
          if (label) btn.textContent = label;
        }

        try {
          wState.latestVersion = await fetchLatestVersion();
          var cmp = compareVersions(wState.latestVersion, SCRIPT_VERSION);
          wState.versionOk = (cmp <= 0);
          clearBody();

          if (wState.versionOk) {
            h.textContent = 'Version check passed';
            bodyEl.appendChild(h);
            bodyEl.appendChild(notice(
              '<strong>You are running the latest version</strong> (v' + SCRIPT_VERSION + ').', 'success'));
            enableBtn(nextBtn);
            setTimeout(function () { if (document.body.contains(overlay)) goToStep(2); }, 1200);

          } else {
            h.textContent = 'Update available';
            bodyEl.appendChild(h);
            bodyEl.appendChild(notice(
              '<strong>A newer version is available: v' + wState.latestVersion + '</strong><br>' +
              'You are running v' + SCRIPT_VERSION + '. Using the latest version is recommended ' +
              'but you can continue with the current version.', 'warn'));

            // Build a pre-filled mailto so the user can request the latest script in one click
            var mailSubject = encodeURIComponent('AHPatcher Script Update Request');
            var mailBody    = encodeURIComponent(
              'Hi Andrew,\n\n' +
              'I am currently running AHPatcher v' + SCRIPT_VERSION + ' and see that ' +
              'v' + wState.latestVersion + ' is available.\n\n' +
              'Could you please send me the latest version of the script?\n\n' +
              'Regards,');
            var contactHref = UPDATE_CONTACT_URL +
              '?subject=' + mailSubject + '&body=' + mailBody;

            var a = el('a', 'color:#2E75B6;font-size:12px;display:block;margin-top:8px;',
                       'Request latest version ✉');
            a.href = contactHref;
            bodyEl.appendChild(a);

            // Always allow continuing - user is not forced to update
            enableBtn(nextBtn, 'Continue with current version ›');
          }

        } catch (e) {
          clearBody();
          bodyEl.appendChild(notice(
            'Could not check for updates (v' + SCRIPT_VERSION + ' assumed current). Continuing.', 'info'));
          enableBtn(nextBtn);
          setTimeout(function () { if (document.body.contains(overlay)) goToStep(2); }, 900);
        }
      }

      // ============================================================
      // STEP 2 - ROLE CONFIG
      // ============================================================
      function renderStep2() {
        renderStepBar(2); clearBody(); clearFooter();

        // If the GetEditRole click hasn't fired yet when this step first
        // renders (script pasted mid-navigation), pick it up the moment it
        // does -- but only while the user hasn't already picked/typed/loaded
        // something themselves, so a late-arriving detection never clobbers
        // a choice already in progress.
        onNetworkRoleUpdate = function (roleName) {
          if (wState.step !== 2) return;
          if (wState.roleConfig) return;
          if (custInp && custInp.value.trim().length > 0) return;
          detectedRole = roleName;
          renderStep2();
        };

        var matched = null;
        if (detectedRole) {
          for (var i = 0; i < roleFiles.length; i++) {
            if (roleFiles[i].roleName.toLowerCase() === detectedRole.toLowerCase()) {
              matched = roleFiles[i]; break;
            }
          }
          bodyEl.appendChild(notice(
            '<strong>Detected role:</strong> ' + detectedRole +
            (matched ? ' – matching config found and pre-selected.'
                     : ' – no matching file found. Select below or enter a filename.'),
            matched ? 'info' : 'warn'));
        }

        bodyEl.appendChild(lbl(roleFiles.length > 0
          ? 'Select from available configurations:' : 'No configuration files found in repo.'));

        var selOpts = [{ v: '', l: '-- select a role --' }];
        roleFiles.forEach(function (f) { selOpts.push({ v: f.rawUrl, l: f.roleName }); });
        var sel2 = selEl(selOpts, matched ? matched.rawUrl : '');
        bodyEl.appendChild(sel2);

        bodyEl.appendChild(lbl('Or enter a filename manually (without .json), or import a local file:'));
        var custRow = el('div', 'display:flex;gap:8px;align-items:center;');
        var custInp = textInp('e.g. GRCManager  –  takes precedence over the dropdown above', '');
        custInp.style.flex = '1';
        var browseBtn = el('button',
          'padding:8px 14px;background:#fff;color:' + CLR.blue + ';border:1px solid ' + CLR.blue + ';' +
          'border-radius:4px;font-size:12px;font-weight:bold;cursor:pointer;white-space:nowrap;' +
          'font-family:Arial,sans-serif;', 'Browse…');
        custRow.appendChild(custInp); custRow.appendChild(browseBtn);
        bodyEl.appendChild(custRow);

        var fileInput = document.createElement('input');
        fileInput.type = 'file'; fileInput.accept = '.json,application/json';
        fileInput.style.display = 'none';
        document.body.appendChild(fileInput);
        browseBtn.addEventListener('click', function () { fileInput.click(); });

        var statusEl = el('p', 'font-size:12px;color:#595959;min-height:16px;margin-top:8px;', '');
        bodyEl.appendChild(statusEl);

        // Filled in only when the loaded config has "ready": false at the top
        // of its JSON -- see the "ready" field note in the README.
        var notReadyBox = el('div', 'margin-top:8px;');
        bodyEl.appendChild(notReadyBox);

        // Once a config with "ready": false has been loaded and the warning
        // shown, the button's job switches from "fetch" to "proceed anyway"
        // so clicking it again doesn't just re-fetch and re-show the same
        // warning in a loop.
        var awaitingNotReadyConfirm = false;

        var nextBtn = mkBtn('Load Config ›', true, false);

        // Shared by both the GitHub fetch path and the local-file-import path
        // so the "ready" check and the auto-advance/pause behavior can never
        // drift apart between the two ways of getting a config into wState.
        function applyLoadedConfig(cfg, displayName) {
          wState.roleConfig     = cfg;
          wState.roleConfigName = cfg.role || displayName;
          statusEl.style.color  = CLR.green;
          statusEl.textContent  = 'Loaded: ' + wState.roleConfigName + ' – ' +
            Object.keys(cfg.business_object_rights || {}).length + ' BOs';

          while (notReadyBox.firstChild) notReadyBox.removeChild(notReadyBox.firstChild);

          // "ready" is optional in the config JSON; missing/omitted is
          // treated as ready (true) so existing configs keep working
          // unchanged. Only an explicit "ready": false pauses the wizard.
          if (cfg.ready === false) {
            notReadyBox.appendChild(notice(
              'This role\'s object permissions may not be fully ready yet. Some functionality may ' +
              'not be working as expected.',
              'warn'));
            awaitingNotReadyConfirm = true;
            nextBtn.textContent = 'Continue anyway ›'; nextBtn.disabled = false;
          } else {
            awaitingNotReadyConfirm = false;
            nextBtn.textContent = 'Load Config ›'; nextBtn.disabled = false;
            setTimeout(function () {
              if (document.body.contains(fileInput)) document.body.removeChild(fileInput);
              goToStep(3);
            }, 500);
          }
        }

        nextBtn.addEventListener('click', async function () {
          if (awaitingNotReadyConfirm) {
            if (document.body.contains(fileInput)) document.body.removeChild(fileInput);
            goToStep(3);
            return;
          }

          var customName = custInp.value.trim();
          var rawUrl = customName
            ? buildFileUrl(/\.json$/i.test(customName) ? customName : customName + '.json')
            : sel2.value;
          if (!rawUrl) {
            statusEl.style.color = CLR.orange;
            statusEl.textContent = 'Select a role, enter a filename, or browse for a local file.'; return;
          }
          nextBtn.textContent = 'Loading…'; nextBtn.disabled = true;
          statusEl.style.color = '#595959'; statusEl.textContent = 'Fetching from GitHub…';
          while (notReadyBox.firstChild) notReadyBox.removeChild(notReadyBox.firstChild);
          try {
            var cfg = await fetchRoleConfig(rawUrl);
            applyLoadedConfig(cfg, customName || rawUrl.split('/').pop().replace(/\.json$/i, ''));
          } catch (e) {
            nextBtn.textContent = 'Load Config ›'; nextBtn.disabled = false;
            statusEl.style.color = CLR.orange;
            statusEl.textContent = e.message === 'not_found'
              ? 'File not found. Check the name and try again.' : 'Error: ' + e.message;
          }
        });

        // Local file import -- reads a role config JSON straight off disk
        // instead of fetching it from GitHub. Runs through the same
        // validation fetchRoleConfig() applies (business_object_rights must
        // be present) and the same applyLoadedConfig() path as a GitHub fetch.
        fileInput.addEventListener('change', function () {
          var f = fileInput.files[0];
          fileInput.value = ''; // allow re-picking the same file later
          if (!f) return;
          statusEl.style.color = '#595959'; statusEl.textContent = 'Reading ' + f.name + '…';
          while (notReadyBox.firstChild) notReadyBox.removeChild(notReadyBox.firstChild);
          var reader = new FileReader();
          reader.onload = function (evt) {
            try {
              var parsed = JSON.parse(evt.target.result);

              // The file most users will actually have on disk is the
              // pre-patcher/Interceptor snapshot (raw ISM RolePolicy --
              // capitalized BusinessObjectRights, ModuleRights, etc.), not an
              // AHPatcher role config (lowercase business_object_rights).
              // Rather than reject that as invalid, detect the shape and
              // route straight into snapshot-restore mode -- it's exactly
              // the file Step 3's snapshot picker expects, so there's no
              // reason to bounce the user back to pick a different button.
              if (parsed.BusinessObjectRights && typeof parsed.BusinessObjectRights === 'object') {
                wState.snapshotJson     = evt.target.result;
                wState.snapshotFileName = f.name;
                wState.mode             = 'snapshot';
                statusEl.style.color = CLR.green;
                statusEl.textContent = 'Loaded snapshot: ' + f.name + ' (' +
                  Object.keys(parsed.BusinessObjectRights).length + ' BOs) - skipping to mode selection';
                console.log(LOG, 'Browsed file is a RolePolicy snapshot, not a config -- routing to snapshot-restore mode.');
                setTimeout(function () {
                  if (document.body.contains(fileInput)) document.body.removeChild(fileInput);
                  goToStep(3);
                }, 500);
                return;
              }

              if (!parsed.business_object_rights || typeof parsed.business_object_rights !== 'object') {
                throw new Error('"business_object_rights" key missing -- is this an AHPatcher config file?');
              }
              custInp.value = '';
              applyLoadedConfig(parsed, f.name.replace(/\.json$/i, ''));
            } catch (e) {
              statusEl.style.color = CLR.orange;
              statusEl.textContent = 'Invalid file: ' + e.message;
            }
          };
          reader.onerror = function () {
            statusEl.style.color = CLR.orange;
            statusEl.textContent = 'Could not read ' + f.name + '.';
          };
          reader.readAsText(f);
        });

        // Changing the selection after a not-ready warning was shown should
        // reset the button back to fetch mode for the newly picked file.
        sel2.addEventListener('change', function () {
          if (awaitingNotReadyConfirm) {
            awaitingNotReadyConfirm = false;
            nextBtn.textContent = 'Load Config ›';
            while (notReadyBox.firstChild) notReadyBox.removeChild(notReadyBox.firstChild);
          }
        });
        custInp.addEventListener('input', function () {
          if (awaitingNotReadyConfirm) {
            awaitingNotReadyConfirm = false;
            nextBtn.textContent = 'Load Config ›';
            while (notReadyBox.firstChild) notReadyBox.removeChild(notReadyBox.firstChild);
          }
        });

        custInp.addEventListener('keydown', function (e) { if (e.key === 'Enter') nextBtn.click(); });

        var backBtn = mkBtn('‹ Back', false);
        backBtn.addEventListener('click', function () {
          if (document.body.contains(fileInput)) document.body.removeChild(fileInput);
          goToStep(1);
        });
        footerEl.appendChild(abortBtn()); footerEl.appendChild(backBtn); footerEl.appendChild(nextBtn);
      }

      // ============================================================
      // STEP 3 - MODE SELECTION
      // ============================================================
      function renderStep3() {
        renderStepBar(3); clearBody(); clearFooter();

        bodyEl.appendChild(el('p', 'font-size:12px;color:#595959;margin:0 0 14px;',
          'Apply the loaded config, or restore a previously saved snapshot?'));

        // Card builder
        function card(iconChar, title, desc, accentColor, bgColor) {
          var c = el('div',
            'border:2px solid ' + CLR.border + ';border-radius:6px;padding:14px 16px;cursor:pointer;' +
            'margin-bottom:10px;display:flex;gap:12px;align-items:flex-start;background:#fff;');
          var ico = el('div', 'font-size:22px;flex-shrink:0;color:' + accentColor + ';padding-top:1px;', iconChar);
          var wrap = el('div', 'flex:1;');
          wrap.appendChild(el('div', 'font-size:13px;font-weight:bold;color:#1F3864;margin-bottom:4px;', title));
          wrap.appendChild(el('div', 'font-size:12px;color:#595959;line-height:1.5;', desc));
          c.appendChild(ico); c.appendChild(wrap);
          c.addEventListener('mouseenter', function () {
            if (!c._sel) { c.style.borderColor = accentColor; c.style.background = bgColor; }
          });
          c.addEventListener('mouseleave', function () {
            if (!c._sel) { c.style.borderColor = CLR.border; c.style.background = '#fff'; }
          });
          c._accentColor = accentColor; c._bgColor = bgColor;
          return c;
        }

        var cfgCard = card('⚙', 'Apply Config: ' + (wState.roleConfigName || 'loaded config'),
          'Replaces all current permissions with the loaded configuration. This is the standard patching path.',
          CLR.blue, CLR.bgblue);

        var snapCard = card('⏳', 'Restore from Snapshot',
          'Apply a previously saved RolePolicy JSON. Useful for rolling back or copying permissions from another role.',
          CLR.green, CLR.bggreen);

        // File zone (shown only when snapshot selected)
        var fileZone = el('div',
          'display:none;border:2px dashed ' + CLR.grey + ';border-radius:6px;' +
          'padding:16px;text-align:center;margin-top:-4px;margin-bottom:10px;background:#FAFAFA;');
        fileZone.appendChild(el('p', 'font-size:12px;color:#595959;margin:0 0 8px;',
          'Select a snapshot JSON file captured by AHPatcher-Interceptor'));
        var filePickBtn = el('button',
          'padding:7px 16px;background:' + CLR.green + ';color:#fff;border:none;border-radius:4px;' +
          'font-size:12px;cursor:pointer;font-family:Arial,sans-serif;', 'Choose File');
        var fileInfo = el('p', 'font-size:11px;color:#595959;margin:8px 0 0;min-height:14px;', '');
        fileZone.appendChild(filePickBtn); fileZone.appendChild(fileInfo);

        var hiddenInput = document.createElement('input');
        hiddenInput.type = 'file'; hiddenInput.accept = '.json,application/json';
        hiddenInput.style.display = 'none'; document.body.appendChild(hiddenInput);

        filePickBtn.addEventListener('click', function () { hiddenInput.click(); });
        hiddenInput.addEventListener('change', function () {
          var f = hiddenInput.files[0]; if (!f) return;
          var reader = new FileReader();
          reader.onload = function (evt) {
            try {
              var parsed = JSON.parse(evt.target.result);
              if (!parsed.BusinessObjectRights) throw new Error('Missing BusinessObjectRights');
              wState.snapshotJson     = evt.target.result;
              wState.snapshotFileName = f.name;
              fileInfo.style.color    = CLR.green;
              fileInfo.textContent    = '✓ ' + f.name + ' (' +
                Object.keys(parsed.BusinessObjectRights).length + ' BOs)';
              nextBtn.disabled = false;
            } catch (e) {
              wState.snapshotJson = null;
              fileInfo.style.color = CLR.orange;
              fileInfo.textContent = 'Invalid file: ' + e.message;
              nextBtn.disabled = true;
            }
          };
          reader.readAsText(f);
        });

        function selectMode(mode) {
          wState.mode = mode;
          cfgCard._sel  = (mode === 'config');
          snapCard._sel = (mode === 'snapshot');
          cfgCard.style.borderColor  = mode === 'config'   ? CLR.blue  : CLR.border;
          cfgCard.style.background   = mode === 'config'   ? CLR.bgblue : '#fff';
          snapCard.style.borderColor = mode === 'snapshot' ? CLR.green : CLR.border;
          snapCard.style.background  = mode === 'snapshot' ? CLR.bggreen : '#fff';
          fileZone.style.display = mode === 'snapshot' ? 'block' : 'none';
          nextBtn.disabled = (mode === 'snapshot' && !wState.snapshotJson);
        }

        cfgCard.addEventListener('click', function ()  { selectMode('config');   nextBtn.disabled = false; });
        snapCard.addEventListener('click', function ()  { selectMode('snapshot'); });
        bodyEl.appendChild(cfgCard); bodyEl.appendChild(snapCard); bodyEl.appendChild(fileZone);

        var nextBtn = mkBtn('Next ›', true, false);
        nextBtn.addEventListener('click', function () {
          if (document.body.contains(hiddenInput)) document.body.removeChild(hiddenInput);
          goToStep(4);   // -> Attachment notice
        });

        // If Step 2's Browse button already loaded a snapshot file (the user
        // picked a pre-patcher/Interceptor capture instead of a role config),
        // wState.snapshotJson/snapshotFileName/mode arrive here pre-filled --
        // reflect that in the UI instead of defaulting back to config mode.
        if (wState.mode === 'snapshot' && wState.snapshotJson) {
          selectMode('snapshot');
          try {
            var preParsed = JSON.parse(wState.snapshotJson);
            fileInfo.style.color = CLR.green;
            fileInfo.textContent = '✓ ' + wState.snapshotFileName + ' (' +
              Object.keys(preParsed.BusinessObjectRights || {}).length + ' BOs)';
          } catch (_) {}
          nextBtn.disabled = false;
        } else {
          selectMode('config');
        }

        var backBtn = mkBtn('‹ Back', false);
        backBtn.addEventListener('click', function () {
          if (document.body.contains(hiddenInput)) document.body.removeChild(hiddenInput);
          goToStep(2);
        });
        footerEl.appendChild(abortBtn()); footerEl.appendChild(backBtn); footerEl.appendChild(nextBtn);
      }

      // ============================================================
      // STEP 4 - RESTRICTIVE OBJECT PERMISSIONS
      // Warns about row-level restrictions on Attachment#, Journal# (and its
      // extension objects), and ServiceReqParam# that may be too tight for
      // some users, and lets the admin opt any of them out for this run via
      // a Yes/No pill per object (default: Yes, apply the restriction).
      // ============================================================
      function renderStep4() {
        renderStepBar(4); clearBody(); clearFooter();

        var roleName = wState.roleConfigName || 'the selected role';

        // Heading
        bodyEl.appendChild(el('p',
          'font-size:13px;font-weight:bold;color:#1F3864;margin:0 0 10px;',
          '⚠️  Restrictive Object Permissions'));

        // Main notice
        bodyEl.appendChild(notice(
          'This script applies row-level restrictions to the three objects below that may become ' +
          '<strong>too restrictive</strong> for some users\' needs. Review each one and choose whether ' +
          'to apply it (default: <strong>Yes</strong>). Hover the <strong>?</strong> next to an object for ' +
          'where to adjust it manually in the role afterward, if needed.',
          'warn'));

        STEP4_OBJECTS.forEach(function (obj) {
          var card = el('div',
            'border:1px solid ' + CLR.border + ';border-radius:5px;padding:10px 12px;' +
            'margin-top:10px;background:#FAFAFA;');

          var head = el('div', 'display:flex;align-items:center;justify-content:space-between;gap:10px;');

          var titleWrap = el('div', 'display:flex;align-items:center;min-width:0;');
          titleWrap.appendChild(el('span', 'font-size:12px;font-weight:bold;color:#1F3864;white-space:nowrap;', obj.label));
          titleWrap.appendChild(helpIcon(
            obj.help + '<br><br>Role: <strong>' + roleName + '</strong>'
          ));
          head.appendChild(titleWrap);

          head.appendChild(yesNoPills(wState.rowConditionOptOuts[obj.key], function (val) {
            wState.rowConditionOptOuts[obj.key] = val;
          }));

          card.appendChild(head);
          card.appendChild(el('div', 'font-size:11px;color:#595959;line-height:1.6;margin-top:6px;', obj.blurb));
          bodyEl.appendChild(card);
        });

        bodyEl.appendChild(el('p',
          'font-size:11px;color:#BFBFBF;margin:10px 0 0;font-style:italic;',
          'Choosing "No" for an object skips that object\'s row condition entirely for this run - ' +
          'access is then governed only by its business object rights, not by who created or is named ' +
          'on the record.'));

        var backBtn = mkBtn('‹ Back', false);
        backBtn.addEventListener('click', function () { goToStep(3); });

        var nextBtn = mkBtn('Understood, continue ›', true);
        nextBtn.addEventListener('click', function () { goToStep(5); });

        footerEl.appendChild(abortBtn()); footerEl.appendChild(backBtn); footerEl.appendChild(nextBtn);
      }

      // ============================================================
      // STEP 5 - CUSTOM OVERRIDES
      // ============================================================
      function renderStep5() {
        renderStepBar(5); clearBody(); clearFooter();

        var LVL = { 0:'0 - No access', 1:'1 - View', 3:'3 - View + Add',
                    5:'5 - View + Edit', 7:'7 - View + Add + Edit', 15:'15 - Full (CRUD)' };

        bodyEl.appendChild(el('p', 'font-size:12px;color:#595959;margin:0 0 12px;',
          'Optionally add or override individual business object rights before the patch runs. ' +
          'Proceed with an empty list to use the config rights only.'));

        // Summary of what's about to happen
        var summary = wState.mode === 'snapshot'
          ? '⏳ Snapshot: ' + (wState.snapshotFileName || 'unknown')
          : '⚙ Config: ' + (wState.roleConfigName || 'unknown') + ' – ' +
            Object.keys(wState.roleConfig.business_object_rights || {}).length + ' BOs';
        bodyEl.appendChild(notice(summary, 'info'));

        bodyEl.appendChild(lbl('Business Object Name'));
        var inputRow = el('div', 'display:flex;gap:8px;align-items:center;');
        var boInp  = textInp('e.g. MyCustomBO#', '');
        boInp.style.flex = '1';
        var lvlSel = el('select',
          'padding:8px;border:1px solid #BFBFBF;border-radius:4px;font-size:12px;' +
          'color:#1F1F1F;background:#fff;font-family:Arial,sans-serif;');
        [0,1,3,5,7,15].forEach(function (v) {
          var o = document.createElement('option');
          o.value = v; o.textContent = LVL[v]; if (v === 1) o.selected = true; lvlSel.appendChild(o);
        });
        var addBtn = el('button',
          'padding:8px 14px;background:#375623;color:#fff;border:none;border-radius:4px;' +
          'font-size:12px;font-weight:bold;cursor:pointer;white-space:nowrap;', '+ Add');
        inputRow.appendChild(boInp); inputRow.appendChild(lvlSel); inputRow.appendChild(addBtn);
        bodyEl.appendChild(inputRow);

        var errEl = el('p', 'font-size:12px;color:#C55A11;min-height:14px;margin:5px 0 0;', '');
        bodyEl.appendChild(errEl);

        bodyEl.appendChild(lbl('Queued overrides:'));
        var listWrap = el('div',
          'border:1px solid #E0E0E0;border-radius:4px;min-height:52px;max-height:130px;' +
          'overflow-y:auto;background:#FAFAFA;');
        var emptyMsg = el('div',
          'padding:13px 12px;font-size:12px;color:#BFBFBF;font-style:italic;',
          'None – patch will use config rights only');
        bodyEl.appendChild(listWrap);

        function renderList() {
          while (listWrap.firstChild) listWrap.removeChild(listWrap.firstChild);
          var keys = Object.keys(wState.customObjects);
          if (!keys.length) { listWrap.appendChild(emptyMsg); return; }
          keys.forEach(function (bo) {
            var rights = wState.customObjects[bo];
            var row = el('div', 'display:flex;align-items:center;padding:7px 10px;border-bottom:1px solid #EFEFEF;');
            row.appendChild(el('span', 'flex:1;font-size:12px;font-weight:bold;color:#1F3864;', bo));
            row.appendChild(el('span', 'font-size:12px;color:#595959;margin:0 10px;', LVL[rights] || 'Rights_' + rights));
            var del = el('button', 'background:none;border:none;cursor:pointer;color:#C00000;font-size:14px;font-weight:bold;padding:0 4px;', '×');
            del.addEventListener('click', function () { delete wState.customObjects[bo]; renderList(); });
            row.appendChild(del);
            listWrap.appendChild(row);
          });
        }
        renderList();

        function tryAdd() {
          var bo = boInp.value.trim(), lvl = parseInt(lvlSel.value, 10);
          errEl.textContent = '';
          if (!bo) { errEl.textContent = 'Enter a business object name.'; boInp.focus(); return; }
          if (bo.indexOf('#') === -1) { errEl.textContent = 'Name should include the # symbol.'; boInp.focus(); return; }
          if ([0,1,3,5,7,15].indexOf(lvl) === -1) { errEl.textContent = 'Select a valid access level.'; return; }
          wState.customObjects[bo] = lvl;
          console.log(LOG, 'Custom BO queued:', bo, '->', LVL[lvl]);
          renderList(); boInp.value = ''; lvlSel.value = 1; boInp.focus();
        }
        addBtn.addEventListener('click', tryAdd);
        boInp.addEventListener('keydown', function (e) { if (e.key === 'Enter') tryAdd(); });

        var backBtn = mkBtn('‹ Back', false);
        backBtn.addEventListener('click', function () { goToStep(4); });   // back to Attachment notice

        var nextBtn = mkBtn('Next ›', true);
        nextBtn.addEventListener('click', function () { goToStep(6); });   // -> System Permissions

        footerEl.appendChild(abortBtn()); footerEl.appendChild(backBtn); footerEl.appendChild(nextBtn);
      }

      // ============================================================
      // STEP 6 - SYSTEM PERMISSIONS
      // Action/Search/Dashboard checkboxes + Allow Publishing role lists.
      // ============================================================
      function renderStep6() {
        renderStepBar(6); clearBody(); clearFooter();

        bodyEl.appendChild(el('p', 'font-size:12px;color:#595959;margin:0 0 12px;',
          'Configure System Permissions for this role. Search – Create (for self) is checked by ' +
          'default to match the standard baseline; adjust as needed.'));

        // ---- Action / Search / Dashboard checkbox table ----
        var table = el('div', 'border:1px solid ' + CLR.border + ';border-radius:4px;overflow:hidden;margin-bottom:16px;');
        var headerRow = el('div',
          'display:flex;background:' + CLR.f5 + ';font-size:11px;font-weight:bold;color:#404040;' +
          'padding:8px 10px;border-bottom:1px solid ' + CLR.border + ';');
        headerRow.appendChild(el('div', 'flex:1;', 'Type'));
        headerRow.appendChild(el('div', 'width:100px;text-align:center;', 'Create (self)'));
        headerRow.appendChild(el('div', 'width:90px;text-align:center;', 'Edit (all)'));
        headerRow.appendChild(el('div', 'width:90px;text-align:center;', 'Delete (all)'));
        table.appendChild(headerRow);

        var gateInputs = {}; // gateKey -> array of controls to enable/disable

        SYSPERM_ROWS.forEach(function (row) {
          var state = wState.sysPerms[row.key];
          var tr = el('div',
            'display:flex;align-items:center;padding:8px 10px;border-bottom:1px solid #EFEFEF;font-size:12px;');
          tr.appendChild(el('div', 'flex:1;color:#1F1F1F;', row.label));

          var cCreate = chkInp(state.createSelf);
          var cEdit   = chkInp(state.editAll);
          var cDelete = chkInp(state.deleteAll);

          [[cCreate, '100px'], [cEdit, '90px'], [cDelete, '90px']].forEach(function (pair) {
            var wrap = el('div', 'width:' + pair[1] + ';text-align:center;');
            wrap.appendChild(pair[0]);
            tr.appendChild(wrap);
          });

          cCreate.addEventListener('change', function () { state.createSelf = cCreate.checked; });
          cEdit.addEventListener('change', function () { state.editAll = cEdit.checked; refreshPublishGates(); });
          cDelete.addEventListener('change', function () { state.deleteAll = cDelete.checked; refreshPublishGates(); });

          table.appendChild(tr);
        });

        bodyEl.appendChild(table);

        // ---- Allow publishing section ----
        bodyEl.appendChild(lbl('Allow publishing:'));

        PUBLISH_TARGETS.forEach(function (target) {
          var row = el('div', 'display:flex;align-items:flex-start;gap:8px;margin-bottom:12px;');
          row.appendChild(el('div', 'width:78px;padding-top:8px;font-size:12px;color:#404040;', target.label));
          row.appendChild(el('div', 'padding-top:8px;font-size:12px;color:#BFBFBF;', 'to'));

          var ctrlWrap = el('div', 'flex:1;');
          var addRow = el('div', 'display:flex;gap:6px;');

          var selOpts = [{ v: '', l: '-- choose or type below --' }, { v: ALL_ROLES_SENTINEL, l: 'All Roles' }]
            .concat(DEFAULT_ROLE_LIST.map(function (r) { return { v: r, l: r }; }));
          var roleSel = selEl(selOpts, '');
          roleSel.style.flex = '1';
          var customInp = textInp('or type a custom role name', '');
          customInp.style.flex = '1';
          var addBtn = el('button',
            'padding:7px 12px;background:#375623;color:#fff;border:none;border-radius:4px;' +
            'font-size:12px;font-weight:bold;cursor:pointer;white-space:nowrap;', '+ Add');

          addRow.appendChild(roleSel); addRow.appendChild(customInp); addRow.appendChild(addBtn);
          ctrlWrap.appendChild(addRow);

          var listWrap = el('div', 'margin-top:6px;');
          ctrlWrap.appendChild(listWrap);

          function renderRoleList() {
            while (listWrap.firstChild) listWrap.removeChild(listWrap.firstChild);
            var list = wState.publishRoles[target.key];
            if (!list.length) {
              listWrap.appendChild(el('div', 'font-size:11px;color:#BFBFBF;font-style:italic;', 'No roles configured'));
              return;
            }
            list.forEach(function (roleName) {
              var chip = el('span',
                'display:inline-flex;align-items:center;gap:5px;background:#EFEFEF;border-radius:3px;' +
                'padding:3px 8px;font-size:11px;margin:0 5px 5px 0;color:#1F3864;');
              chip.appendChild(document.createTextNode(roleName === ALL_ROLES_SENTINEL ? 'All Roles' : roleName));
              var rm = el('span', 'cursor:pointer;color:#C00000;font-weight:bold;', '×');
              rm.addEventListener('click', function () {
                wState.publishRoles[target.key] = list.filter(function (r) { return r !== roleName; });
                renderRoleList();
              });
              chip.appendChild(rm);
              listWrap.appendChild(chip);
            });
          }
          renderRoleList();

          addBtn.addEventListener('click', function () {
            var custom = customInp.value.trim();
            var toAdd  = custom || roleSel.value;
            if (!toAdd) return;
            var list = wState.publishRoles[target.key];
            if (toAdd === ALL_ROLES_SENTINEL) {
              wState.publishRoles[target.key] = [ALL_ROLES_SENTINEL];
            } else if (list.indexOf(ALL_ROLES_SENTINEL) === -1 && list.indexOf(toAdd) === -1) {
              list.push(toAdd);
            }
            customInp.value = ''; roleSel.value = '';
            renderRoleList();
          });

          row.appendChild(ctrlWrap);
          bodyEl.appendChild(row);

          if (target.gateKey) {
            gateInputs[target.gateKey] = gateInputs[target.gateKey] || [];
            gateInputs[target.gateKey].push({ roleSel: roleSel, customInp: customInp, addBtn: addBtn, row: row });
          }
        });

        function refreshPublishGates() {
          SYSPERM_ROWS.forEach(function (row) {
            if (!gateInputs[row.key]) return;
            var enabled = !!(wState.sysPerms[row.key].editAll || wState.sysPerms[row.key].deleteAll);
            gateInputs[row.key].forEach(function (c) {
              c.roleSel.disabled = !enabled; c.customInp.disabled = !enabled; c.addBtn.disabled = !enabled;
              c.row.style.opacity = enabled ? '1' : '0.45';
            });
          });
        }
        refreshPublishGates();

        // ---- Standalone search download/email checkboxes ----
        // These live at the top level of the SaveRole payload (DownloadRights /
        // EmailSearchRights), not inside RolePolicy.ModuleRights, so they are
        // applied separately in installInterceptor rather than through
        // applySystemPermissions.
        function extraChkRow(labelText, checked, onChange) {
          var row = el('div', 'display:flex;align-items:center;gap:8px;margin-top:8px;');
          var chk = chkInp(checked);
          chk.addEventListener('change', function () { onChange(chk.checked); });
          row.appendChild(chk);
          row.appendChild(el('span', 'font-size:12px;color:#404040;', labelText));
          return row;
        }

        bodyEl.appendChild(extraChkRow(
          'Allow Microsoft Excel download from saved searches',
          wState.downloadRights,
          function (val) { wState.downloadRights = val; }
        ));
        bodyEl.appendChild(extraChkRow(
          'Allow email to yourself from saved searches',
          wState.emailSearchRights,
          function (val) { wState.emailSearchRights = val; }
        ));

        var backBtn = mkBtn('‹ Back', false);
        backBtn.addEventListener('click', function () { goToStep(5); });

        var armBtn = mkBtn('Arm Interceptor →', true);
        armBtn.addEventListener('click', function () {
          cleanup();
          resolve({
            roleConfig: wState.roleConfig, roleConfigName: wState.roleConfigName,
            mode: wState.mode, snapshotJson: wState.snapshotJson,
            snapshotFileName: wState.snapshotFileName, customObjects: wState.customObjects,
            sysPerms: wState.sysPerms, publishRoles: wState.publishRoles,
            downloadRights: wState.downloadRights, emailSearchRights: wState.emailSearchRights,
            rowConditionOptOuts: wState.rowConditionOptOuts
          });
        });

        footerEl.appendChild(abortBtn()); footerEl.appendChild(backBtn); footerEl.appendChild(armBtn);
      }

      // ---- Navigation ----
      function goToStep(n) {
        wState.step = n;
        if (n === 1) renderStep1();
        if (n === 2) renderStep2();
        if (n === 3) renderStep3();
        if (n === 4) renderStep4();
        if (n === 5) renderStep5();
        if (n === 6) renderStep6();
      }

      goToStep(1);
    });
  }

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

  function buildRowConditions(currentRC, roleConfig, rcOptOuts) {
    var rcSpec   = roleConfig.row_conditions || {};
    var newRC    = {}, applied = [], removed = [], skipped = [];
    var specKeys = Object.keys(rcSpec);

    for (var i = 0; i < specKeys.length; i++) {
      var bo   = specKeys[i];
      var spec = rcSpec[bo];

      // Step 4 opt-out: admin answered "No" for this object's group, so
      // leave its row condition out of the new set entirely -- access then
      // falls back to whatever the BusinessObjectRights bitmask allows.
      if (isRowConditionOptedOut(bo, rcOptOuts)) {
        skipped.push(bo);
        continue;
      }

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
    if (skipped.length > 0) console.log(LOG, 'Row conditions skipped (opted out in step 4):', skipped.join(', '));

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
  // SYSTEM PERMISSIONS PATCH
  // Applies the Action/Search/Dashboard checkboxes and the Allow Publishing role
  // lists to a RolePolicy JSON string. Fully replaces the bits and role lists
  // this step manages (same "config is authoritative" pattern as buildNewBOR and
  // buildRowConditions) -- unchecked boxes and roles left off a publish list are
  // removed, not merely skipped.
  // ===========================================================================
  function applySystemPermissions(rpStr, sysPerms, publishRoles, sysBooleans) {
    var changedRows = [], publishSummary = [];

    // ---- ModuleRights: Action / Search / Dashboard checkboxes ----
    var MR_KEY = '"ModuleRights":';
    var mrIdx  = rpStr.indexOf(MR_KEY);
    if (mrIdx === -1) {
      console.warn(LOG, 'ModuleRights not found in RolePolicy -- skipping System Permissions.');
    } else {
      var mrStart = mrIdx + MR_KEY.length;
      while (mrStart < rpStr.length && (rpStr[mrStart] === ' ' || rpStr[mrStart] === '\t')) mrStart++;
      if (rpStr[mrStart] !== '{') throw new Error('Expected { at start of ModuleRights');
      var mrEnd = findObjectEnd(rpStr, mrStart);
      if (mrEnd === -1) throw new Error('Could not find closing } for ModuleRights');

      var moduleRights = JSON.parse(rpStr.slice(mrStart, mrEnd));

      for (var i = 0; i < SYSPERM_ROWS.length; i++) {
        var rowKey = SYSPERM_ROWS[i].key;
        var state  = sysPerms[rowKey] || { createSelf: false, editAll: false, deleteAll: false };

        // Some roles have never had this security type touched before, so it
        // may be entirely absent from ModuleRights. Previously this was a
        // silent no-op (checkbox change never applied); now the entry is
        // created from a zeroed baseline so the mask logic below still runs.
        if (!moduleRights[rowKey]) moduleRights[rowKey] = { ItemRights: {} };
        if (!moduleRights[rowKey].ItemRights) moduleRights[rowKey].ItemRights = {};

        var ir        = moduleRights[rowKey].ItemRights;
        var curGlobal  = ir.Global || 0, curUser = ir.User || 0;

        var newUser = state.createSelf ? (curUser | SYSPERM_CREATE_SELF_MASK)
                                        : (curUser & ~SYSPERM_CREATE_SELF_MASK);
        var newGlobal = state.editAll ? (curGlobal | SYSPERM_EDIT_ALL_MASK) : (curGlobal & ~SYSPERM_EDIT_ALL_MASK);
        newGlobal = state.deleteAll ? (newGlobal | SYSPERM_DELETE_ALL_MASK) : (newGlobal & ~SYSPERM_DELETE_ALL_MASK);

        if (newGlobal !== curGlobal || newUser !== curUser) {
          ir.Global = newGlobal; ir.User = newUser;
          changedRows.push(SYSPERM_ROWS[i].label + ' (Global ' + curGlobal + '→' + newGlobal +
                            ', User ' + curUser + '→' + newUser + ')');
        }
      }

      rpStr = rpStr.slice(0, mrStart) + JSON.stringify(moduleRights) + rpStr.slice(mrEnd);
      if (changedRows.length > 0) console.log(LOG, 'System Permissions updated:', changedRows.join('; '));
    }

    // ---- PublishRights: Allow Publishing role lists ----
    var PR_KEY = '"PublishRights":';
    var prIdx  = rpStr.indexOf(PR_KEY);
    if (prIdx === -1) {
      console.warn(LOG, 'PublishRights not found in RolePolicy -- skipping publish role lists.');
      return rpStr;
    }
    var prStart = prIdx + PR_KEY.length;
    while (prStart < rpStr.length && (rpStr[prStart] === ' ' || rpStr[prStart] === '\t')) prStart++;
    if (rpStr[prStart] !== '{') throw new Error('Expected { at start of PublishRights');
    var prEnd = findObjectEnd(rpStr, prStart);
    if (prEnd === -1) throw new Error('Could not find closing } for PublishRights');

    var publishRights = JSON.parse(rpStr.slice(prStart, prEnd));

    for (var p = 0; p < PUBLISH_TARGETS.length; p++) {
      var targetKey = PUBLISH_TARGETS[p].key;
      var wanted    = publishRoles[targetKey] || [];
      if (!publishRights[targetKey]) publishRights[targetKey] = { ItemRights: {} };

      // Expand the "All Roles" sentinel to the full role list at apply time.
      var wantedRoles = wanted.indexOf(ALL_ROLES_SENTINEL) !== -1 ? DEFAULT_ROLE_LIST.slice() : wanted;

      var newItemRights = {}, added = 0, failed = [];
      for (var r = 0; r < wantedRoles.length; r++) {
        var roleName = wantedRoles[r];
        try {
          newItemRights[roleName] = 16;
          added++;
        } catch (roleErr) {
          failed.push(roleName);
          console.error(LOG, 'Could not apply publish right for role "' + roleName + '" on ' + targetKey + ':', roleErr.message);
        }
      }
      publishRights[targetKey].ItemRights = newItemRights;
      publishSummary.push(PUBLISH_TARGETS[p].label + ': ' + added + ' role(s)' +
                           (failed.length ? ', ' + failed.length + ' failed' : ''));
    }

    rpStr = rpStr.slice(0, prStart) + JSON.stringify(publishRights) + rpStr.slice(prEnd);
    console.log(LOG, 'Publish rights updated:', publishSummary.join('; '));

    // ---- DownloadRights / EmailSearchRights ----
    // Live capture on 2026-07-06 proved these booleans exist in TWO places in
    // the SaveRole payload: a decorative copy at the top level of params.data
    // (which ISM does not appear to read back) and a second copy embedded
    // inside this RolePolicy string itself, right after GrantAllowRoles and
    // before ModuleRights. Toggling the checkbox natively in ISM only ever
    // changed the copy nested in here, so that's the one that must be patched
    // for the setting to actually take effect. Simple booleans, no object
    // braces to match, so replaceIntField's comma/brace scan works directly.
    if (sysBooleans) {
      rpStr = replaceIntField(rpStr, 'DownloadRights', sysBooleans.downloadRights ? 'true' : 'false');
      rpStr = replaceIntField(rpStr, 'EmailSearchRights', sysBooleans.emailSearchRights ? 'true' : 'false');
    }

    return rpStr;
  }

  // ===========================================================================
  // CUSTOM OBJECTS PROMPT
  // APPLY CONFIG
  // ===========================================================================
  function applyConfig(rpStr, roleConfig, customObjects, rcOptOuts) {
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
            var rcResult  = buildRowConditions(currentRC, roleConfig, rcOptOuts);
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
  function installInterceptor(getPayload, onSuccessCallback, readyMsg, sysBooleans) {
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

        // DownloadRights / EmailSearchRights ("Allow Microsoft Excel download from
        // saved searches" / "Allow email to yourself from saved searches") appear
        // TWICE in this payload: once here at the top level of params.data, and
        // once nested inside RolePolicy itself. Live captures (2026-07-06) proved
        // ISM only honors the copy nested inside RolePolicy -- that one is patched
        // in applySystemPermissions(). This top-level copy is set too, purely to
        // keep it consistent with the nested value; it is not the field that
        // actually controls the checkbox.
        if (sysBooleans) {
          params.data.DownloadRights = !!sysBooleans.downloadRights;
          params.data.EmailSearchRights = !!sysBooleans.emailSearchRights;
          console.log(LOG, 'DownloadRights ->', params.data.DownloadRights,
                      ', EmailSearchRights ->', params.data.EmailSearchRights);
        }

        var _ok = onSuccess, _fail = onFailure;

        return _orig.apply(this, [servicePath, methodName, useGet, params,
          function () {
            console.log(LOG, 'PATCHER SUCCEEDED. Navigate away and back to Object Permissions to confirm.');
            console.log(LOG, 'If you experience issues please visit the troubleshooting items:', TROUBLESHOOTING_URL);
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
  // MAIN
  // ===========================================================================

  // Pre-fetch role list from GitHub while wizard is starting up
  var detectedRole = detectRoleFromPage();
  console.log(LOG, detectedRole ? 'Detected role: ' + detectedRole : 'Could not auto-detect role from page');

  var roleFiles = [];
  try {
    roleFiles = await fetchRoleList();
    console.log(LOG, 'GitHub: ' + roleFiles.length + ' config file(s) available');
    roleFiles.forEach(function (f) { console.log(LOG, '  -', f.roleName); });
  } catch (e) {
    console.warn(LOG, 'GitHub role list fetch failed:', e.message);
  }

  // Re-check right before the wizard opens -- the GitHub fetch above gives
  // the GetEditRole hook a real window to catch a click that happened after
  // this script was pasted (see hook near top of file).
  if (!detectedRole && networkDetectedRole) {
    detectedRole = networkDetectedRole;
    console.log(LOG, 'Detected role from GetEditRole (post-fetch):', detectedRole);
  }

  // Run wizard (version check -> role config -> mode -> overrides)
  var wResult = await showWizard(detectedRole, roleFiles);
  if (!wResult) { console.warn(LOG, 'Aborted.'); return; }

  var roleConfig     = wResult.roleConfig;
  var roleConfigName = wResult.roleConfigName;
  var customObjects  = wResult.customObjects;
  var custCount      = Object.keys(customObjects).length;
  var sysPerms       = wResult.sysPerms;
  var publishRoles   = wResult.publishRoles;
  var sysBooleans    = { downloadRights: wResult.downloadRights, emailSearchRights: wResult.emailSearchRights };

  if (custCount > 0) {
    console.log(LOG, custCount + ' custom override(s):', Object.keys(customObjects).join(', '));
  }

  // ---- Install interceptor based on mode ----
  if (wResult.mode === 'snapshot') {

    var snapshotJson = wResult.snapshotJson;

    // Merge any custom objects into the snapshot before applying
    if (custCount > 0) {
      var parsedSnap = JSON.parse(snapshotJson);
      var custKeys   = Object.keys(customObjects);
      for (var ci = 0; ci < custKeys.length; ci++) {
        var cbo = custKeys[ci];
        parsedSnap.BusinessObjectRights[cbo] = {
          Rights: customObjects[cbo], FieldRights: null,
          DefaultFieldRights: customObjects[cbo] > 0 ? 5 : null
        };
      }
      snapshotJson = JSON.stringify(parsedSnap);
      console.log(LOG, 'Custom objects merged into snapshot.');
    }

    installInterceptor(
      function (currentPolicy, roleId, ts) {
        console.log(LOG, 'Applying snapshot:', wResult.snapshotFileName, '(' + snapshotJson.length + ' chars)');
        var finalPolicy = snapshotJson;
        try {
          finalPolicy = applySystemPermissions(finalPolicy, sysPerms, publishRoles, sysBooleans);
        } catch (spErr) {
          console.error(LOG, 'System Permissions patch failed (rest of snapshot still applied):', spErr.message);
        }
        return { policy: finalPolicy, replacedBy: wResult.snapshotFileName,
                 mode: 'snapshot', customObjects: customObjects };
      },
      function (roleId, ts, result) {
        console.log(LOG, 'Snapshot applied. Pre-patcher files are your record of what changed.');
      },
      [' Mode   : SNAPSHOT', ' File   : ' + wResult.snapshotFileName, ' Custom : ' + custCount],
      sysBooleans
    );

  } else {

    installInterceptor(
      function (currentPolicy, roleId, ts) {
        var result      = applyConfig(currentPolicy, roleConfig, customObjects, wResult.rowConditionOptOuts);
        var finalPolicy = result.patched;
        try {
          finalPolicy = applySystemPermissions(finalPolicy, sysPerms, publishRoles, sysBooleans);
        } catch (spErr) {
          console.error(LOG, 'System Permissions patch failed (BOR/RC still applied):', spErr.message);
        }
        console.log(LOG, 'Config applied -- sending to server...');
        return {
          policy: finalPolicy, replacedBy: roleConfigName + ' (AHPatcher v' + SCRIPT_VERSION + ')',
          newBOR: result.newBOR, rcApplied: result.rcApplied, rcRemoved: result.rcRemoved,
          mode: 'config', customObjects: customObjects
        };
      },
      function (roleId, ts, result) {
        try {
          var yaml = buildAppliedYaml(roleId, result.newBOR, roleConfig,
                                      result.customObjects, result.rcApplied, result.rcRemoved, ts);
          downloadFile(roleId + '_applied_' + ts + '.yaml', yaml, 'text/yaml');
          console.log(LOG, 'Applied YAML saved.');
        } catch (e) { console.error(LOG, 'Applied YAML failed:', e.message); }
      },
      [' Mode   : CONFIG', ' Config : ' + roleConfigName,
       ' BOs    : ' + Object.keys(roleConfig.business_object_rights || {}).length,
       ' Custom : ' + custCount],
      sysBooleans
    );
  }

})();
