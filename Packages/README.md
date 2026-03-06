# Packages

> **Disclaimer:** THESE PACKAGES AND ASSOCIATED METADATA ARE PROVIDED "AS IS" WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESSED OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE IMPLIED WARRANTIES OF MERCHANTABILITY AND/OR FITNESS FOR A PARTICULAR PURPOSE. IMPORTANT: Please take care when importing any package into a live Ivanti Service Manager environment, use a test environment when possible. It is strongly recommended that a full backup is performed before importing any metadata patch.

This directory contains importable `.metadatapatch` packages for Ivanti Service Manager (ISM). Each package is designed to be imported via the ISM Metadata Patch Import tool and provides supporting business objects, fields, or configuration required by scripts in this repository.

---

## Available Packages

### `Custom Logging Object for EntraAD Syncing.MetadataPatch`
#### *Created in `ITSMv2026.1`

Creates the **Custom Logging Obj for EntraAD** business object in ISM, which is used as an optional debug target by the [Entra Sync script](./Entra_Sync.js) and any other scripts in this repository that support custom debug logging.

When custom debug logging is enabled in a script (by setting `Enable_Custom_Debug = true`), the script will create a new record in this object at the end of execution and write all accumulated debug output -- including warnings and errors -- into a single field on that record. This gives you a persistent, queryable log inside ISM without needing to rely solely on the server console output.

#### To use:
1. Import `Custom Logging Object for EntraAD Syncing.MetadataPatch` via ISM's Metadata Patch Import tool
2. In the imported script, set the following variables, if not already set:
   **this package WILL set these values AND will create the script. If you've already created the Entra_Sync.js in your tenant, you may just want to delete the duplicate script.
   ```js
   var Enable_Custom_Debug = true;
   var Custom_Debug_Obj    = 'ead_CustomLogging#';
   var Custom_Debug_Fld    = 'LogOutput';
   ```

---

*More packages will be added here as the repository grows.*
