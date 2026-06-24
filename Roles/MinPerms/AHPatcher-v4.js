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
// AHPatcher - Role Patcher (Snapshot Apply or Minimum Set)
// Browser console script (not an ISM server-side Quick Action)
//
// Two modes depending on whether you pick a file:
//
//   SNAPSHOT MODE  (file chosen in picker)
//     Applies a previously downloaded RolePolicy snapshot to the target role.
//     Useful for restoring a backup or copying permissions from another role.
//
//   MINIMUM SET MODE  (file picker cancelled)
//     Applies the built-in minimum privilege set.
//     Row-level conditions are applied for Incident#, ServiceReq#, MyShelfItem#.
//     If TENANT_HAS_LOB is true, LOB business objects are also granted.
//
// Both modes:
//   - Prompt for optional custom BO additions before intercepting
//   - Download the role's CURRENT state before making any changes
//   - Download a YAML summary of the pre-change state
//   - Single-fire interceptor, re-installs on failure
//
// HOW TO USE:
//   1. Set TENANT_HAS_LOB below to match your tenant
//   2. Admin > Roles > [Target Role] > Object Permissions
//   3. F12 > Console > paste this script > Enter
//   4. File picker opens:
//        - Pick a snapshot JSON to apply that snapshot
//        - Cancel to apply the minimum privilege set instead
//   5. Answer the custom BO prompts (or press n to skip)
//   6. Make any single change on the page (tick/untick any box)
//   7. Click Save
// =============================================================================

(function AHPatcher() {

  var LOG = '[AHPatcher]';


  // ===========================================================================
  // CONFIGURATION -- edit before pasting
  // ===========================================================================

  // Set to true if this tenant has Line of Business (LOB) modules installed.
  // When true, the LOB_SET entries (Security Incidents, HR Cases, Work Orders,
  // Demand Management, PPM, etc.) are merged into the minimum set before applying.
  var TENANT_HAS_LOB = true;

  // ===========================================================================
  // RIGHTS CONSTANTS
  // Bitmask: R=View=1, C=Add=2, U=Edit=4, D=Delete=8
  // ===========================================================================

  var R = {
    NONE          : 0,
    VIEW          : 1,   // R
    VIEW_ADD      : 3,   // RC  (1+2)
    VIEW_EDIT     : 5,   // RU  (1+4)
    VIEW_ADD_EDIT : 7,   // CRU (1+2+4)
    FULL          : 15   // CRUD (1+2+4+8)
  };

  var RIGHTS_LABEL = {
    0 : 'NotSet',
    1 : 'View',
    3 : 'View, Add',
    5 : 'View, Edit',
    7 : 'View, Add, Edit',
    15: 'View, Add, Edit, Delete'
  };

  // ===========================================================================
  // CORE MINIMUM SET
  // Source: selfservice_minimum_set.json (internal) and discovery testing.
  // ===========================================================================

  var MINIMUM_SET = {

    // -- Required at minimum ------------------------
    'Incident#'                             : R.VIEW_ADD_EDIT,
    'ServiceReq#'                           : R.VIEW_ADD_EDIT,
    'Journal#'                              : R.VIEW_ADD_EDIT,
    'Employee#'                             : R.VIEW,
    'Announcement#'                         : R.VIEW,
    'Region#'                               : R.VIEW,
    'AnnouncementStatus#'                   : R.VIEW,
    'StatusofHRAnnouncement#'               : R.VIEW,
    'EffectedSiteHRAnnouncement#'           : R.VIEW,
    'ImpactHRAnnouncement#'                 : R.VIEW,
    'ivnt_EffectedSiteFMAnnouncement#'      : R.VIEW,
    'ivnt_ImpactFMAnnouncement#'            : R.VIEW,
    'ivnt_StatusofFMAnnouncement#'          : R.VIEW,
    'ivnt_StatusOfSecurityAnnouncement#'    : R.VIEW,
    'ivnt_SecurityAnnouncementImpact#'      : R.VIEW,
    'FAQ#'                                  : R.VIEW,
    'FAQCategory#'                          : R.VIEW,
    'FRS_MyItem#'                           : R.VIEW_ADD_EDIT,
    'FRS_MyItemParentObjType#'              : R.VIEW,
    'FRS_MyItemStatus#'                     : R.VIEW,
    'CI#'                                   : R.VIEW,
    'CI#Service'                            : R.VIEW,
    'CI#Computer'                           : R.VIEW,
    'AddressCountry#'                       : R.VIEW,
    'AddressUSCanadaState#'                 : R.VIEW,
    'ivnt_AssetSubType#'                    : R.VIEW,
    'FRS_Knowledge#'                        : R.VIEW,
    'Task#'                                 : R.VIEW,
    'Department#'                           : R.VIEW,
    'Alert#'                                : R.VIEW,
    'AlertCategory#'                        : R.VIEW,
    'AlertSeverity#'                        : R.VIEW,
    'AlertStatus#'                          : R.VIEW,


    // -- Required for MyItems runtime
    'ivnt_Actions#'                         : R.VIEW,

    // -- Used by the SelfService catalog ------------
    'Category#'                             : R.VIEW,
    'ServiceReqCategory#'                   : R.VIEW,
    'ServiceReqStatus#'                     : R.VIEW,
    'ServiceReqRecurrentPrice#'             : R.FULL,
    'ServiceReqFulfillmentPlan#'            : R.VIEW_ADD_EDIT,
    'ServiceReqFulfillmentPlan#Email'       : R.VIEW_ADD_EDIT,
    'ServiceReqFulfillmentPlan#None'        : R.VIEW_ADD_EDIT,
    'ServiceReqFulfillmentPlan#QuickAction' : R.VIEW_ADD_EDIT,
    'ServiceReqFulfillmentPlan#Workflow'    : R.VIEW_ADD_EDIT,
    'FulfillmentItem#'                      : R.FULL,
    'Audit_ServiceReq#'                     : R.VIEW_ADD_EDIT,
    // Change# and FRS_HC_CallLog# needed by Journal#Email.ToAddrList calc expression
    'Change#'                               : R.VIEW,
    'FRS_HC_CallLog#'                       : R.VIEW,
    'ServiceReqTemplate#'                   : R.VIEW_EDIT,      // RU -- view + edit only
    'ServiceReqTemplateParam#'              : R.VIEW,
    'ServiceReqTemplateParamValid#'         : R.VIEW,
    'ServiceReqTemplateDefinition#'        : R.VIEW_ADD_EDIT,  // CRU -- separate plural BO
    'ServiceReqTemplateEntityAccess#'       : R.VIEW,
    'ServiceReqSubscription#'              : R.VIEW,
    'ServiceReqSubscriptionParam#'          : R.VIEW,
    'Frs_ITFM_Recurring_Service_Subscription#' : R.VIEW_EDIT,  // RU
    'OrganizationalUnit#'                   : R.VIEW,
    'OrganizationalUnitType#'               : R.VIEW,
    'ServiceAgreement#'                     : R.VIEW,
    'ServiceAgreement#OLA'                  : R.VIEW,
    'ServiceAgreement#SLA'                  : R.VIEW,
    'ServiceAgreement#UC'                   : R.VIEW,
    'ServiceAgreementStatus#'               : R.VIEW,
    'ServiceLevelPackage#'                  : R.VIEW,
    'ServiceLevelPackageStatus#'            : R.VIEW,
    'ServiceReqDeliveryAvgView#'            : R.VIEW,
    'Frs_ServiceCatalog_Access#'            : R.VIEW,
    'Location#'                             : R.VIEW,
    'ivnt_BusinessUnitCostCenter#'          : R.VIEW,
    'SelfServiceFavorite#'                  : R.VIEW,

    // -- Items not commonly known --
    'Frs_CompositeContract_Contact#'        : R.VIEW,
    'Frs_CompositeContract_Entity#'         : R.VIEW,
    'StandardUserTeam#'                     : R.VIEW,

    // -- Related to SROs/carts ---------------------
    'ServiceReqParam#'                      : R.FULL,           // CRUD -- delete required
    'ServiceReqParamLink#'                  : R.VIEW_ADD_EDIT,
    'Attachment#'                           : R.FULL,           // CRUD -- full access required
    'MyShelfItem#'                          : R.FULL,           // row condition also applied below

    // -- Required for 'price' functionality
    'FRS_PriceItem#'                        : R.VIEW,
    'FRS_PriceVariance#'                    : R.VIEW,
    'Frs_ServiceReqPriceItem#'              : R.VIEW,
    'CurrencyCode#'                         : R.VIEW,

    // -- Used for notifications on the portal
    'ivnt_PushNotificationCorner#'          : R.VIEW,
    'TargetVariant#ServiceReq'              : R.VIEW,

    // -- Required for Incident to work
    'IncidentSource#'                       : R.VIEW,
    'IncidentStatus#'                       : R.VIEW,
    'IncidentPriority#'                     : R.VIEW,
    'IncidentType#'                         : R.VIEW,
    'IncidentCauseCode#'                    : R.VIEW,
    'IncidentDetailActionNeeded#'           : R.VIEW,
    'Impact#'                               : R.VIEW,
    'Urgency#'                              : R.VIEW,
    'SubCategory#'                          : R.VIEW,

    // -- SR/Incident/other workflows require these
    'Frs_def_hours_of_operation#'           : R.VIEW,
    'Frs_def_escalation_clock_state#'       : R.VIEW,
    'Frs_def_escalation_schedule#'          : R.VIEW,
    'Frs_def_escalation_setting#'           : R.VIEW,
    'Frs_def_self_service_literals#'        : R.VIEW,
    'Frs_def_workflow_definition#'          : R.VIEW,
    'Frs_def_workflow_inst_status#'         : R.VIEW,
    'Frs_def_workflow_type#'                : R.VIEW,

    // -- MyItems requires these
    'Frs_data_escalation_watch#'            : R.FULL,
    'Frs_EVT_Event#'                        : R.VIEW_ADD_EDIT,
    'Frs_EVT_EventSource#'                  : R.VIEW,
    'Frs_EVT_EventStatus#'                  : R.VIEW,
    'Task#Assignment'                       : R.VIEW_ADD_EDIT,
    'Task#WorkOrder'                        : R.VIEW_ADD_EDIT,
    'FRS_Approval#'                         : R.VIEW_ADD_EDIT,
    'FRS_ApprovalStatus#'                   : R.VIEW,
    'FRS_ApprovalVoteTracking#'             : R.VIEW_ADD_EDIT,
    'FRS_ApprovalVoteTrackStatus#'          : R.VIEW,
    'Frs_data_workflow_instance#'           : R.VIEW_ADD_EDIT,
    'Frs_data_workflow_history#'            : R.VIEW_ADD_EDIT,
    'Frs_ITFM_Transaction#'                 : R.FULL,

    // -- Required for Journal#.xyz -- sends initial ticket-created emails etc
    'Journal#Email'                         : R.VIEW_ADD_EDIT,
    'Journal#Notes'                         : R.VIEW_ADD_EDIT,
    'Journal#EmailAttachment#'              : R.VIEW,

    // -- Knowledge base
    'FRS_Knowledge#'                        : R.VIEW,
    'FRS_Knowledge#Document'                : R.VIEW,
    'FRS_Knowledge#ErrorMessage'            : R.VIEW,
    'FRS_Knowledge#IssueResolution'         : R.VIEW,
    'FRS_Knowledge#Patch'                   : R.VIEW,
    'FRS_Knowledge#QandA'                   : R.VIEW,
    'FRS_Knowledge#Reference'               : R.VIEW,
    'Knowledge#'                            : R.VIEW,
    'KnowledgeCategory#'                    : R.VIEW,
    'KnowledgeSubCategory#'                 : R.VIEW,
    'KnowledgeRepositories#'                : R.VIEW,
    'KnowledgeEnvironment#'                 : R.VIEW,
    'nrn_HRKnowledgeReviewFrequency#'       : R.VIEW,
    'KnowledgeType#'                        : R.VIEW,
    'KnowledgeStatus#'                      : R.VIEW,
    'KnowledgeUserRating#'                  : R.VIEW_ADD_EDIT,  // CRU
    'KMFeedback#'                           : R.VIEW,
    'KMFeedback#ArticleFeedback'            : R.VIEW,
    'JournalCategory#'                      : R.VIEW,
    'JournalEmailCategory#'                 : R.VIEW,
    'JournalNotesCategory#'                 : R.VIEW,
    'StoreJournalEmailAs#'                  : R.VIEW,
    'JournalNotesSource#'                   : R.VIEW
  };

  // ===========================================================================
  // LOB SET
  // Only applied when TENANT_HAS_LOB = true.
  // Covers Security Incidents, HR Cases, Work Orders, Demand/PPM, and the
  // supporting lookup tables each module requires.
  // ===========================================================================

  var LOB_SET = {

    // -- Security Incidents -------------------------
    'ivnt_SecurityIncident#'            : R.VIEW_ADD_EDIT,  // CRU
    'ivnt_SecurityIncidentSource#'      : R.VIEW,
    'ivnt_SecurityIncidentStatus#'      : R.VIEW,

    // -- HR Cases ----------------------------------
    'ivnt_HRCase#'                      : R.VIEW_ADD_EDIT,  // CRU
    'HRCaseStatusWorkflow#'             : R.VIEW,
    'ivnt_HRCaseCategory#'              : R.VIEW,
    'ivnt_HRCaseSubCategory#'           : R.VIEW,
    'ivnt_HRCaseStatus#'                : R.VIEW,

    // -- Work Orders --------------------------------
    'ivnt_WorkOrder#'                   : R.VIEW_ADD_EDIT,  // CRU
    'ivnt_WorkOrderCategory#'           : R.VIEW,
    'ivnt_WorkOrderSubCategory#'        : R.VIEW,
    'ivnt_WorkOrderStatus#'             : R.VIEW,
    'ivnt_WorkOrderType#'               : R.VIEW,
    'ivnt_ScheduleEntryType#'           : R.VIEW,           // required by ivnt_WorkOrder
    'nrn_Facilities_Room_Type#'         : R.VIEW,           // required by ivnt_WorkOrder

    // -- Demand Management / PPM -------------------
    'nrn_Demand#'                       : R.VIEW_ADD_EDIT,  // CRU
    'nrn_DemandScorecard#'              : R.VIEW,
    'nrn_DemandStatus#'                 : R.VIEW,
    'nrn_DemandStatus_Workflow#'        : R.VIEW,
    'nrn_BenefitPlan#'                  : R.VIEW,
    'nrn_CostRecurrence#'               : R.VIEW,
    'PPM_TShirtSize#'                   : R.VIEW,
    'PPM_Area#'                         : R.VIEW,
    'Frs_Prj_Phase#'                    : R.VIEW,
    'FRS_ITFM_SubBudgetPlan#'           : R.VIEW
  };

  // ===========================================================================
  // FIELD RIGHTS
  // Optional per-BO field-level access control.
  //
  // When a BO is listed here:
  //   - Only the fields named get the specified rights (1=View, 5=View+Edit)
  //   - ALL other fields on that BO are locked (DefaultFieldRights set to null)
  //   - This overrides the global DefaultFieldRights=5 that would otherwise apply
  //
  // BOs NOT listed here continue to use DefaultFieldRights=5 (View+Edit on all fields).
  //
  // Rights values at field level:
  //   R.VIEW      = 1  -- field is readable but not editable
  //   R.VIEW_EDIT = 5  -- field is readable and editable
  //   R.NONE      = 0  -- field is hidden (same as omitting it)
  //
  // Add/Delete do not apply at field level -- only View and Edit are honoured.
  //
  // Example -- uncomment and fill in to use:
  //   'AH_MajorIncident#': {
  //     'CreatedBy'         : R.VIEW,
  //     'CreatedDateTime'   : R.VIEW,
  //     'IncidentLink'      : R.VIEW,
  //     'IncidentLink_RecID': R.VIEW
  //   }
  // ===========================================================================

  var FIELD_RIGHTS = {
    // Add entries here.  Example:
    // 'Employee#': {
    //   'FirstName'   : R.VIEW,
    //   'LastName'    : R.VIEW,
    //   'LoginID'     : R.VIEW,
    //   'PrimaryEmail': R.VIEW
    // }
  };

  // ===========================================================================
  // HELPERS
  // ===========================================================================

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
  // getCasingVariants
  // Returns deduplicated casing variants for a BO name so the caller does not
  // need to list every possible case combination.
  //
  // Works bidirectionally -- input can be ANY casing and all four forms are
  // produced from it:
  //
  //   1. Original       -- exactly as written
  //   2. All lowercase  -- entire string lowercased
  //   3. Title-cased    -- first letter of each segment (delimited by # or _)
  //                        capitalised; the rest lowercased
  //                        e.g. 'incident#'        -> 'Incident#'
  //                             'journal#email'    -> 'Journal#Email'
  //                             'frs_knowledge#doc'-> 'Frs_Knowledge#Doc'
  //   4. camelCase      -- title-cased but with the very first character
  //                        lowercased
  //                        e.g. 'Journal#Email'   -> 'journal#Email'
  //
  // Duplicates are removed so an already-lowercase input does not produce
  // spurious copies (e.g. 'incident#' original and lowercase are the same).
  //
  // Limitation: compound PascalCase words without a delimiter boundary
  // (e.g. 'ServiceReq') cannot be reconstructed from 'servicereq' alone.
  // Write the canonical ISM name in MINIMUM_SET and the lowercase variant
  // is generated automatically.  The reverse (lowercase -> canonical) works
  // perfectly for single-word names like 'Incident#'.
  // ---------------------------------------------------------------------------
  function getCasingVariants(boName) {
    var seen = {};
    var variants = [];

    function add(v) {
      if (!seen.hasOwnProperty(v)) { seen[v] = true; variants.push(v); }
    }

    // 1. Original
    add(boName);
    // 2. All lowercase
    var lower = boName.toLowerCase();
    add(lower);
    // 3. Title-cased: derive from lowercase so this works regardless of input casing.
    //    Capitalise the character that follows the start of the string, '#', or '_'.
    var titled = lower.replace(/(^|[#_])([a-z])/g, function(m, sep, ch) {
      return sep + ch.toUpperCase();
    });
    add(titled);
    // 4. camelCase: title-cased but first character lowercased.
    if (titled.length > 0) {
      add(titled.charAt(0).toLowerCase() + titled.slice(1));
    }

    return variants;
  }

  function replaceIntField(str, fieldName, newValue) {
    var pattern = '"' + fieldName + '":';
    var idx = str.indexOf(pattern);
    if (idx === -1) return str;
    var vs = idx + pattern.length;
    var ve = vs;
    while (ve < str.length && str[ve] !== ',' && str[ve] !== '}') ve++;
    console.log(LOG, 'Set', fieldName + ': ' + str.slice(vs, ve), '->', newValue);
    return str.slice(0, vs) + newValue + str.slice(ve);
  }

  // Returns the effective set to grant -- MINIMUM_SET plus LOB_SET if enabled.
  function getEffectiveSet() {
    var effective = {};
    var msKeys = Object.keys(MINIMUM_SET);
    for (var i = 0; i < msKeys.length; i++) {
      effective[msKeys[i]] = MINIMUM_SET[msKeys[i]];
    }
    if (TENANT_HAS_LOB) {
      var lobKeys = Object.keys(LOB_SET);
      for (var j = 0; j < lobKeys.length; j++) {
        effective[lobKeys[j]] = LOB_SET[lobKeys[j]];
      }
    }
    return effective;
  }

  // ---------------------------------------------------------------------------
  // CUSTOM OBJECTS PROMPT LOOP
  // ---------------------------------------------------------------------------

  function promptCustomObjects(contextMsg) {
    var customObjects = {};

    var askCustom = window.prompt(
      'AHPatcher\n\n' +
      contextMsg + '\n\n' +
      'Do you want to add or override any business object rights?\n\n' +
      'Enter  y  or  n',
      'n'
    );

    if (askCustom && askCustom.trim().toLowerCase() === 'y') {
      var addingCustom = true;
      while (addingCustom) {
        var boName = window.prompt(
          'Business object name (include the # symbol)\n' +
          'Examples:  CHTR_CustomBO#   or   MyApp#Subtype\n\n' +
          'Leave blank and press OK to finish.',
          ''
        );

        if (!boName || boName.trim() === '') {
          addingCustom = false;
          break;
        }

        boName = boName.trim();

        var levelStr = window.prompt(
          'Access level for:  ' + boName + '\n\n' +
          '  0   None  (locked down)\n' +
          '  1   View          (R)\n' +
          '  3   View + Add    (RC)\n' +
          '  5   View + Edit   (RU)\n' +
          '  7   View + Add + Edit  (CRU)\n' +
          '  15  Full (CRUD)',
          '1'
        );

        var level = parseInt(levelStr, 10);
        if (isNaN(level) || [0, 1, 3, 5, 7, 15].indexOf(level) === -1) {
          window.alert('Invalid value "' + levelStr + '".\nValid choices: 0, 1, 3, 5, 7, 15.\nThis object was skipped.');
          continue;
        }

        customObjects[boName] = level;
        console.log(LOG, 'Queued custom object:', boName, '->', RIGHTS_LABEL[level] || level);

        var another = window.prompt(
          'Added: ' + boName + ' (' + (RIGHTS_LABEL[level] || level) + ')\n\n' +
          'Add another?  y / n',
          'n'
        );
        if (!another || another.trim().toLowerCase() !== 'y') {
          addingCustom = false;
        }
      }
    }

    return customObjects;
  }

  // ---------------------------------------------------------------------------
  // MINIMUM SET MODE -- patching logic
  // ---------------------------------------------------------------------------

  function buildNewBOR(currentBOR, customObjects) {
    var newBOR = {};

    // Get the effective set (core + LOB if enabled).
    var effective = getEffectiveSet();

    // Apply every effective entry explicitly, including all casing variants.
    // getCasingVariants produces: original, camelCase (first char lower), all-lowercase.
    // Variants that are already present in the effective set under their own key are
    // skipped (e.g. if both 'Journal#Email' and 'journal#email' are listed, the listed
    // rights value always wins and no duplicate is added).
    //
    // BOs listed in FIELD_RIGHTS get explicit field-level control and DefaultFieldRights=null
    // (locking all unlisted fields).  All other BOs get DefaultFieldRights=5 (View+Edit on
    // every field), which is the standard open-access setting for self-service roles.
    var effKeys = Object.keys(effective);
    for (var i = 0; i < effKeys.length; i++) {
      var bo       = effKeys[i];
      var rights   = effective[bo];
      var variants = getCasingVariants(bo);

      for (var vi = 0; vi < variants.length; vi++) {
        var vbo = variants[vi];
        // If this variant is already explicitly listed in the effective set under its
        // own key, skip it here -- it will be processed in its own iteration with its
        // own rights value rather than inheriting from the original.
        if (vbo !== bo && effective.hasOwnProperty(vbo)) continue;
        // Do not overwrite an entry we already placed in this pass.
        if (newBOR.hasOwnProperty(vbo)) continue;

        if (FIELD_RIGHTS.hasOwnProperty(bo)) {
          newBOR[vbo] = { Rights: rights, FieldRights: FIELD_RIGHTS[bo], DefaultFieldRights: null };
          if (vi === 0) {
            console.log(LOG, 'Field-level rights applied for:', bo,
              '(' + Object.keys(FIELD_RIGHTS[bo]).length + ' fields, unlisted fields locked)');
          }
        } else {
          newBOR[vbo] = { Rights: rights, FieldRights: null, DefaultFieldRights: 5 };
        }
      }
    }

    // Apply any user-specified custom objects, also with casing variants.
    var custKeys = Object.keys(customObjects);
    for (var j = 0; j < custKeys.length; j++) {
      var cbo      = custKeys[j];
      var cRights  = customObjects[cbo];
      var cVariants = getCasingVariants(cbo);

      for (var cvi = 0; cvi < cVariants.length; cvi++) {
        var cvbo = cVariants[cvi];
        if (newBOR.hasOwnProperty(cvbo)) continue;
        newBOR[cvbo] = {
          Rights            : cRights,
          FieldRights       : null,
          DefaultFieldRights: cRights > 0 ? 5 : null
        };
      }
    }

    // Explicitly lock every BO already in the role that is not in the effective set.
    var curKeys = Object.keys(currentBOR);
    for (var k = 0; k < curKeys.length; k++) {
      var existing = curKeys[k];
      if (!newBOR.hasOwnProperty(existing)) {
        newBOR[existing] = { Rights: 0, FieldRights: null, DefaultFieldRights: null };
      }
    }

    return newBOR;
  }

  function patchRowConditions(rcObj) {
    // Enum values confirmed from live SaveRole capture (2026-05-26).
    // RowConditionKind: Expression=0, Group=5
    // RowConditionPermission: Read=0, Write=1
    // RowConditionOperator: Or=1
    // NodeKind: Literal=0, Field=1, Binary=3, Function=5
    // Details.Kind: Selection=10 / BinaryOp: Equal=0
    var KIND_EXPR = 0, KIND_GROUP = 5;
    var PERM_READ = 0, PERM_WRITE = 1, OP_OR = 1;
    var NK_LITERAL = 0, NK_FIELD = 1, NK_BINARY = 3, NK_FUNCTION = 5, NK_SEL = 10;
    var OP_EQUAL = 0;

    // Build a single expression leaf: $(fieldName == fnName())
    // Permission=Write required -- AppServer collapses Permission=Read Or-groups
    // to a single Kind:CurrentUser node that matches zero rows (confirmed 2026-05).
    function buildLeaf(fieldName, fnName) {
      return {
        Expression: {
          Description      : null,
          Name             : null,
          FieldRefs        : [fieldName],
          IsFullExpression : true,
          Source           : '$(' + fieldName + ' == ' + fnName + '())',
          ValidationStatus : 0,
          Tree: {
            Op   : OP_EQUAL,
            Left : {
              FieldIndex : 0,
              Details    : {
                Container: null, Selector: fieldName, SubSelector: null,
                IsObjectSelector: false, Qualifiers: null, Kind: NK_SEL
              },
              Kind : NK_FIELD
            },
            Right: {
              Arguments: [], FunctionName: fnName, IsMethod: false, Kind: NK_FUNCTION
            },
            Kind : NK_BINARY
          }
        },
        ExpressionString: '$(' + fieldName + ' == ' + fnName + '())',
        Kind: KIND_EXPR, Not: false, Permission: PERM_WRITE, uiType: 'fieldEqual'
      };
    }

    // Build a single expression leaf comparing a field to a static literal value:
    //   $(fieldName == "value")   for strings
    //   $(fieldName == true)      for booleans
    // perm defaults to PERM_WRITE; pass PERM_READ (0) to restrict read visibility instead.
    // Pass a JS boolean (true/false) for boolean fields -- ISM stores these as bool, not string.
    function buildLiteralLeaf(fieldName, value, perm) {
      var p = (perm !== undefined) ? perm : PERM_WRITE;
      // Strings get double-quoted in the expression; booleans and numbers are bare.
      var srcVal = (typeof value === 'string') ? '"' + value + '"' : String(value);
      var src = '$(' + fieldName + ' == ' + srcVal + ')';
      return {
        Expression: {
          Description      : null,
          Name             : null,
          FieldRefs        : [fieldName],
          IsFullExpression : true,
          Source           : src,
          ValidationStatus : 0,
          Tree: {
            Op   : OP_EQUAL,
            Left : {
              FieldIndex : 0,
              Details    : {
                Container: null, Selector: fieldName, SubSelector: null,
                IsObjectSelector: false, Qualifiers: null, Kind: NK_SEL
              },
              Kind : NK_FIELD
            },
            Right: {
              Value         : value,    // actual JS type (string, boolean, number)
              LongImage     : null,
              IsHex         : false,
              IsVerbatimText: false,
              Kind          : NK_LITERAL
            },
            Kind : NK_BINARY
          }
        },
        ExpressionString: src,
        Kind: KIND_EXPR, Not: false, Permission: p, uiType: 'eq'
      };
    }

    // Build a multi-leaf Or group. All leaves use PERM_WRITE unless overridden.
    function buildOrGroup(leafDefs) {
      var conditions = [];
      for (var i = 0; i < leafDefs.length; i++) {
        conditions.push(buildLeaf(leafDefs[i].field, leafDefs[i].fn));
      }
      return {
        Operator: OP_OR, Conditions: conditions,
        Kind: KIND_GROUP, Not: false, Permission: PERM_WRITE, uiType: null
      };
    }

    // Build a mixed Or group from pre-built leaf objects (function or literal leaves).
    function buildMixedOrGroup(leaves, perm) {
      var p = (perm !== undefined) ? perm : PERM_WRITE;
      return {
        Operator: OP_OR, Conditions: leaves,
        Kind: KIND_GROUP, Not: false, Permission: p, uiType: null
      };
    }

    // Fully replace the RC dictionary -- only the specified BOs survive.
    // Everything else is removed; since DefaultBOR=0 there is no residual access.
    var newRC = {}, applied = [], removed = [];

    // FRS_MyItem# -- preserve OOTB condition exactly as ISM stored it.
    if (rcObj['FRS_MyItem#']) {
      newRC['FRS_MyItem#'] = rcObj['FRS_MyItem#'];
      console.log(LOG, 'Row condition preserved: FRS_MyItem#');
    }

    // Incident# - 3-leaf Or (Write): CreatedBy | Owner | ProfileLink_RecID
    // Widens OOTB single-leaf filter to include records the user owns or is subject of.
    newRC['Incident#'] = buildOrGroup([
      { field: 'CreatedBy',         fn: 'CurrentLoginId'   },
      { field: 'Owner',             fn: 'CurrentLoginId'   },
      { field: 'ProfileLink_RecID', fn: 'CurrentUserRecId' }
    ]);
    applied.push('Incident#');

    // ServiceReq# - same 3-leaf Or shape as Incident#.
    // SR is often raised on a user's behalf (address change, onboarding, etc.)
    // so ProfileLink_RecID is needed to keep those visible in My Items.
    //newRC['ServiceReq#'] = buildOrGroup([
    //  { field: 'CreatedBy',         fn: 'CurrentLoginId'   },
    // { field: 'Owner',             fn: 'CurrentLoginId'   },
    //  { field: 'ProfileLink_RecID', fn: 'CurrentUserRecId' }
    //]);
    //applied.push('ServiceReq#');

    // MyShelfItem# - single leaf (leaf IS the top-level entry, not a group).
    newRC['MyShelfItem#'] = buildLeaf('CreatedBy', 'CurrentLoginId');
    applied.push('MyShelfItem#');

    // FRS_Knowledge# - Write: only Published articles are visible/editable.
    // Read+write scoped together via Permission=Write; keeps unpublished drafts
    // invisible to self-service users who should not see work-in-progress content.
    newRC['FRS_Knowledge#'] = buildLiteralLeaf('Status', '$("Published")', PERM_WRITE);
    applied.push('FRS_Knowledge#');

    // Announcement# - Read: only Published announcements appear on the portal.
    // Permission=Read used here because the role already has View-only rights
    // on Announcement# and we want to restrict which records are returned.
    newRC['Announcement#'] = buildLiteralLeaf('Status', 'Published', PERM_READ);
    applied.push('Announcement#');

    // Journal# - Or (Write): records the user created, or any journal published to the web portal.
    // PublishToWeb is a boolean field -- pass the JS boolean true (not the string 'true')
    // so the tree Right node uses Value:true with the correct CLR_Type in the SOAP payload.
    // Journal subtypes do not have a Status field so PublishToWeb is the correct filter.
    newRC['Journal#'] = buildMixedOrGroup([
      buildLeaf('CreatedBy', 'CurrentLoginId'),
      buildLiteralLeaf('PublishToWeb', true, PERM_WRITE)
    ], PERM_WRITE);
    applied.push('Journal#');

    // Journal#Email - Write: visible only when published to the web portal.
    // PublishToWeb boolean used -- Journal subtypes do not have a Status field.
    newRC['Journal#Email'] = buildLiteralLeaf('PublishToWeb', true, PERM_WRITE);
    applied.push('Journal#Email');

    // Journal#Notes - Write: visible only when published to the web portal.
    // Mirrors Journal#Email treatment for the Notes subtype.
    newRC['Journal#Notes'] = buildLiteralLeaf('PublishToWeb', true, PERM_WRITE);
    applied.push('Journal#Notes');

    // Track which existing conditions are dropped.
    var curKeys = Object.keys(rcObj);
    for (var k = 0; k < curKeys.length; k++) {
      if (!newRC.hasOwnProperty(curKeys[k])) removed.push(curKeys[k]);
    }
    if (removed.length > 0) console.log(LOG, 'Row conditions removed:', removed.join(', '));

    return { rc: newRC, applied: applied, removed: removed };
  }

  function applyMinimumSet(rpStr, customObjects) {
    var rcApplied = [], rcRemoved = [];

    // Zero global defaults -- any BO not explicitly listed gets no access.
    rpStr = replaceIntField(rpStr, 'DefaultBusinessObjectRights', 0);
    rpStr = replaceIntField(rpStr, 'DefaultBusinessObjectFieldRights', 0);

    // Replace BusinessObjectRights block.
    var BOR_KEY = '"BusinessObjectRights":';
    var bkIdx   = rpStr.indexOf(BOR_KEY);
    if (bkIdx === -1) throw new Error('BusinessObjectRights key not found in RolePolicy');
    var bStart = bkIdx + BOR_KEY.length;
    while (bStart < rpStr.length && (rpStr[bStart] === ' ' || rpStr[bStart] === '\t')) bStart++;
    if (rpStr[bStart] !== '{') throw new Error('Expected { at start of BusinessObjectRights value');
    var bEnd = findObjectEnd(rpStr, bStart);
    if (bEnd === -1) throw new Error('Could not find closing } for BusinessObjectRights');

    var currentBOR   = JSON.parse(rpStr.slice(bStart, bEnd));
    var newBOR       = buildNewBOR(currentBOR, customObjects);
    var effective    = getEffectiveSet();
    var grantedCount = Object.keys(effective).length + Object.keys(customObjects).length;
    var lockedCount  = Object.keys(newBOR).filter(function (b) { return newBOR[b].Rights === 0; }).length;
    console.log(LOG, 'BOR stats: existing=' + Object.keys(currentBOR).length +
      ', granted=' + grantedCount + ', explicitly locked=' + lockedCount);
    rpStr = rpStr.slice(0, bStart) + JSON.stringify(newBOR) + rpStr.slice(bEnd);

    // Patch BusinessObjectRowConditions block.
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
            var rcResult  = patchRowConditions(currentRC);
            rcApplied     = rcResult.applied;
            rcRemoved     = rcResult.removed || [];

            // Guard against ISM's legacy Array.prototype.toJSON double-serialising arrays.
            // The legacy framework makes JSON.stringify encode arrays as strings instead of
            // proper [...] arrays. Temporarily removing it restores correct behaviour.
            var _savedAtj = Array.prototype.toJSON;
            try { delete Array.prototype.toJSON; } catch (_e) { Array.prototype.toJSON = undefined; }
            var _rcJson;
            try { _rcJson = JSON.stringify(rcResult.rc); }
            finally { if (typeof _savedAtj !== 'undefined') Array.prototype.toJSON = _savedAtj; }

            rpStr = rpStr.slice(0, rcStart) + _rcJson + rpStr.slice(rcEnd);
            if (rcApplied.length > 0) console.log(LOG, 'Row conditions applied:', rcApplied.join(', '));
            if (rcRemoved.length > 0) console.log(LOG, 'Row conditions removed:', rcRemoved.join(', '));
          } catch (rcErr) {
            console.error(LOG, 'Row conditions patch failed (rights changes still applied):', rcErr.message);
          }
        }
      }
    }

    return { patched: rpStr, newBOR: newBOR, rcApplied: rcApplied, rcRemoved: rcRemoved };
  }

  // ---------------------------------------------------------------------------
  // YAML REPORTS
  // ---------------------------------------------------------------------------

  function buildPreYaml(roleId, rp, ts, replacedBy) {
    var lines = [];
    lines.push('# ISM Role - Pre-Patcher Permissions Capture');
    lines.push('# Generated  : ' + ts);
    lines.push('# Script     : AHPatcher');
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
            var boKeys = Object.keys(bor);
            var granted = [], locked = [];
            for (var i = 0; i < boKeys.length; i++) {
              var entry = bor[boKeys[i]];
              if (entry && entry.Rights > 0) granted.push(boKeys[i]); else locked.push(boKeys[i]);
            }
            lines.push('business_object_rights:');
            lines.push('');
            lines.push('  # --- Granted (' + granted.length + ' BOs with Rights > 0) ---');
            for (var g = 0; g < granted.length; g++) {
              var gbo    = granted[g];
              var gentry = bor[gbo];
              var dfr    = (gentry.DefaultFieldRights !== null && gentry.DefaultFieldRights !== undefined)
                           ? '  # DefaultFieldRights: ' + rightsLabel(gentry.DefaultFieldRights) : '';
              lines.push('  "' + gbo + '": ' + rightsLabel(gentry.Rights) + dfr);
            }
            lines.push('');
            lines.push('  # --- Explicitly locked to NotSet (' + locked.length + ' BOs) ---');
            lines.push('  # Not listed individually for brevity.');
            lines.push('');
            lines.push('  summary:');
            lines.push('    total_explicit : ' + boKeys.length);
            lines.push('    granted        : ' + granted.length);
            lines.push('    locked         : ' + locked.length);
          } catch (e) { lines.push('  # ERROR parsing BusinessObjectRights: ' + e.message); }
        }
      }
    }

    var RC_KEY = '"BusinessObjectRowConditions":';
    var rcIdx  = rp.indexOf(RC_KEY);
    if (rcIdx !== -1) {
      var rcStart = rcIdx + RC_KEY.length;
      while (rcStart < rp.length && (rp[rcStart] === ' ' || rp[rcStart] === '\t')) rcStart++;
      if (rp[rcStart] === '{') {
        var rcEnd = findObjectEnd(rp, rcStart);
        if (rcEnd !== -1) {
          try {
            var rc = JSON.parse(rp.slice(rcStart, rcEnd));
            var rcKeys = Object.keys(rc);
            lines.push('');
            lines.push('row_conditions:');
            lines.push('  # ' + rcKeys.length + ' business object(s) have row conditions.');
            for (var r = 0; r < rcKeys.length; r++) {
              var rbo  = rcKeys[r];
              var rcnd = rc[rbo];
              var rcType = 'unknown';
              if (rcnd.Conditions !== undefined) {
                var lc = Array.isArray(rcnd.Conditions) ? rcnd.Conditions.length : '?';
                rcType = 'group (' + lc + ' leaf/leaves, Operator=' + rcnd.Operator + ')';
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
          } catch (e) { lines.push('  # ERROR parsing BusinessObjectRowConditions: ' + e.message); }
        }
      }
    }

    return lines.join('\n');
  }

  function buildAppliedYaml(roleId, newBOR, customObjects, rcApplied, rcRemoved, ts) {
    var effective = getEffectiveSet();
    var msKeys    = Object.keys(MINIMUM_SET);
    var lobKeys   = TENANT_HAS_LOB ? Object.keys(LOB_SET) : [];
    var custKeys  = Object.keys(customObjects);
    var allKeys   = Object.keys(newBOR);
    var lockedCount = 0;
    for (var i = 0; i < allKeys.length; i++) {
      if (newBOR[allKeys[i]].Rights === 0 &&
          !MINIMUM_SET.hasOwnProperty(allKeys[i]) &&
          !LOB_SET.hasOwnProperty(allKeys[i]) &&
          custKeys.indexOf(allKeys[i]) === -1) lockedCount++;
    }

    var lines = [];
    lines.push('# ISM Role - Applied Permissions Report (Minimum Set Mode)');
    lines.push('# Generated : ' + ts);
    lines.push('# Script    : AHPatcher');
    lines.push('# LOB mode  : ' + (TENANT_HAS_LOB ? 'enabled' : 'disabled'));
    lines.push('');
    lines.push('role_id: ' + roleId);
    lines.push('');
    lines.push('defaults:');
    lines.push('  DefaultBusinessObjectRights: NotSet_0');
    lines.push('  DefaultBusinessObjectFieldRights: NotSet_0');
    lines.push('  # These two defaults cover all BOs not listed below (~1200+ implicitly locked).');
    lines.push('');
    lines.push('business_object_rights:');
    lines.push('');
    lines.push('  # --- Core minimum set (' + msKeys.length + ' entries) ---');
    for (var m = 0; m < msKeys.length; m++) {
      var bo     = msKeys[m];
      var entry  = newBOR[bo] || { Rights: 0 };
      var rcNote = rcApplied.indexOf(bo) !== -1 ? '  # row-condition applied' : '';
      lines.push('  "' + bo + '": ' + rightsLabel(entry.Rights) + rcNote);
    }
    if (TENANT_HAS_LOB && lobKeys.length > 0) {
      lines.push('');
      lines.push('  # --- LOB set (' + lobKeys.length + ' entries, TENANT_HAS_LOB=true) ---');
      for (var l = 0; l < lobKeys.length; l++) {
        var lbo    = lobKeys[l];
        var lentry = newBOR[lbo] || { Rights: 0 };
        lines.push('  "' + lbo + '": ' + rightsLabel(lentry.Rights));
      }
    }
    if (custKeys.length > 0) {
      lines.push('');
      lines.push('  # --- Custom objects (' + custKeys.length + ' user-specified at runtime) ---');
      for (var c = 0; c < custKeys.length; c++) {
        var cbo    = custKeys[c];
        var centry = newBOR[cbo] || { Rights: 0 };
        lines.push('  "' + cbo + '": ' + rightsLabel(centry.Rights) + '  # custom');
      }
    }
    lines.push('');
    lines.push('  # --- Locked to NotSet (previously explicit BOs not in minimum set) ---');
    lines.push('  # Count: ' + lockedCount);
    lines.push('  # Not listed individually for brevity.');
    lines.push('');
    lines.push('row_conditions:');
    lines.push('  applied:');
    if (rcApplied.length === 0) {
      lines.push('    - "(none)"');
    } else {
      for (var a = 0; a < rcApplied.length; a++) lines.push('    - "' + rcApplied[a] + '"');
    }
    lines.push('');
    lines.push('  preserved:');
    lines.push('    - "FRS_MyItem#"  # OOTB condition preserved as-is');
    lines.push('');
    lines.push('  # Incident# and ServiceReq#: 3-leaf Or group (Permission=Write)');
    lines.push('  #   $(CreatedBy == CurrentLoginId())');
    lines.push('  #   $(Owner == CurrentLoginId())');
    lines.push('  #   $(ProfileLink_RecID == CurrentUserRecId())');
    lines.push('  # MyShelfItem#: single leaf $(CreatedBy == CurrentLoginId())');
    if (rcRemoved.length > 0) {
      lines.push('');
      lines.push('row_conditions_removed:');
      lines.push('  # These BOs had row conditions dropped (not in minimum specification).');
      for (var rem = 0; rem < rcRemoved.length; rem++) lines.push('  - "' + rcRemoved[rem] + '"');
    }
    return lines.join('\n');
  }

  // ---------------------------------------------------------------------------
  // INSTALL INTERCEPTOR
  // ---------------------------------------------------------------------------

  function installInterceptor(getPayload, onSuccessCallback, readyMsg) {
    var _origInvoke = Sys.Net.WebServiceProxy.invoke;

    Sys.Net.WebServiceProxy.invoke = function (servicePath, methodName, useGet, params,
                                               onSuccess, onFailure, userContext, timeout,
                                               enableJsonp, jsonpCallbackParameter) {

      if (methodName === 'SaveRole' && params && params.data) {

        Sys.Net.WebServiceProxy.invoke = _origInvoke;

        var roleId        = params.data.RoleID || 'Unknown';
        var ts            = getTimestamp();
        var currentPolicy = params.data.RolePolicy;

        console.log(LOG, 'Intercepted SaveRole for role:', roleId);

        // Download current state before touching anything.
        downloadFile(roleId + '_pre-patcher_snapshot_' + ts + '.json', currentPolicy, 'application/json');
        console.log(LOG, 'Pre-patcher snapshot saved: ' + roleId + '_pre-patcher_snapshot_' + ts + '.json');

        var result = getPayload(currentPolicy, roleId, ts);

        try {
          var preYaml = buildPreYaml(roleId, currentPolicy, ts, result.replacedBy);
          downloadFile(roleId + '_pre-patcher_permissions_' + ts + '.yaml', preYaml, 'text/yaml');
          console.log(LOG, 'Pre-patcher YAML saved: ' + roleId + '_pre-patcher_permissions_' + ts + '.yaml');
        } catch (yamlErr) {
          console.error(LOG, 'Pre-patcher YAML failed (patcher will still proceed):', yamlErr.message);
        }

        params.data.RolePolicy = result.policy;

        var _origOk   = onSuccess;
        var _origFail = onFailure;

        return _origInvoke.apply(this, [
          servicePath, methodName, useGet, params,

          function () {
            console.log(LOG, 'PATCHER SUCCEEDED. Navigate away and back to Object Permissions to confirm changes.');
            onSuccessCallback(roleId, ts, result);
            if (_origOk) _origOk.apply(this, arguments);
          },

          function (err) {
            console.error(LOG, 'PATCHER FAILED:', err && (err.Message || err));
            Sys.Net.WebServiceProxy.invoke = _origInvoke;
            if (_origFail) _origFail.apply(this, arguments);
          },

          userContext, timeout, enableJsonp, jsonpCallbackParameter
        ]);
      }

      return _origInvoke.apply(this, [servicePath, methodName, useGet, params,
        onSuccess, onFailure, userContext, timeout, enableJsonp, jsonpCallbackParameter]);
    };

    console.log(LOG, '==============================================');
    console.log(LOG, ' PATCHER READY                               ');
    console.log(LOG, '----------------------------------------------');
    for (var i = 0; i < readyMsg.length; i++) console.log(LOG, readyMsg[i]);
    console.log(LOG, '----------------------------------------------');
    console.log(LOG, ' On Save, current state is captured first,   ');
    console.log(LOG, ' then the new policy is applied.             ');
    console.log(LOG, ' Make any change on the page and click Save. ');
    console.log(LOG, '==============================================');
  }

  // ---------------------------------------------------------------------------
  // FILE PICKER -- branch point: snapshot mode vs minimum set mode
  // ---------------------------------------------------------------------------

  var input = document.createElement('input');
  input.type   = 'file';
  input.accept = '.json,application/json,text/plain';
  input.style.display = 'none';
  document.body.appendChild(input);

  var pickerResolved = false;

  function onPickerCancel() {
    if (pickerResolved) return;
    pickerResolved = true;
    document.body.removeChild(input);
    console.log(LOG, 'No file selected -- switching to minimum set mode.');

    var effective = getEffectiveSet();
    var customObjects = promptCustomObjects(
      'Mode: MINIMUM SET\n' +
      'Core BOs  : ' + Object.keys(MINIMUM_SET).length + '\n' +
      'LOB BOs   : ' + (TENANT_HAS_LOB ? Object.keys(LOB_SET).length + ' (TENANT_HAS_LOB=true)' : '0 (TENANT_HAS_LOB=false)') + '\n' +
      'Total     : ' + Object.keys(effective).length + '\n' +
      'Everything else will be set to NotSet (0).'
    );
    var custCount = Object.keys(customObjects).length;
    if (custCount > 0) {
      console.log(LOG, custCount + ' custom object(s) queued:', Object.keys(customObjects).join(', '));
    }

    installInterceptor(
      function (currentPolicy, roleId, ts) {
        var patchResult = applyMinimumSet(currentPolicy, customObjects);
        console.log(LOG, 'Minimum set applied -- sending to server...');
        return {
          policy       : patchResult.patched,
          replacedBy   : 'minimum-set (AHPatcher, LOB=' + TENANT_HAS_LOB + ')',
          newBOR       : patchResult.newBOR,
          rcApplied    : patchResult.rcApplied,
          rcRemoved    : patchResult.rcRemoved,
          mode         : 'minimum-set',
          customObjects: customObjects
        };
      },
      function (roleId, ts, result) {
        try {
          var yaml = buildAppliedYaml(roleId, result.newBOR, result.customObjects,
                                      result.rcApplied, result.rcRemoved, ts);
          downloadFile(roleId + '_applied_' + ts + '.yaml', yaml, 'text/yaml');
          console.log(LOG, 'Applied YAML saved: ' + roleId + '_applied_' + ts + '.yaml');
        } catch (e) { console.error(LOG, 'Applied YAML failed:', e.message); }
      },
      [
        ' Mode      : MINIMUM SET',
        ' Core BOs  : ' + Object.keys(MINIMUM_SET).length,
        ' LOB BOs   : ' + (TENANT_HAS_LOB ? Object.keys(LOB_SET).length + ' (enabled)' : '0 (disabled)'),
        ' Custom BOs: ' + custCount,
        ' Row conds : Incident# | ServiceReq# | MyShelfItem#'
      ]
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

      var parsedSnapshot;
      try {
        parsedSnapshot = JSON.parse(snapshotJson);
        if (!parsedSnapshot.BusinessObjectRights) {
          throw new Error('BusinessObjectRights key missing -- is this a RolePolicy snapshot?');
        }
        var boCount = Object.keys(parsedSnapshot.BusinessObjectRights).length;
        var rcCount = parsedSnapshot.BusinessObjectRowConditions
          ? Object.keys(parsedSnapshot.BusinessObjectRowConditions).length : 0;
        console.log(LOG, 'Snapshot validated:',
          boCount, 'BOs,', rcCount, 'row conditions,',
          'DefaultBOR=' + parsedSnapshot.DefaultBusinessObjectRights,
          'DefaultBOFR=' + parsedSnapshot.DefaultBusinessObjectFieldRights);
      } catch (err) {
        console.error(LOG, 'Invalid snapshot file:', err.message);
        return;
      }

      var customObjects = promptCustomObjects(
        'Mode: SNAPSHOT\n' +
        'File: ' + file.name + '\n' +
        'BOs in snapshot: ' + Object.keys(parsedSnapshot.BusinessObjectRights).length
      );
      var custCount = Object.keys(customObjects).length;

      if (custCount > 0) {
        console.log(LOG, custCount + ' custom object(s) queued:', Object.keys(customObjects).join(', '));
        var custKeys = Object.keys(customObjects);
        for (var ci = 0; ci < custKeys.length; ci++) {
          var cbo = custKeys[ci];
          parsedSnapshot.BusinessObjectRights[cbo] = {
            Rights          : customObjects[cbo],
            FieldRights     : null,
            DefaultFieldRights: customObjects[cbo] > 0 ? 5 : null
          };
        }
        snapshotJson = JSON.stringify(parsedSnapshot);
        console.log(LOG, 'Snapshot updated with custom objects.');
      }

      installInterceptor(
        function (currentPolicy, roleId, ts) {
          console.log(LOG, 'Applying snapshot:', file.name, '(' + snapshotJson.length + ' chars)');
          if (custCount > 0) {
            console.log(LOG, 'Custom objects merged:', Object.keys(customObjects).join(', '));
          }
          return {
            policy       : snapshotJson,
            replacedBy   : file.name,
            mode         : 'snapshot',
            customObjects: customObjects
          };
        },
        function (roleId, ts, result) {
          console.log(LOG, 'Snapshot mode -- pre-patcher files are your record of what changed.');
        },
        [
          ' Mode      : SNAPSHOT',
          ' File      : ' + file.name,
          ' Custom BOs: ' + custCount
        ]
      );
    };

    reader.onerror = function () { console.error(LOG, 'Failed to read file:', file.name); };
    reader.readAsText(file);
  });

  // Detect cancel via focus returning without a change event.
  window.addEventListener('focus', function onFocus() {
    window.removeEventListener('focus', onFocus);
    setTimeout(function () { onPickerCancel(); }, 300);
  });

  console.log(LOG, 'File picker opening...');
  console.log(LOG, '  Pick a snapshot JSON  -->  Snapshot mode');
  console.log(LOG, '  Cancel                -->  Minimum set mode (LOB=' + TENANT_HAS_LOB + ')');
  input.click();

})();