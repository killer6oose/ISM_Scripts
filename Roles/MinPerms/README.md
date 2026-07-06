# ISM SelfService Role Permission Patcher

**Author:** Andrew Hatton - Andrew.Hatton@ivanti.com

---

> **Before you do anything else, please read this.**
>
> These scripts make direct, live changes to role permissions in Ivanti Neurons for ITSM by intercepting the browser's save mechanism. They are not reversible through an "undo" button. Always run in a Staging or UAT environment first. Always capture a snapshot before applying changes to Production.

---

## What is this?

Two browser console scripts for managing ISM role permissions without API keys, installed tools, or server-side changes. You paste them into the browser developer console while logged into ISM as an admin.

`AHPatcher-v5.js` is the main tool. Rather than using hardcoded permission sets, it fetches per-role configuration files from a public GitHub repository at runtime. A 4-step wizard modal guides through version checking, role config selection, mode choice, and optional overrides before arming the interceptor. It applies a loaded config, or restores from a previously saved snapshot.

`AHPatcher-Interceptor-v2.js` is the capture tool. It sits in the background, intercepts the next save on any Object Permissions page, and exports the role's current state as both a raw JSON snapshot and a human-readable YAML report. It does not modify anything. It re-installs itself after each capture so you can snapshot multiple roles in a single session.

---

## Files

| File | What it does |
|---|---|
| `AHPatcher-latest.js`| GitHub-driven role patcher with a multi-step wizard UI |
| `AHPatcher-Interceptor-v2.js` | Captures current role permissions to JSON + YAML, no modifications |

---

## GitHub config repository

Role permission sets live in a separate public repository rather than in the script itself. This means updating permissions for any role does not require editing or redistributing the script.

Each role has its own JSON file in the 2026.x (or whatever version you are looking for) directory:

```
Roles/MinPerms/2026.x/
  SelfServiceMobile.json
  GRCManager.json
  GRCAnalyst.json
  etc.json......
  version.txt          <-- plain text, contains current version e.g. 5.0.0
```

When the script is pasted it fetches the directory listing from the GitHub API, presents the available files in a dropdown, and fetches the chosen config before opening the file picker.

### Role config file format

Each `.json` file contains three sections:

```json
{
  "role": "SelfServiceMobile",
  "version": "2026.x",
  "description": "...",
  "business_object_rights": {
    "Incident#": 7,
    "ServiceReq#": 7,
    "Employee#": 1
  },
  "field_rights": {
    "Employee#": {
      "FirstName": 1,
      "LastName": 1,
      "LoginID": 1
    }
  },
  "row_conditions": {
    "Incident#": {
      "type": "or_group",
      "permission": "write",
      "conditions": [
        { "kind": "function", "field": "CreatedBy", "fn": "CurrentLoginId" },
        { "kind": "function", "field": "Owner",     "fn": "CurrentLoginId" },
        { "kind": "function", "field": "ProfileLink_RecID", "fn": "CurrentUserRecId" }
      ]
    },
    "FRS_MyItem#": {
      "type": "preserve_ootb"
    }
  }
}
```

**Rights values in `business_object_rights`** use numeric bitmasks (see the access levels table below).

**`field_rights`** locks a BO down to named fields only. All unlisted fields on that BO get `DefaultFieldRights: null`. Leave this block empty `{}` if no field-level restrictions are needed.

**`row_conditions`** supports four types:

| Type | Description |
|---|---|
| `preserve_ootb` | Keep whatever ISM has stored for this BO unchanged |
| `single` with `kind: "function"` | `$(field == ISMFunction())` - e.g. `CurrentLoginId` |
| `single` with `kind: "literal"` | `$(field == "value")` or `$(field == true)` for booleans |
| `or_group` | Multiple conditions joined by OR |

### Adding a new role config

Create a new `.json` file in `Roles/MinPerms/2026.x/` following the format above. Push it to the repo. The next time anyone pastes the script, the new role appears automatically in the wizard dropdown - no script changes required.

---

## Prerequisites

- Logged into your ISM tenant as a user with admin access to Roles
- Browser developer console open (F12, then the Console tab)
- On the **Object Permissions** page for the role you want to target
- Network access to `api.github.com` and `raw.githubusercontent.com` from the browser

---

## AHPatcher-v5.js - script structure

| Lines | Section | What it does |
|---|---|
|**GitHub config** | Repo owner, repo name, path, branch, raw URL base, `SCRIPT_VERSION`, `GH_VERSION_URL`, `GH_SCRIPT_URL` |
| **Rights labels** | Human-readable label map for bitmask values |
| **Helpers** | `getTimestamp`, `downloadFile`, `rightsLabel`, `findObjectEnd`, `replaceIntField`, `getCasingVariants` |
| **GitHub fetchers** | `detectRoleFromPage`, `fetchRoleList`, `fetchRoleConfig` |
| **Version check** | `fetchLatestVersion`, `compareVersions` |
| **showWizard** | The 4-step wizard modal - version check, role config selection, mode selection, custom overrides |
| **Row condition builders** | `_RC` enum constants, `buildLeaf`, `buildLiteralLeaf`, `buildMixedOrGroup`, `buildLeafFromSpec`, `buildConditionFromSpec`, `buildRowConditions` |
| **buildNewBOR** | Builds the BusinessObjectRights dictionary from the loaded config, applying casing variants and field rights |
| **applyConfig** | Zeros defaults, replaces BOR block, patches row conditions |
| **YAML reports** | `buildPreYaml`, `buildAppliedYaml` |
| **installInterceptor** | Hooks `Sys.Net.WebServiceProxy.invoke`, downloads pre-patcher snapshot and YAML, applies payload |
| **Main flow** | Detects role, fetches GitHub file list, runs wizard, installs interceptor in config or snapshot mode |

---

## The wizard - step by step

When the script is pasted, a modal opens and walks through four steps. The step indicator at the top of the modal shows which step is active and which are complete.

### Step 1 - Version check

The script fetches `version.txt` from the GitHub repo and compares it against the `SCRIPT_VERSION` constant baked into the script.

- **Up to date** - green confirmation, auto-advances to step 2 after a moment
- **Outdated** - orange warning with a link to the repo and a "Continue anyway" button
- **Unreachable** - grey notice, auto-advances after a moment

### Step 2 - Role config

The script queries the GitHub API for all `.json` files in `Roles/MinPerms/2026.x/` and presents them in a dropdown. If the role name was auto-detected from the current page (URL, page title, or DOM elements), the matching file is pre-selected.

If no match is found, or if you need a file not yet in the repo, use the manual filename input below the dropdown. Enter the name without the `.json` extension.

Once a file is selected and loaded, the step auto-advances.

### Step 3 - Mode

Two cards are shown:

**Apply Config** - replaces all current permissions with the loaded GitHub configuration. This is the standard path.

**Restore from Snapshot** - applies a previously saved RolePolicy JSON. Selecting this card reveals an inline file picker. The file is validated immediately after selection (BO count shown). Useful for rolling back changes or copying permissions from another role.

### Step 4 - Custom overrides

Optionally add or override individual business object rights on top of the loaded config. Enter a BO name (must include `#`), choose an access level from the dropdown, and click `+ Add`. Added overrides are shown in a running list with a remove button on each row.

Proceed with an empty list to use the config rights as-is.

Clicking **Arm Interceptor** closes the wizard and installs the hook. Nothing is modified until you tick a checkbox and click Save on the Object Permissions page.

---

## Using the Patcher

### Step 1 - Get to the right page

Log into ISM, go to **Admin > Roles**, click your target role, then click the **Object Permissions** tab.

### Step 2 - Paste the script

Paste the entire contents of `AHPatcher-v5.js` into the console and press Enter. The wizard opens immediately.

### Step 3 - Work through the wizard

Follow the four steps described above. At step 3, choose Config or Snapshot mode. At step 4, add any overrides or leave the list empty.

### Step 4 - Arm and trigger

After clicking **Arm Interceptor**, tick or untick any checkbox on the Object Permissions page and click **Save**. Before anything reaches the server the script:

1. Downloads `<RoleID>_pre-patcher_snapshot_<timestamp>.json` - the role's current state
2. Downloads `<RoleID>_pre-patcher_permissions_<timestamp>.yaml` - a readable summary of the current state
3. Applies the config or snapshot

On success in config mode, it also downloads `<RoleID>_applied_<timestamp>.yaml`.

A successful config mode run looks like this in the console:

```
[AHPatcher] Intercepted SaveRole for: SelfServiceMobile
[AHPatcher] Pre-patcher snapshot saved.
[AHPatcher] Pre-patcher YAML saved.
[AHPatcher] Set DefaultBusinessObjectRights: 7 -> 0
[AHPatcher] BOR: existing=57, granted=162, locked=31
[AHPatcher] Row condition preserved: FRS_MyItem#
[AHPatcher] Row conditions applied: Incident#, ServiceReq#, MyShelfItem#, FRS_Knowledge#, Announcement#, Journal#, Journal#Email, Journal#Notes
[AHPatcher] PATCHER SUCCEEDED. Navigate away and back to Object Permissions to confirm changes.
[AHPatcher] Applied YAML saved.
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

- `<RoleID>_snapshot_<timestamp>.json` - the raw RolePolicy, compatible with AHPatcher-v5.js snapshot mode
- `<RoleID>_permissions_<timestamp>.yaml` - human-readable BO rights summary including any field-level rights blocks

The interceptor re-installs automatically. Navigate to another role and repeat without re-pasting.

### Using it as a pre-flight check

Run the interceptor on the role you are about to patch. Check the YAML to confirm what is currently set. Then switch to AHPatcher-v5.js for the actual changes.

### Using AHPatcher-v5.js as a permissions copy tool

The target role is determined by which Object Permissions page you are on - not by what is in the snapshot file:

1. Run `AHPatcher-Interceptor-v2.js` on Role A to get `RoleA_snapshot_<ts>.json`
2. Navigate to Role B's Object Permissions page
3. Paste `AHPatcher-v5.js`, work through the wizard, at step 3 choose Restore from Snapshot and pick `RoleA_snapshot_<ts>.json`
4. Role B now has Role A's exact permissions

---

## Version management

The script checks `version.txt` in the GitHub repo each time it runs. To manage versions:

1. Keep `version.txt` containing the current release version, e.g. `5.0.0`
2. Update `SCRIPT_VERSION` at line 67 of `AHPatcher-v5.js` when publishing a new release
3. Push the updated `version.txt` and script to the repo

Anyone running an older copy of the script will see an orange warning in step 1 of the wizard with a link to the repo.

---

## Automatic casing variants

ISM's AppServer does not always look up business object names consistently with casing. `getCasingVariants` generates all realistic forms for every BO in the loaded config and for runtime custom objects, so you do not need to list duplicates in the JSON file.

For any BO name, the script produces:

| Form | Example: `Journal#Email` | Example: `incident#` |
|---|---|---|
| Original | `Journal#Email` | `incident#` |
| Lowercase | `journal#email` | `incident#` |
| Title-cased (segments split on `#` and `_`) | `Journal#Email` | `Incident#` |
| camelCase (title-cased, first char lowercased) | `journal#Email` | `incident#` |

Duplicates are removed.

One known limitation: compound PascalCase words without a delimiter (e.g. `ServiceReq`, `FulfillmentItem`) cannot be reconstructed from a fully lowercase input. Use the canonical ISM name in the config file and the lowercase variant is generated automatically.

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

## What applying a config actually changes

**Zeros the global defaults**
`DefaultBusinessObjectRights` and `DefaultBusinessObjectFieldRights` are both set to 0. Any BO not explicitly listed gets no access at all.

**Applies Business Object Rights**
Every BO in the `business_object_rights` section of the config JSON is explicitly granted its specified rights. Everything else already in the role is explicitly locked to `Rights: 0`. Casing variants are written for each entry.

**Applies field-level rights (if configured)**
BOs listed in the `field_rights` section of the config get explicit per-field access control. Unlisted fields on those BOs are locked (`DefaultFieldRights: null`). BOs not in `field_rights` get `DefaultFieldRights: 5` (View + Edit on all fields).

**Applies row-level conditions**
Row conditions are built from the `row_conditions` section of the config. `preserve_ootb` entries keep whatever ISM has stored. All other pre-existing row conditions are removed.

---

## Troubleshooting

**The wizard does not open or shows a blank modal**
Check the console for errors. If you see a network error on the GitHub fetch, confirm that `api.github.com` and `raw.githubusercontent.com` are reachable from your browser on the ISM domain.

**Step 2 shows no configs in the dropdown**
The script could not reach the GitHub API or the directory is empty. Use the manual filename input to enter a role name directly - the script will fetch it from the raw URL.

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

**I need to change what a role gets permanently**
Edit the role's JSON file in the GitHub repo. No script changes are needed. The next paste of the script picks up the new config automatically.

**A custom BO added in the wizard did not take effect**
The script generates casing variants automatically, but compound PascalCase words (e.g. `ServiceReq`) cannot be reconstructed from an all-lowercase input. Use the canonical ISM name when adding custom BOs in the wizard.

**Version check shows outdated but I just updated**
The version check uses `cache: 'no-store'` so it bypasses the browser cache. If it still shows outdated, confirm `version.txt` in the repo was updated and the push completed.

---

## Environment recommendation

| Environment | Recommendation |
|---|---|
| Dev / Sandbox | Fine to run freely |
| Staging / UAT | Run and validate thoroughly before touching Production |
| Production | Only after validating in a lower environment. Keep your snapshot files. |

---

## Disclaimer

**Author:** Andrew Hatton - Andrew.Hatton@ivanti.com | Andrew.Hatton@cronotech.us

THIS CODE AND INFORMATION IS PROVIDED "AS IS" WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESSED OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE IMPLIED WARRANTIES OF MERCHANTABILITY AND/OR FITNESS FOR A PARTICULAR PURPOSE. IMPORTANT: Please take care when executing this script on a live database or system. It is recommended that a full backup is first performed.

The author (Andrew Hatton) accepts no personal liability for any issues, data loss, misconfiguration, or unintended consequences arising from the execution of this script against any environment. This script modifies live role permissions and security policies in Ivanti Neurons for ITSM. It is your responsibility to validate all changes in a lower environment (Staging, UAT, Dev, or equivalent) before executing against any Production tenant. By running this script you accept all risk associated with its use.
