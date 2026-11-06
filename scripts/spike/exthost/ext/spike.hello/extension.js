const vscode = require('vscode');
exports.activate = (ctx) => {
  console.log('[spike.hello] activate; vscode.version =', vscode.version, 'has lm:', typeof vscode.lm, 'has chat:', typeof vscode.chat);
  ctx.subscriptions.push(vscode.commands.registerCommand('spike.hello', (n) => `hello ${n ?? 'world'} from ext host ${process.pid}`));
};
