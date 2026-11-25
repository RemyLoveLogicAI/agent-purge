# Legal Disclaimer and Compliance

## License and scope

agent-purge configures persona and prompt entry points in coding agents that the user is authorized to manage. The project uses the [MIT License](../LICENSE). This statement explains its purpose, risks, and user responsibilities; it does not replace the LICENSE or impose additional restrictions on the scope of MIT authorization. When copying, modifying, or distributing the software, retain the copyright and license notices required by the LICENSE.

## Lawful, authorized use

This project is a local multi-host configuration management and development debugging tool, intended to help developers manage legitimate working personas consistently. The software itself neither provides nor distributes prompt payloads for jailbreaking, adversarial safety circumvention, or infringing third-party rights.

Users must comply with applicable laws and regulations, the terms of host software and model services, and relevant third-party permissions. Use for unauthorized system access, security attacks, data theft, privacy violations, or other unlawful or improper activities is strictly prohibited. Installing or using this tool does not grant authorization to operate third-party systems, use others' data, or invoke model services. Users are responsible for their prompt content and the consequences of their actions.

## Configuration and model behavior risks

Prompt rewriting can change model output, tool-calling tendencies, and existing workflows. Strict replacement can also remove existing instructions from controllable entry points. This project does not guarantee that model output is accurate, safe, lawful, or suitable for any particular purpose, and does not replace host permission controls, sandboxes, human review, or safety policies.

Before using it on important projects, back up configurations and test in an isolated environment. Review model output before sensitive operations. If restoration encounters a conflict, keep the original file and recovery credentials; do not simply delete the backup.

## Data and network

Personas and configuration are stored locally by default, but when enabled they are sent with host requests to the configured model service. Update checks, software installation, and host operation may access external networks. Do not put keys, personal information, or confidential data in personas if they should not be sent to the service provider. This tool does not provide complete network isolation or data loss prevention.

## Warranty and liability

The software is provided "as is" under the LICENSE, without the express or implied warranties listed there. Users should assess their own use cases, safeguard credentials, and review the results. To the extent permitted by applicable law, the exclusions of warranties and limitations of liability for authors and contributors are governed by the LICENSE. This statement does not exclude liability that cannot legally be excluded.

## Third-party independence

This independently developed tool has no implied affiliation, authorization, partnership, or endorsement relationship with the supported coding agents, model providers, or their affiliates. Product names and marks belong to their respective owners. Compatibility descriptions do not imply third-party approval or warranty of this project.

## Third-party components

The Windows thin package and installer include `WebView2Loader.dll` from the Microsoft.Web.WebView2 SDK and use it to call the local Microsoft Edge WebView2 Runtime to display the console window. The single-file `agent-purge.exe` includes the Bun runtime. These components and their names and marks belong to their respective owners and are distributed and used under their respective license terms. Without WebView2, the program falls back to the local Chrome or Edge application-window mode; the components above are not involved in that case.
