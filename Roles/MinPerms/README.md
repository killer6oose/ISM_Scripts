# ISM SelfService Role Permission Patcher

**Author:** Andrew Hatton - Andrew.Hatton@ivanti.com

---

> **Before you do anything else, please read this.**
>
> These scripts make direct, live changes to role permissions in Ivanti Neurons for ITSM by intercepting the browser's save mechanism. They are not reversible through an "undo" button. Always run in a Staging or UAT environment first. Always capture a snapshot before applying changes to Production.

---

## What is this?

Two browser console scripts for managing ISM role permissions without API keys, installed tools, or server-side changes. You paste them into the browser developer console while logged into ISM as an admin.

`AHPatcher-v4.js` is the main tool. It locks down Business Object rights, zeros the global defaults, applies row-level conditions so self-service users only see their own records, and optionally restricts access at the individual field level. It also runs in snapshot mode - pick a previously captured snapshot file and it copies that role's exact permissions onto whatever role you have open.

`AHPatcher-Interceptor-v2.js` is the capture tool. It sits in the background, intercepts the next save on any Object Permissions page, and exports the role's current state as both a raw JSON snapshot and a human-readable YAML report. It does not modify anything. It re-installs itself after each capture so you can snapshot multiple roles in a single session.

---

## Files

| File | Lines | What it does |
|---|---|---|
| `AHPatcher-v4.js` | 1242 | Applies minimum-privilege rights and row conditions, or restores from a snapshot |
| `AHPatcher-Interceptor-v2.js` | 309 | Captures current role permissions to JSON + YAML, no modifications |

---

## Prerequisites

- Logged into your ISM tenant as a user with admin access to Roles
- Browser developer console open (F12, then the Console tab)
- On the **Object Permissions** page for the role you want to target

---

## AHPatcher-v4.js - script structure

| Lines | Section | What it does |
|---|---|---|
| 58-88 | **Configuration** | `TENANT_HAS_LOB` toggle - set to `true` if this tenant has Line of Business modules installed |
| 90-92 | **Rights constants** | `R.VIEW`, `R.VIEW_ADD_EDIT`, `R.FULL` etc. - bitmask shorthand used throughout |
| 95-238 | **MINIMUM_SET** | ~125 business objects and their access levels. Edit this block to change the default minimum set |
| 246-280 | **LOB_SET** | Additional BOs granted when `TENANT_HAS_LOB = true` - Security Incidents, HR Cases, Work Orders, Demand/PPM, and their lookup tables |
| 309-340 | **FIELD_RIGHTS** | Optional per-BO field-level access control. Add entries here to lock specific BOs down to named fields only |
| 358-387 | **Helpers** | `getTimestamp`, `downloadFile`, `findObjectEnd`, `replaceIntField`, `rightsLabel` |
| 388-425 | **getCasingVariants** | Generates original, lowercase, title-cased, and camelCase variants of every BO name automatically so you do not need to list duplicates manually |
| 427-444 | **getEffectiveSet** | Returns MINIMUM_SET merged with LOB_SET when enabled |
| 446-510 | **promptCustomObjects** | Runs before the interceptor installs - lets you add or override BOs at paste time without editing the script |
| 512-582 | **buildNewBOR** | Builds the new BusinessObjectRights dictionary - merges the effective set, FIELD_RIGHTS, custom objects, and explicitly locks everything else to 0. Fans out casing variants for every entry |
| 584-766 | **patchRowConditions** | Builds and injects row-level conditions for 8 BOs. Preserves FRS_MyItem# as-is. Drops all other pre-existing conditions |
| 768-833 | **applyMinimumSet** | Orchestrates the minimum set patch - zeros defaults, replaces BOR block, patches row conditions |
| 835-929 | **buildPreYaml** | Builds the pre-change YAML report capturing the role's state before any modifications |
| 931-1017 | **buildAppliedYaml** | Builds the applied report YAML for minimum set mode - lists core set, LOB set, custom objects, field rights, and row conditions |
| 1019-1091 | **installInterceptor** | Generic interceptor used by both modes - downloads pre-patcher snapshot and YAML, applies the payload, downloads the applied report on success |
| 1093-1242 | **File picker and mode branching** | Opens the file picker on paste, detects cancel, branches into snapshot mode or minimum set mode |

---

## AHPatcher-Interceptor-v2.js - script structure

| Lines | Section | What it does |
|---|---|---|
| 46-60 | **Constants** | `LOG` prefix, capture counter, rights label map |
| 62-101 | **Helpers** | `getTimestamp`, `downloadFile`, `rightsLabel`, `findObjectEnd` |
| 103-243 | **buildYaml** | Builds the permissions YAML - lists all granted BOs with rights labels, field-level rights blocks where present, DefaultFieldRights, and a row conditions summary |
| 244-295 | **installInterceptor** | Hooks `Sys.Net.WebServiceProxy.invoke`, fires on the next SaveRole call, downloads JSON + YAML, then re-installs for the next save |
| 296-309 | **Ready banner** | Console output confirming the script is loaded and waiting |

---

## Row conditions applied by AHPatcher-v4.js

| Business object | Type | Permission | Logic |
|---|---|---|---|
| `FRS_MyItem#` | Preserved | - | Kept exactly as ISM stored it (OOTB condition) |
| `Incident#` | Or group | Write | `CreatedBy == CurrentLoginId()` OR `Owner == CurrentLoginId()` OR `ProfileLink_RecID == CurrentUserRecId()` |
| `ServiceReq#` | Or group | Write | Same 3-leaf Or group as Incident# |
| `MyShelfItem#` | Single | Write | `CreatedBy == CurrentLoginId()` |
| `FRS_Knowledge#` | Single | Write | `Status == "Published"` |
| `Announcement#` | Single | Read | `Status == "Published"` |
| `Journal#` | Or group | Write | `CreatedBy == CurrentLoginId()` OR `PublishToWeb == true` |
| `Journal#Email` | Single | Write | `PublishToWeb == true` |
| `Journal#Notes` | Single | Write | `PublishToWeb == true` |

All other pre-existing row conditions are removed. Because `DefaultBusinessObjectRights` is zeroed, removed conditions leave no residual access.

---

## Using AHPatcher-v4.js

### Step 1 - Get to the right page

Log into ISM, go to **Admin > Roles**, click your target role (e.g. `SelfService`), then click the **Object Permissions** tab.

### Step 2 - Configure the script (if needed)

Before pasting, check the two config sections near the top of the file:

```javascript
var TENANT_HAS_LOB = false;
```

Set this to `true` if the tenant has LOB modules. If you only want the core minimum set, leave it as `false`.

```javascript
var FIELD_RIGHTS = {
  // 'Employee#': {
  //   'FirstName'   : R.VIEW,
  //   'LastName'    : R.VIEW,
  //   'LoginID'     : R.VIEW,
  //   'PrimaryEmail': R.VIEW
  // }
};
```

Add entries here for any BO where you want to restrict access to specific fields only. BOs listed here get `DefaultFieldRights: null` - unlisted fields are blocked.

### Step 3 - Paste the script

Paste the entire script into the console and press Enter. A file picker opens immediately.

### Step 4 - Choose your mode

**Snapshot mode** - pick a JSON snapshot file. The script applies that snapshot's exact permissions to the role you have open. The snapshot can come from `AHPatcher-Interceptor-v2.js`, from a previous `AHPatcher-v4.js` run, or from any role - it does not have to match the target role.

**Minimum set mode** - click Cancel in the file picker. The script switches to minimum set mode and shows a prompt asking if you want to add any custom BOs on top.

### Step 5 - Trigger the save

Tick or untick any checkbox on the page, then click **Save**. Before anything reaches the server the script:

1. Downloads `<RoleID>_pre-patcher_snapshot_<timestamp>.json` - the role's current state
2. Downloads `<RoleID>_pre-patcher_permissions_<timestamp>.yaml` - a readable summary of the current state
3. Applies the snapshot or minimum set

On success in minimum set mode, it also downloads `<RoleID>_applied_<timestamp>.yaml`.

A successful minimum set run looks like this in the console:

```
[AHPatcher] Intercepted SaveRole for role: SelfService
[AHPatcher] Pre-patcher snapshot saved: SelfService_pre-patcher_snapshot_2026-05-26T16-10-00.json
[AHPatcher] Pre-patcher YAML saved: SelfService_pre-patcher_permissions_2026-05-26T16-10-00.yaml
[AHPatcher] Set DefaultBusinessObjectRights: 7 -> 0
[AHPatcher] BOR stats: existing=57, granted=125, explicitly locked=29
[AHPatcher] Row condition preserved: FRS_MyItem#
[AHPatcher] Row conditions applied: Incident#, ServiceReq#, MyShelfItem#, FRS_Knowledge#, Announcement#, Journal#, Journal#Email, Journal#Notes
[AHPatcher] PATCHER SUCCEEDED. Navigate away and back to Object Permissions to confirm changes.
```

---

## Using AHPatcher-Interceptor-v2.js

### Step 1 - Get to the right page

Admin > Roles > any role > Object Permissions.

### Step 2 - Paste the script

Paste and press Enter. You will see:

```
[AHCapture] =================================================
[AHCapture]  AHCapture - Role Permissions Capture
[AHCapture] -------------------------------------------------
[AHCapture]  Does NOT modify anything -- pure capture mode.
[AHCapture]  Re-installs automatically after each save.
[AHCapture] -------------------------------------------------
[AHCapture]  1. Tick or untick any checkbox on the page
[AHCapture]  2. Click Save
[AHCapture]  3. Check Downloads for .json and .yaml files
[AHCapture] =================================================
```

### Step 3 - Trigger the save

Tick or untick any checkbox and click Save. Two files download:

- `<RoleID>_snapshot_<timestamp>.json` - the raw RolePolicy, compatible with AHPatcher-v4.js snapshot mode
- `<RoleID>_permissions_<timestamp>.yaml` - human-readable BO rights summary including any field-level rights blocks

The interceptor re-installs automatically. Navigate to another role and repeat without re-pasting.

### Using it as a pre-flight check

Run the interceptor on the role you are about to patch. Check the YAML to confirm what is currently set. Then switch to AHPatcher-v4.js for the actual changes.

### Using AHPatcher-v4.js as a permissions copy tool

The target role is determined by which Object Permissions page you are on - not by what is in the snapshot file. This means you can use it to copy permissions between roles:

1. Run `AHPatcher-Interceptor-v2.js` on Role A to get `RoleA_snapshot_<ts>.json`
2. Navigate to Role B's Object Permissions page
3. Paste `AHPatcher-v4.js`, pick `RoleA_snapshot_<ts>.json`
4. Role B now has Role A's exact permissions

---

## FIELD_RIGHTS - field-level access control

By default every granted BO gets `DefaultFieldRights: 5` (View + Edit on all fields). If you need tighter control, add the BO to the `FIELD_RIGHTS` block before pasting:

```javascript
var FIELD_RIGHTS = {
  'Employee#': {
    'FirstName'    : R.VIEW,
    'LastName'     : R.VIEW,
    'LoginID'      : R.VIEW,
    'PrimaryEmail' : R.VIEW,
    'Department'   : R.VIEW
  }
};
```

When a BO is listed here:
- Only the named fields get the specified rights (`R.VIEW` = 1, `R.VIEW_EDIT` = 5)
- All other fields on that BO are locked (`DefaultFieldRights: null`)
- The BO-level rights value from MINIMUM_SET or LOB_SET still applies as normal

Add and Delete do not apply at field level - only View (1) and View + Edit (5) are valid.

Casing variants are applied to FIELD_RIGHTS entries the same as BO names - you do not need to list `employee#` separately.

---

## Automatic casing variants

ISM's AppServer does not always look up business object names consistently with casing. Rather than listing every variant manually, `getCasingVariants` generates all realistic forms for every BO in the effective set, in FIELD_RIGHTS, and for runtime custom objects.

For any BO name, the script produces:

| Form | Example: `Journal#Email` | Example: `incident#` |
|---|---|---|
| Original | `Journal#Email` | `incident#` |
| Lowercase | `journal#email` | `incident#` |
| Title-cased (segments split on `#` and `_`) | `Journal#Email` | `Incident#` |
| camelCase (title-cased, first char lowercased) | `journal#Email` | `incident#` |

Duplicates are removed.

One known limitation: compound PascalCase words without a delimiter (e.g. `ServiceReq`, `FulfillmentItem`) cannot be reconstructed from a fully lowercase input. Write the canonical ISM name in MINIMUM_SET and the lowercase form is generated automatically. The reverse works fine for single-word names like `Incident#`.

---

## Custom BO access levels

| Value | Meaning |
|---|---|
| 0 | No access |
| 1 | View only (R) |
| 3 | View + Add (RC) |
| 5 | View + Edit (RU) |
| 7 | View + Add + Edit (CRU) |
| 15 | Full - View + Add + Edit + Delete (CRUD) |

---

## What the minimum set actually changes

**Zeros the global defaults**
`DefaultBusinessObjectRights` and `DefaultBusinessObjectFieldRights` are both set to 0. Any BO not explicitly listed gets no access at all.

**Applies Business Object Rights**
Around 125 core BOs are explicitly granted the minimum rights needed for self-service functionality. If `TENANT_HAS_LOB = true`, LOB BOs are added on top. Everything else is explicitly locked to `Rights: 0`. Casing variants are written for each entry.

**Applies row-level conditions**
Row conditions are applied to 9 BOs - see the table above. FRS_MyItem# is preserved as-is from whatever ISM has stored. All other pre-existing row conditions are removed.

---

## Troubleshooting

**The script loads but nothing happens when I click Save**
ISM will not fire a SaveRole request if it thinks nothing changed. Make sure you have ticked or unticked at least one checkbox before clicking Save.

**The save fails with a server error**
Check the console for the error message. If you see anything about array serialisation or "StartArray token is expected", you may be running an older version of the script. The current version patches `Array.prototype.toJSON` before serialising row conditions to avoid this.

**The page refreshes but the permissions look wrong**
Check the downloaded YAML report. It lists every BO that was granted or locked and every row condition that was applied or removed.

**No snapshot or YAML file downloaded**
Your browser may have blocked the automatic downloads. Check your browser's download settings and make sure downloads are not blocked for the ISM domain.

**I want to target a different role**
Navigate to that role's Object Permissions page first, then paste the script. The target role is determined entirely by which page you are on.

**I need to change the minimum set permanently**
Edit the `MINIMUM_SET` block directly in the script before pasting (lines 95-238). LOB-specific entries are in the `LOB_SET` block (lines 246-280).

**A custom BO I added does not seem to have taken effect**
The script generates casing variants automatically, but compound PascalCase words (e.g. `ServiceReq`) cannot be reconstructed from an all-lowercase input. Use the canonical ISM name when adding custom BOs at the prompt.

---

## Environment recommendation

| Environment | Recommendation |
|---|---|
| Dev / Sandbox | Fine to run freely |
| Staging / UAT | Run and validate thoroughly before touching Production |
| Production | Only after validating in a lower environment. Keep your snapshot files. |

---

## Disclaimer

**Author:** Andrew Hatton - Andrew.Hatton@ivanti.com

THIS CODE AND INFORMATION IS PROVIDED "AS IS" WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESSED OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE IMPLIED WARRANTIES OF MERCHANTABILITY AND/OR FITNESS FOR A PARTICULAR PURPOSE. IMPORTANT: Please take care when executing this script on a live database or system. It is recommended that a full backup is first performed.

The author (Andrew Hatton) accepts no personal liability for any issues, data loss, misconfiguration, or unintended consequences arising from the execution of this script against any environment. This script modifies live role permissions and security policies in Ivanti Neurons for ITSM. It is your responsibility to validate all changes in a lower environment (Staging, UAT, Dev, or equivalent) before executing against any Production tenant. By running this script you accept all risk associated with its use.