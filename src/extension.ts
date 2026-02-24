import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

interface ScratchArchiveConfig {
  archiveDirectory: string;
}

function getConfig(): ScratchArchiveConfig {
  const cfg = vscode.workspace.getConfiguration('scratchArchive');
  return {
    archiveDirectory: cfg.get<string>('archiveDirectory', ''),
  };
}

function resolveArchiveDirectory(archiveDirectorySetting: string): string {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const home = os.homedir();

  if (!archiveDirectorySetting || archiveDirectorySetting.trim().length === 0) {
    return path.join(home, '.scratch');
  }

  const candidate = archiveDirectorySetting.trim();

  // Absolute paths are used as-is; relative paths are resolved against the workspace root, then home.
  if (path.isAbsolute(candidate)) {
    return candidate;
  }

  if (workspaceRoot) {
    return path.resolve(workspaceRoot, candidate);
  }

  return path.resolve(home, candidate);
}

function sanitizeForFilename(value: string): string {
  // Replace common separators and unsafe filename characters.
  return value.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

function makeTimestamp(): string {
  // ISO timestamp that is safe for filenames on Windows/macOS/Linux.
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function getExtensionForLanguageId(languageId: string): string {
  // Map common VS Code language IDs to file extensions
  const extensionMap: { [key: string]: string } = {
    'apex': 'cls',
    'bash': 'sh',
    'bat': 'bat',
    'c': 'c',
    'clojure': 'clj',
    'cmd': 'cmd',
    'cobol': 'cob',
    'coffeescript': 'coffee',
    'cpp': 'cpp',
    'csharp': 'cs',
    'css': 'css',
    'csv': 'csv',
    'dart': 'dart',
    'dockerfile': 'Dockerfile',
    'dot': 'dot',
    'elm': 'elm',
    'fish': 'fish',
    'fortran': 'f90',
    'fsharp': 'fs',
    'go': 'go',
    'graphql': 'graphql',
    'groovy': 'groovy',
    'handlebars': 'hbs',
    'haskell': 'hs',
    'html': 'html',
    'ini': 'ini',
    'jade': 'pug',
    'java': 'java',
    'javascript': 'js',
    'javascriptreact': 'jsx',
    'json': 'json',
    'jsonc': 'json',
    'julia': 'jl',
    'kotlin': 'kt',
    'latex': 'tex',
    'less': 'less',
    'log': 'log',
    'lua': 'lua',
    'makefile': 'Makefile',
    'markdown': 'md',
    'matlab': 'm',
    'mustache': 'mustache',
    'nim': 'nim',
    'objective-c': 'm',
    'objective-cpp': 'mm',
    'ocaml': 'ml',
    'perl': 'pl',
    'php': 'php',
    'plaintext': 'txt',
    'plantuml': 'puml',
    'powershell': 'ps1',
    'properties': 'properties',
    'protobuf': 'proto',
    'pug': 'pug',
    'python': 'py',
    'r': 'r',
    'rego': 'rego',
    'restructuredtext': 'rst',
    'ruby': 'rb',
    'rust': 'rs',
    'sas': 'sas',
    'sass': 'sass',
    'scala': 'scala',
    'scheme': 'scm',
    'scss': 'scss',
    'shell': 'sh',
    'solidity': 'sol',
    'sql': 'sql',
    'stata-mata': 'mata',
    'stata-smcl': 'smcl',
    'stata': 'do',
    'stylus': 'styl',
    'svelte': 'svelte',
    'swift': 'swift',
    'terraform': 'tf',
    'toml': 'toml',
    'tsv': 'tsv',
    'typescript': 'ts',
    'typescriptreact': 'tsx',
    'vb': 'vb',
    'verilog': 'v',
    'vhdl': 'vhd',
    'vue': 'vue',
    'wasm': 'wasm',
    'xml': 'xml',
    'yaml': 'yml',
    'zig': 'zig',
    'zsh': 'zsh',
  };
  return extensionMap[languageId] || 'txt';
}

async function ensureDirectory(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
}

async function writeUniqueFile(fullPathBase: string, content: string): Promise<string> {
  // Try base path, then base-1, base-2, ... to avoid overwrites.
  const dir = path.dirname(fullPathBase);
  const ext = path.extname(fullPathBase);
  const name = path.basename(fullPathBase, ext);

  for (let i = 0; i < 10_000; i += 1) {
    const candidate = i === 0 ? fullPathBase : path.join(dir, `${name}-${i}${ext}`);
    try {
      await fs.writeFile(candidate, content, { encoding: 'utf8', flag: 'wx' });
      return candidate;
    } catch (err: any) {
      if (err?.code === 'EEXIST') {
        continue;
      }
      throw err;
    }
  }

  throw new Error('Unable to allocate a unique filename after many attempts.');
}



function getUriFromTab(tab: vscode.Tab): vscode.Uri | undefined {
  const input: any = tab.input as any;
  return input?.uri as vscode.Uri | undefined;
}

async function getUntitledTabs(): Promise<vscode.Tab[]> {
  // Use the tabs API so we can close only Untitled editors without touching named files.
  const allTabs = vscode.window.tabGroups.all.flatMap(g => g.tabs);

  const untitledTabs = allTabs.filter(tab => {
    const uri = getUriFromTab(tab);
    return uri?.scheme === 'untitled';
  });

  return untitledTabs;
}

async function archiveUntitledTabs(archiveDir: string, cfg: ScratchArchiveConfig): Promise<{ archived: number; paths: string[] }> {
  const tabs = await getUntitledTabs();
  const archivedPaths: string[] = [];

  let counter = 0;

  for (const tab of tabs) {
    const uri = getUriFromTab(tab);
    if (!uri) {
      continue;
    }

    const doc = await vscode.workspace.openTextDocument(uri);
    const text = doc.getText();

    if (text.trim().length === 0) {
      continue;
    }

    counter += 1;
    const ts = makeTimestamp();
    const languagePart = `_${sanitizeForFilename(doc.languageId)}`;
    const ext = getExtensionForLanguageId(doc.languageId);

    const filename = `scratch_${ts}_${String(counter).padStart(3, '0')}${languagePart}.${ext}`;
    const fullPathBase = path.join(archiveDir, filename);

    const written = await writeUniqueFile(fullPathBase, text);
    archivedPaths.push(written);
  }

  return { archived: archivedPaths.length, paths: archivedPaths };
}

async function closeTabs(cfg: ScratchArchiveConfig): Promise<void> {
  const untitledTabs = await getUntitledTabs();
  for (const tab of untitledTabs) {
    const uri = getUriFromTab(tab);
    if (uri) {
      // Reveal the document in the editor and close without save prompt
      await vscode.window.showTextDocument(uri, { preserveFocus: false, preview: false });
      await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
    }
  }
}

async function openArchiveFolder(archiveDir: string): Promise<void> {
  await ensureDirectory(archiveDir);
  await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(archiveDir));
}

export function activate(context: vscode.ExtensionContext): void {
  const archiveAndClose = vscode.commands.registerCommand('scratchArchive.archiveAndCloseUntitled', async () => {
    const cfg = getConfig();
    const archiveDir = resolveArchiveDirectory(cfg.archiveDirectory);

    try {
      await ensureDirectory(archiveDir);

      const result = await archiveUntitledTabs(archiveDir, cfg);
      await closeTabs(cfg);

      const msg = result.archived === 0
        ? 'Scratch Archive: No Untitled editors to archive.'
        : `Scratch Archive: Archived ${result.archived} Untitled editor(s) to ${archiveDir}`;

      const choice = await vscode.window.showInformationMessage(msg, 'Open Archive Folder');
      if (choice === 'Open Archive Folder') {
        await openArchiveFolder(archiveDir);
      }
    } catch (err: any) {
      const detail = err?.message ? String(err.message) : String(err);
      vscode.window.showErrorMessage(`Scratch Archive failed: ${detail}`);
    }
  });

  const openFolderCmd = vscode.commands.registerCommand('scratchArchive.openArchiveFolder', async () => {
    const cfg = getConfig();
    const archiveDir = resolveArchiveDirectory(cfg.archiveDirectory);
    await openArchiveFolder(archiveDir);
  });

  context.subscriptions.push(archiveAndClose, openFolderCmd);
}

export function deactivate(): void {
  // No resources to dispose beyond subscriptions.
}
