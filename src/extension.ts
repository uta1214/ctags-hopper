// src/extension.ts
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export function activate(context: vscode.ExtensionContext) {
  const jumpHistory: { uri: vscode.Uri, position: vscode.Position, viewColumn: vscode.ViewColumn | undefined }[] = [];

  let jumpRightDisposable = vscode.commands.registerCommand('ctags.jumpRight', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    jumpHistory.push({
      uri: editor.document.uri,
      position: editor.selection.active,
      viewColumn: editor.viewColumn
    });

    const selection = editor.selection;
    const word = editor.document.getText(selection.isEmpty
      ? editor.document.getWordRangeAtPosition(selection.active)
      : selection);

    if (!word) {
      vscode.window.showInformationMessage("No word selected.");
      return;
    }

    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
      vscode.window.showErrorMessage("No workspace folder open.");
      return;
    }

    const tagsPath = path.join(workspaceRoot, ".tags");
    if (!fs.existsSync(tagsPath)) {
      vscode.window.showErrorMessage(".tags file not found in workspace root.");
      return;
    }

    const lines = fs.readFileSync(tagsPath, 'utf8').split('\n');
    const matches = lines.filter(line => line.startsWith(word + '\t'));

    if (matches.length === 0) {
      vscode.window.showInformationMessage(`Tag not found: ${word}`);
      return;
    }

    let chosen: string;

    if (matches.length === 1) {
      chosen = matches[0];
    } else {
      const items = matches.map(line => {
        const [symbol, file, pattern] = line.split('\t');
        const filePath = path.join(workspaceRoot, file);
        let displayLine = pattern;

        let displayText = '';
        const lineMatch = line.match(/line:(\d+)/);
        if (lineMatch) {
          const targetLine = parseInt(lineMatch[1], 10) - 1;
          try {
            const fileContent = fs.readFileSync(filePath, 'utf8').split('\n');
            displayText = fileContent[targetLine]?.trim() ?? '';
            displayLine = `:${lineMatch[1]} ${displayText}`;
          } catch (e) {
            displayLine = `:${lineMatch[1]} <読み込み失敗>`;
          }
        }

        return {
          label: `${file} :${lineMatch?.[1] ?? '?'} ${displayText} ${symbol}`,
          description: undefined,
          raw: line
        };
      });

      const picked = await vscode.window.showQuickPick(items, {
        placeHolder: `${word} の定義を選択`
      });

      if (!picked) return; // 🚨 ここで return するのが重要！
      chosen = picked.raw;
    }

    const parts = chosen.split('\t');
    const filePath = path.join(workspaceRoot, parts[1]);
    const pattern = parts[2];
    let lineNumber = 0;

    const lineMatch = chosen.match(/line:(\d+)/);
    if (lineMatch) {
      lineNumber = parseInt(lineMatch[1], 10) - 1;
    } else {
      const fileLines = fs.readFileSync(filePath, 'utf8').split('\n');
      const target = pattern.replace(/^\/\^|\$\/;?"?$/g, '');
      const foundLine = fileLines.findIndex(line => line.includes(target));
      if (foundLine !== -1) {
        lineNumber = foundLine;
      }
    }

    const doc = await vscode.workspace.openTextDocument(filePath);
    await vscode.window.showTextDocument(doc, {
      viewColumn: vscode.ViewColumn.Two,
      preserveFocus: false,
      selection: new vscode.Range(lineNumber, 0, lineNumber, 0),
      preview: false
    });
  });

  let jumpBackDisposable = vscode.commands.registerCommand('ctags.jumpBack', async () => {
    if (jumpHistory.length === 0) {
      vscode.window.showInformationMessage("No previous location in history.");
      return;
    }

    const last = jumpHistory.pop()!;
    const doc = await vscode.workspace.openTextDocument(last.uri);
    await vscode.window.showTextDocument(doc, {
      viewColumn: last.viewColumn ?? vscode.ViewColumn.One,
      selection: new vscode.Range(last.position, last.position),
      preview: false
    });
  });

  let updateTagsDisposable = vscode.commands.registerCommand('ctags.updateTags', () => {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
      vscode.window.showErrorMessage("No workspace folder open.");
      return;
    }

    // 既存の "CTags Generate" ターミナルを探す
    let terminal = vscode.window.terminals.find(t => t.name === "CTags Generate");

    // なければ新規作成
    if (!terminal) {
      terminal = vscode.window.createTerminal({
        name: "CTags Generate",
        cwd: workspaceRoot
      });
    }

    terminal.show(true);
    terminal.sendText('ctags -R --fields=+n -f .tags .');
  });

  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.text = '$(sync) Tag 更新';
  statusBarItem.tooltip = 'ctags を再生成します';
  statusBarItem.command = 'ctags.updateTags';
  statusBarItem.show();

  context.subscriptions.push(
    jumpRightDisposable,
    jumpBackDisposable,
    updateTagsDisposable,
    statusBarItem
  );
}

export function deactivate() {}
