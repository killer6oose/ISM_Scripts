# ISM Role Permission Patcher

**Author:** Andrew Hatton - [That's me!](https://andrewhatton.com)
##### **Issues/Contact:** Use the Issues, or andrew.hatton@ivanti.com
---

> **Before you do anything else, please read this.**
>
> This script makes direct, live changes to role permissions in Ivanti Neurons for ITSM by intercepting the browser's save mechanism. It is not reversible through an "undo" button. Always run in a Staging or UAT environment first. Always keep the pre-patcher snapshot that's downloaded automatically before applying changes to Production.

---

## Table of Contents

- [What is this?](#what-is-this)
- [Files](#files)
- [GitHub config repository](#github-config-repository)
  - [Role config file format](#role-config-file-format)
  - [Adding a new role config](#adding-a-new-role-config)
- [Prerequisites](#prerequisites)
- [The wizard - step by step](#the-wizard---step-by-step)
- [Using the Patcher](#using-the-patcher)
- [Version management](#version-management)
- [Automatic casing variants](#automatic-casing-variants)
- [Custom BO access levels](#custom-bo-access-levels)
- [What applying a config actually changes](#what-applying-a-config-actually-changes)
- [Troubleshooting](#troubleshooting)
- [Environment recommendation](#environment-recommendation)
- [Disclaimer](#disclaimer)

---

## What is this?

A single browser console script for managing ISM role permissions without API keys, installed tools, or server-side changes. Paste it into the browser developer console while logged into ISM as an admin, on the target role's Object Permissions page.

`AHPatcher-latest.js` fetches per-role configuration files from a public GitHub repository at runtime rather than using hardcoded permission sets. A 6-step wizard modal guides you through version checking, role config selection, mode choice, an Attachment object notice, optional business object overrides, and System Permissions before arming the interceptor. It applies a loaded config, or restores from a previously saved snapshot. Every step has an Abort button.

---

## Files

| File | What it does |
|---|---|
| `AHPatcher-latest.js` | GitHub-driven role patcher with a multi-step wizard UI |

---

## GitHub config repository

Role permission sets live in a separate public repository rather than in the script itself. This means updating permissions for any role does not require editing or redistributing the script.

Each role has its own JSON file in the `2026.x` (or whatever version you are looking for) directory:

```
Roles/MinPerms/2026.x/
  SelfServiceMobile.json
  GRCManager.json
  GRCAnalyst.json
  etc.json......
  version.txt          <-- plain text, contains current version e.g. 5.3.3
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

## The wizard - step by step

When the script is pasted, a modal opens and walks through six steps. The step indicator at the top of the modal shows which step is active and which are complete. Every step has an **Abort** button.

### Step 1 - Version check

The script fetches `version.txt` from the GitHub repo and compares it against the `SCRIPT_VERSION` constant baked into the script.

- **Up to date** - green confirmation, auto-advances after a moment
- **Outdated** - orange warning with a link to request the latest version, plus a "Continue with current version" button
- **Unreachable** - grey notice, auto-advances after a moment

### Step 2 - Role config

The script queries the GitHub API for all `.json` files in `Roles/MinPerms/2026.x/` and presents them in a dropdown. If the role name was auto-detected from the current page (URL, page title, or DOM elements), the matching file is pre-selected.

If no match is found, or if you need a file not yet in the repo, use the manual filename input below the dropdown. Enter the name without the `.json` extension.

### Step 3 - Mode

Two cards are shown:

**Apply Config** - replaces all current permissions with the loaded GitHub configuration. This is the standard path.

**Restore from Snapshot** - applies a previously saved RolePolicy JSON. Selecting this card reveals an inline file picker. The file is validated immediately after selection (BO count shown). Useful for rolling back changes or copying permissions from another role.

### Step 4 - Attachment notice

A reminder that the Attachment business object gets a row condition that limits access to attachments the current user created themselves. If your users need to download attachments added by other users (e.g. service desk staff), you'll need to relax that row condition manually afterward in Admin UI > Users and Permissions > Roles and Permissions > [role] > Attachment > Edit Access Permissions.

### Step 5 - Custom overrides

Optionally add or override individual business object rights on top of the loaded config. Enter a BO name (must include `#`), choose an access level from the dropdown, and click `+ Add`. Added overrides are shown in a running list with a remove button on each row.

Proceed with an empty list to use the config rights as-is.

### Step 6 - System Permissions

Configure the Action / Search / Dashboard "Create (for self) / Edit (for all) / Delete (for all)" checkboxes and the "Allow publishing" role lists for each type. Search - Create (for self) is checked by default to match the standard baseline.

Publish role pickers for a type only become editable once Edit (for all) or Delete (for all) is checked for that type (Reports has no gating checkbox and is always editable). Pick a role from the dropdown, type a custom role name, or choose "All Roles." Add as many roles per target as needed - each shows as a removable chip.

Two additional checkboxes here control "Allow Microsoft Excel download from saved searches" and "Allow email to yourself from saved searches."

Clicking **Arm Interceptor** closes the wizard and installs the hook. Nothing is modified until you tick a checkbox and click Save on the Object Permissions page.

---

## Using the Patcher

### Step 1 - Get to the right page

Log into ISM, go to **Admin > Roles**, click your target role, then click the **Object Permissions** tab.

### Step 2 - Paste the script

Paste the entire contents of `AHPatcher-latest.js` into the console and press Enter. The wizard opens immediately.

### Step 3 - Work through the wizard

Follow the six steps described above. At step 3, choose Config or Snapshot mode. At step 5, add any overrides or leave the list empty. At step 6, set System Permissions.

### Step 4 - Arm and trigger

After clicking **Arm Interceptor**, tick or untick any checkbox on the Object Permissions page and click **Save**. Before anything reaches the server the script:

1. Downloads `<RoleID>_pre-patcher_snapshot_<timestamp>.json` - the role's current state
2. Downloads `<RoleID>_pre-patcher_permissions_<timestamp>.yaml` - a readable summary of the current state
3. Applies the config or snapshot, plus the System Permissions and publish role settings from step 6

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
[AHPatcher] System Permissions updated: Search (Global 1→7, User 14→14)
[AHPatcher] Publish rights updated: Actions: 0 role(s); Searches: 0 role(s); Dashboards: 0 role(s); Reports: 2 role(s)
[AHPatcher] DownloadRights -> false , EmailSearchRights -> false
[AHPatcher] PATCHER SUCCEEDED. Navigate away and back to Object Permissions to confirm changes.
[AHPatcher] Applied YAML saved.
```

---

## Version management

The script checks `version.txt` in the GitHub repo each time it runs. To manage versions:

1. Keep `version.txt` containing the current release version, e.g. `5.3.3`
2. Update `SCRIPT_VERSION` near the top of `AHPatcher-latest.js` when publishing a new release
3. Push the updated `version.txt` and script to the repo

Anyone running an older copy of the script will see an orange warning in step 1 of the wizard with a link to request the latest version.

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

**Applies System Permissions (step 6)**
The Action / Search / Dashboard checkboxes fully replace the corresponding `ModuleRights` bits (unchecked boxes clear their bits, not just leave them alone). Publish role lists fully replace the role list for each target - a role left off the list loses its publish grant. `DownloadRights` and `EmailSearchRights` are patched inside the RolePolicy string, which is the copy ISM actually reads.

---

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| I cannot see the Service Catalog or My Items after applying | If the role is using Portal UI V3, error messages relevant to this may not surface. Switch the role to Portal UI V2 and log back in - you'll most likely see an explicit error naming the object you need "View" rights to. |
| Wizard doesn't open, or shows a blank modal | Check the console for errors. A network error on the GitHub fetch usually means `api.github.com` or `raw.githubusercontent.com` isn't reachable from the ISM domain. |
| Step 2 shows no configs in the dropdown | The script couldn't reach the GitHub API, or the directory is empty. Use the manual filename input to fetch a role directly by name. |
| Nothing happens after clicking Save | ISM won't fire `SaveRole` if it thinks nothing changed. Tick or untick at least one checkbox first. |
| Save fails with a server error | Check the console message. Errors about array serialization or `"StartArray token is expected"` usually mean an outdated script - the current version patches `Array.prototype.toJSON` before serializing row conditions. |
| Permissions look wrong after saving | Check the downloaded YAML report - it lists every BO granted or locked and every row condition applied or removed. |
| No snapshot or YAML file downloaded | The browser likely blocked automatic downloads. Check download settings for the ISM domain. |
| Need to target a different role | Navigate to that role's Object Permissions page first, then paste the script - the target role is whichever page you're on. |
| Need a permanent change to what a role gets | Edit that role's JSON file in the GitHub repo. No script changes needed - the next paste picks it up automatically. |
| A custom BO added in step 5 didn't take effect | Compound PascalCase words (e.g. `ServiceReq`) can't be reconstructed from all-lowercase input. Use the canonical ISM name. |
| Version check shows outdated right after updating | The check uses `cache: 'no-store'`, so it isn't a caching issue - confirm `version.txt` in the repo was actually updated and pushed. |
| "Allow Microsoft Excel download" / "Allow email to yourself" checkboxes don't stick | Fixed as of v5.3.1 - these booleans exist in two places in the SaveRole payload; only the copy nested inside RolePolicy is read by ISM, and that's the one now patched. |
| Create (for self) doesn't apply for Action or Dashboard | Fixed as of v5.3.3 - if a role never had that security type in `ModuleRights` at all, the checkbox was previously a silent no-op. It's now created from a zeroed baseline instead of being skipped. |

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
