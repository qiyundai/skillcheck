import * as vscode from 'vscode';
import { LanguageClient, TransportKind } from 'vscode-languageclient/node';
import { execFile } from 'node:child_process';
let client:LanguageClient|undefined;
export async function activate(context:vscode.ExtensionContext):Promise<void> {
  if(!vscode.workspace.isTrusted)return;
  const server=context.asAbsolutePath('dist/skillcheck.mjs');
  client=new LanguageClient('skillcheck','Skillcheck',{command:process.execPath,args:[server,'lsp','--stdio'],transport:TransportKind.stdio,options:{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'}}},{initializationOptions:{allowCloudAnalysis:vscode.workspace.getConfiguration('skillcheck').get<boolean>('allowCloudAnalysis',false)},documentSelector:[{scheme:'file',language:'markdown'},{scheme:'file',pattern:'**/skillcheck.config.json'}],synchronize:{fileEvents:[vscode.workspace.createFileSystemWatcher('**/*.md'),vscode.workspace.createFileSystemWatcher('**/skillcheck.config.json')]}});
  const output=vscode.window.createOutputChannel('Skillcheck diff');context.subscriptions.push(output);
  context.subscriptions.push(vscode.commands.registerCommand('skillcheck.recheck',()=>client?.sendRequest('workspace/executeCommand',{command:'skillcheck.recheck'})));
  context.subscriptions.push(vscode.commands.registerCommand('skillcheck.diff',()=>{
    const folder=vscode.workspace.workspaceFolders?.[0];if(!folder || !vscode.workspace.isTrusted)return;
    const baseline=vscode.workspace.getConfiguration('skillcheck').get<string>('baseline','HEAD');output.clear();output.show(true);
    // Pass repository-controlled refs as arguments, never shell command text.
    execFile(process.execPath,[server,'diff','--base',baseline,'--worktree','--deterministic'],{cwd:folder.uri.fsPath,env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},maxBuffer:16*1024*1024},(error,stdout,stderr)=>{if(stdout)output.append(stdout);if(stderr)output.append(stderr);if(error && !stdout)output.appendLine(error.message);});
  }));
  await client.start();context.subscriptions.push(client);
}
export async function deactivate():Promise<void>{await client?.stop();}
