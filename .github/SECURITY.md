# Security Policy

## Supported versions

Parallax is currently in early development. Security fixes are applied to the
latest code on `main` and the latest `0.1.x` release when one is available.

| Version        | Supported |
| -------------- | --------- |
| `main`         | Yes       |
| `0.1.x`        | Yes       |
| Older versions | No        |

## Report a vulnerability

Do not open a public issue, discussion, or pull request for a suspected
vulnerability.

Email [info@singularity.com](mailto:info@singularity.com) with the subject
`[Parallax Security]` and include, when possible:

- the affected version or commit;
- the affected component and security impact;
- minimal reproduction steps or a proof of concept;
- required configuration or environment details;
- suggested mitigations or fixes; and
- any disclosure timeline constraints.

Remove credentials and personal data from the report. Test only against systems
and data you own or are authorized to assess.

The maintainers will acknowledge valid reports on a best-effort basis, investigate
them, and coordinate remediation and disclosure with the reporter. Please allow a
reasonable remediation period before public disclosure.

## Security scope

The runtime's guarantees, trust boundaries, and known limitations are documented
in [docs/security.md](../docs/security.md). In particular, the host shell executor
controls process lifetime but is not an operating-system sandbox. A report that
only demonstrates an explicitly documented limitation may be closed without a
code change, but documentation improvements are still welcome.
