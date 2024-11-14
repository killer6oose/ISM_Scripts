
# Ivanti Neurons for ITSM Demo/Test Data PowerShell Scripts

This repository contains a collection of PowerShell scripts designed to streamline the generation, modification, and deletion of demo or test data within Ivanti Neurons for ITSM. These scripts are intended to facilitate testing, training, and setup tasks, providing a convenient way to handle various data scenarios in Ivanti.

## Table of Contents

- [Overview](#overview)
- [Usage](#usage)
- [Folders](#folders)
  - [Create Objects](#create-objects)
  - [Delete Records](#delete-records)
- [Contributing](#contributing)
- [License](#license)

## Overview

The scripts in this repository enable users to automate data handling in Ivanti Neurons for ITSM, whether setting up initial datasets or cleaning up after testing sessions. This can significantly improve testing efficiency and ensure consistency across different environments.

## Usage

Each script in this repository is designed to be run as-is or customized according to specific requirements. Make sure to review any input variables in each script to align them with your environment or test requirements.

### Running a Script

1. Open PowerShell.
2. Navigate to the script's directory.
3. Run the script by entering:
   ```powershell
   .\ScriptName.ps1
   ```

4. Follow any prompts or messages that the script displays.

## Folders

### [Create Objects](./Create%20Objects)

This folder contains scripts designed to generate new records and datasets in Ivanti Neurons for ITSM. These scripts can be customized to add demo data in various modules, including:

- Incident Management
- Change Requests (TBD)
- User/Employee Records
- Additional ITSM data entities as needed (TBD)
- And helpful scripts to generate data based on information from another outside source such as the [CronoTech API](https://api.cronotehc.us)
### [Delete Records](./Delete%20Records)

This folder provides scripts for removing demo or test data from Ivanti Neurons for ITSM. These are particularly useful for cleaning up test environments or preparing for new test cases. Scripts in this folder include options for deleting data by type, date range, or specific criteria.

## Contributing

Contributions to this repository are welcome! If you have any scripts or modifications that could benefit other users, feel free to create a pull request.

## License

This project is licensed under the GNUv3 and Beyond License - see the [LICENSE](./LICENSE) file for details.
