# Help Release History Spec

## Requirement

Every released desktop tag must be visible in the Help modal history, including
frontend-only OTA releases. Future releases should fail in CI if the tag is not
documented before packaging.

## Approved Direction

- Add a frontend-owned release history file shipped with the OTA bundle.
- Make the Help `Changelog` tab load that file first.
- Keep the native `get_changelog` command as a fallback for older bundles or
  unexpected asset-loading failures.
- Add a release workflow check that requires the current tag to appear in the
  shipped history file.

## Non-Goals

- Do not use GitHub API calls at runtime.
- Do not modify the legacy Python desktop application.
- Do not change native updater behavior.
