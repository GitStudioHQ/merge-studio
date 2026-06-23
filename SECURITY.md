# Security Policy

## Supported versions

Merge Studio is distributed through the Visual Studio Marketplace and Open VSX.
Security fixes are released against the latest published version, so please make
sure you are on the most recent release before reporting an issue.

| Version | Supported          |
| ------- | ------------------ |
| 0.3.x   | :white_check_mark: |
| < 0.3   | :x:                |

## Reporting a vulnerability

**Please do not report security vulnerabilities through public GitHub issues,
discussions, or pull requests.**

Instead, use GitHub's private vulnerability reporting:

1. Open the [Security tab](https://github.com/GitStudioHQ/merge-studio/security)
   of this repository.
2. Click **Report a vulnerability**.
3. Fill in the advisory form.

This opens a private channel visible only to you and the maintainers.

When reporting, please include as much of the following as you can:

- A description of the vulnerability and its impact.
- The Merge Studio version, the VS Code version, and your operating system.
- Step-by-step instructions to reproduce, ideally with a minimal repository or
  the branch / file names that trigger the issue.
- Any proof-of-concept code, screenshots, or logs.

## What to expect

- We aim to acknowledge new reports within **5 business days**.
- After triage we will keep you updated on progress toward a fix and agree a
  disclosure timeline with you.
- Valid reports are credited in the release notes unless you would rather stay
  anonymous.

## Scope and threat model

Merge Studio is a client-side VS Code extension. It runs git operations locally
and renders merge / diff state inside a VS Code webview. Reports we are
especially interested in include, but are not limited to:

- Code execution or injection (for example XSS) in the extension's webviews via
  attacker-influenceable repository content — branch names, file paths, file
  contents, or commit metadata.
- Escaping the webview sandbox or the extension host's expected privileges.
- Mishandling of local files or git state that could lead to data loss or
  unintended command execution.

Issues that require a malicious VS Code extension to already be running, physical
access to an unlocked machine, or social engineering of the user are generally
considered out of scope.

## Dependencies

Merge Studio bundles third-party code (notably the Monaco editor). Dependency
vulnerabilities are tracked with GitHub Dependabot and patched in regular
releases. If you find a vulnerable dependency that is reachable through Merge
Studio, please report it using the process above.
