# MSS Visualization for Home Assistant

MSS Visualization is a custom visualization layer built on top of Home Assistant Core.

It provides:

- Dynamic MSS MQTT sensor discovery
- Control Plan aware data grouping
- Dynamic measurement visualization
- MQTT image support
- Custom MSS views and overlays
- Automatic view routing
- Configurable shapes and data bindings
- Persistent local images and backgrounds
- Fullscreen visualization and editor interfaces

---

# Repository Overview

This repository is a fork of the official Home Assistant Core repository.

Two Git remotes are normally used:

```text
origin   → MSS project fork
upstream → official Home Assistant Core
```

The main MSS development branch is:

```text
feature/mss-visualization
```

The `dev` branch is kept aligned with the official Home Assistant `dev` branch.

Typical structure:

```text
home-assistant/core upstream/dev
            │
            ▼
           dev
            │
            ▼
feature/mss-visualization
```

MSS development should be performed on `feature/mss-visualization`, not directly on `dev`.

---

# Development Environment

## Recommended Setup

Recommended development environment:

- Windows 11
- Docker Desktop
- VS Code
- Dev Containers extension
- Git

VS Code is recommended because the repository already contains a Home Assistant Dev Container configuration.

The source code itself is not tied to VS Code, but the Dev Container provides the easiest reproducible Home Assistant development and test environment.

---

# Setup

A collaborator can clone the repository with:

```bash
git clone https://github.com/davidspereira00-cmyk/home_core.git
cd home_core
git fetch origin
git switch feature/mss-visualization
```

If the repository is private, the collaborator must first be added through GitHub repository access settings.

For the easiest reproducible development and testing workflow, use:

- VS Code
- Docker Desktop
- Dev Containers

The source can be edited in other IDEs, but the current Home Assistant development workflow is built around the VS Code Dev Container.

---

# Current Branch Purpose

```text
dev
```

Purpose:

```text
Clean Home Assistant Core base synchronized with upstream/dev
```

```text
feature/mss-visualization
```

Purpose:

```text
Latest Home Assistant Core
+
MSS Visualization development
```


```bash
git switch -c feature/mss-visualization \
  --track origin/feature/mss-visualization
```

---

# Open the Dev Container

Open the cloned repository in VS Code.

Install the extension:

```text
Dev Containers
```

Then use:

```text
Ctrl + Shift + P
```

and select:

```text
Dev Containers: Reopen in Container
```

The repository should be available inside the container at:

```text
/workspaces/home_core
```

---

# Important: MSS Source Copy vs Home Assistant Runtime Copy

The project currently keeps **two copies of the MSS files for different purposes**.

This distinction is intentional and important.

## 1. Git-tracked MSS source

The version that is tracked by Git lives here:

```text
mss-visualization/
```

Structure:

```text
mss-visualization/
├── custom_components/
│   └── mss/
│       ├── __init__.py
│       ├── config_flow.py
│       ├── manifest.json
│       ├── sensor.py
│       └── websocket.py
│
└── www/
    ├── mss/
    │   └── icons/
    ├── mss-default-views.js
    ├── mss-field-resolver.js
    ├── mss-icons.js
    ├── mss-measurements-card.js
    ├── mss-overlay-renderer.js
    ├── mss-panel-styles.js
    ├── mss-routing-status.js
    ├── mss-value-decoder.js
    ├── mss-view-card.js
    ├── mss-view-dialog.js
    ├── mss-view-editor-dialog.js
    ├── mss-view-renderer.js
    └── mss-view-router.js
```

This is the copy that should be:

- committed
- reviewed
- pushed
- shared with other developers
- used as the source-controlled MSS codebase

## 2. Home Assistant runtime copy

Home Assistant itself loads the MSS integration and frontend files from:

```text
config/custom_components/mss/
config/www/
```

These are the runtime locations used by the Home Assistant development instance.

The `config/` directory is ignored by Git because it contains local Home Assistant configuration, runtime data and machine-specific files.

Therefore:

```text
mss-visualization/
```

is the **Git/source copy**, while:

```text
config/
```

contains the **runtime copy used by Home Assistant**.

Current relationship:

```text
Git tracked source                      Home Assistant runtime
─────────────────────────────           ─────────────────────────────
mss-visualization/www/           →      config/www/

mss-visualization/
custom_components/mss/           →      config/custom_components/mss/
```

At the moment these are separate physical copies.

Changes made only in `mss-visualization/` are not automatically reflected in `config/`, and changes made only in `config/` are not automatically committed to Git.

When changing MSS code, make sure the relevant source and runtime copies remain synchronized.

A future development improvement may replace the duplicated source files with selective symlinks or an automated sync process, while keeping runtime-generated image directories separate.

---

# Why `config/` Is Not Tracked

The Home Assistant development configuration contains local and runtime-specific content.

The repository therefore ignores:

```text
/config
```

This means files such as:

```text
config/www/
config/custom_components/mss/
```

do not appear in Git status and are not pushed to GitHub.

The `mss-visualization/` folder was created specifically to provide a trackable source location for MSS.

Do not remove the global `/config` ignore rule simply to track MSS files.

---

# Runtime Images and Backgrounds

MSS supports uploaded view backgrounds and local overlay images.

These are runtime-generated files and should remain outside normal source control.

Home Assistant writes them to:

```text
config/www/mss-view-backgrounds/
config/www/mss-view-images/
```

They are used by MSS at runtime.

The corresponding paths under the tracked source tree are ignored:

```text
/mss-visualization/www/mss-view-backgrounds/
/mss-visualization/www/mss-view-images/
```

This is intentional.

Do not commit user-uploaded or generated runtime images unless a specific image is deliberately being added as a project asset.

For example, a fixed project asset such as:

```text
mss-visualization/www/views/body.jpg
```

may be tracked.

---

# Home Assistant Custom Component

The MSS backend integration lives in:

```text
mss-visualization/custom_components/mss/
```

The Home Assistant runtime equivalent is:

```text
config/custom_components/mss/
```

Main files:

```text
__init__.py
config_flow.py
manifest.json
sensor.py
websocket.py
```

Responsibilities include:

- MQTT processing
- dynamic MSS entities
- Control Plan grouping
- image field handling
- persistent structural schema
- MSS WebSocket commands
- view persistence
- local image/background upload handling

---

# MSS Frontend

The source-controlled MSS frontend lives in:

```text
mss-visualization/www/
```

The Home Assistant runtime equivalent is:

```text
config/www/
```

Important frontend files include:

```text
mss-view-editor-dialog.js
mss-view-dialog.js
mss-view-card.js
mss-view-router.js
mss-view-renderer.js
mss-overlay-renderer.js
mss-field-resolver.js
mss-value-decoder.js
mss-measurements-card.js
mss-panel-styles.js
mss-icons.js
mss-default-views.js
mss-routing-status.js
```

The Dazzle Line Icons used by MSS are stored under:

```text
mss-visualization/www/mss/icons/
```

and have a corresponding runtime location under:

```text
config/www/mss/icons/
```

---

# Updating Home Assistant Core

The official Home Assistant repository is configured as:

```text
upstream
```

To update the local `dev` branch:

```bash
git switch dev
git fetch upstream
git pull --ff-only upstream dev
```

Verify that local `dev` matches the official Home Assistant branch:

```bash
git rev-parse dev
git rev-parse upstream/dev
```

The hashes should be identical.

Update the fork:

```bash
git push origin dev
```

---

# Updating the MSS Branch After Home Assistant Changes

After updating `dev`:

```bash
git switch feature/mss-visualization
```

Rebase the MSS work onto the latest Home Assistant version:

```bash
git rebase dev
```

If conflicts occur:

1. Resolve the conflicted files.
2. Stage each resolved file:

```bash
git add <file>
```

3. Continue the rebase:

```bash
git rebase --continue
```

After a successful rebase, update the remote feature branch:

```bash
git push --force-with-lease origin feature/mss-visualization
```

Use `--force-with-lease`, not plain `--force`.

---

# Git Remotes and Safety

Typical remote configuration:

```text
origin   → https://github.com/davidspereira00-cmyk/home_core.git
upstream → https://github.com/home-assistant/core.git
```

`origin` is the MSS fork.

`upstream` is used only to retrieve official Home Assistant changes.

MSS work should never be pushed to the official Home Assistant repository.

To make accidental upstream pushes harder, the upstream push URL can be disabled:

```bash
git remote set-url --push upstream DISABLED
```

Check remotes:

```bash
git remote -v
```

---


Home Assistant Core blocks direct commits to the `dev` branch through its pre-commit hooks.

Always make MSS changes on a feature branch.

---

# Code Quality

Home Assistant Core uses pre-commit validation.

Before committing Python changes:

```bash
ruff check mss-visualization/custom_components/mss/
```

Apply safe Ruff fixes when appropriate:

```bash
ruff check mss-visualization/custom_components/mss/ --fix
```

After Ruff modifies files, stage them again:

```bash
git add mss-visualization/custom_components/mss/
```

The normal commit command will also run Home Assistant's configured pre-commit checks.

---

# Ruff Version

After pulling new Home Assistant changes, the required Ruff version may change.

Check:

```bash
ruff --version
```

If the version in the active Home Assistant virtual environment is too old:

```bash
uv pip install --upgrade ruff
```

Then check again:

```bash
ruff --version
```

When multiple Ruff installations exist, inspect them with:

```bash
which -a ruff
```

The Ruff executable inside the active `ha-venv` normally takes precedence.

---

# Files That Should Not Be Committed

Do not commit:

```text
config/
mss-visualization-test/
mss-visualization-test.zip
mss-visualization/www/mss-view-images/
mss-visualization/www/mss-view-backgrounds/
```

The first is Home Assistant runtime configuration.

The test folder and ZIP are local test artifacts.

The image/background folders contain runtime-generated files.

---


# Next Documentation Areas

Useful documentation still to add:

1. Initial Home Assistant configuration
2. MSS integration installation/synchronization into `config/`
3. Required frontend resource registration
4. MQTT broker setup
5. MSSReport topic structure
6. Example MQTT payloads
7. Running and debugging Home Assistant
8. MSS architecture and file responsibilities
9. View Editor usage
10. Automatic routing behavior
11. Image handling
12. Troubleshooting







//// Home Assistant



Home Assistant |Chat Status|
=================================================================================

Open source home automation that puts local control and privacy first. Powered by a worldwide community of tinkerers and DIY enthusiasts. Perfect to run on a Raspberry Pi or a local server.

Check out `home-assistant.io <https://home-assistant.io>`__ for `a
demo <https://demo.home-assistant.io>`__, `installation instructions <https://home-assistant.io/getting-started/>`__,
`tutorials <https://home-assistant.io/getting-started/automation/>`__ and `documentation <https://home-assistant.io/docs/>`__.

|screenshot-states|

Featured integrations
---------------------

|screenshot-integrations|

The system is built using a modular approach so support for other devices or actions can be implemented easily. See also the `section on architecture <https://developers.home-assistant.io/docs/architecture_index/>`__ and the `section on creating your own
components <https://developers.home-assistant.io/docs/creating_component_index/>`__.

If you run into issues while using Home Assistant or during development
of a component, check the `Home Assistant help section <https://home-assistant.io/help/>`__ of our website for further help and information.

|ohf-logo|

.. |Chat Status| image:: https://img.shields.io/discord/330944238910963714.svg
   :target: https://www.home-assistant.io/join-chat/
.. |screenshot-states| image:: https://raw.githubusercontent.com/home-assistant/core/dev/.github/assets/screenshot-states.png
   :target: https://demo.home-assistant.io
.. |screenshot-integrations| image:: https://raw.githubusercontent.com/home-assistant/core/dev/.github/assets/screenshot-integrations.png
   :target: https://home-assistant.io/integrations/
.. |ohf-logo| image:: https://www.openhomefoundation.org/badges/home-assistant.png
   :alt: Home Assistant - A project from the Open Home Foundation
   :target: https://www.openhomefoundation.org/
