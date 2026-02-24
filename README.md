# Scratch Archive

Archive all unsaved VS Code editors to a local folder. Close them. Keep it clean and `grep` later if you need to.

Archived file pattern: `scratch_{timestamp}_{counter:3}_{languageId}.{ext}`.

## Commands

- `Scratch Archive: Archive and Close Untitled Editors`: **Ctrl+K X**
- `Scratch Archive: Open Archive Folder`: *unbound*

## Configuration

- `scratchArchive.archiveDirectory`: Where to save archived files
  - Default: `~/.scratch`
  - Relative paths are resolved against the first workspace folder.
  - Falls back to `~/.scratch`.

## Run in an Extension Development Host

```bash
npm install
npm run compile
```

Press `F5`.

## Package as VSIX

```bash
npm i -g @vscode/vsce
vsce package
```

## Install

```bash
code --install-extension scratch-archive-0.1.0.vsix
```