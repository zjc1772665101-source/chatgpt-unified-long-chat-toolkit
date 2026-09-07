import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const mainPath = 'chatgpt-unified-long-chat-toolkit.user.js';
const addonPath = 'experiments/chatgpt-token-stats.user.js';
const marker = '/* cgpt-token-stats-feature v0.1.0 */';

let main = fs.readFileSync(mainPath, 'utf8');
const addon = fs.readFileSync(addonPath, 'utf8');

if (!main.includes('// @version      1.5.0')) {
  throw new Error('Expected v1.5.0 userscript header; refusing to patch an unexpected version.');
}
if (!main.includes("runtime.version = '1.5.0';")) {
  throw new Error('Expected runtime.version 1.5.0; refusing to patch an unexpected runtime.');
}
if (main.includes(marker) || main.includes('(function tokenStatsFeature()')) {
  throw new Error('Token stats feature already appears to be integrated.');
}

const headerEnd = addon.indexOf('// ==/UserScript==');
if (headerEnd < 0) throw new Error('Token stats addon metadata terminator not found.');
const body = addon.slice(headerEnd + '// ==/UserScript=='.length).trim();
if (!body.includes('(function tokenStatsFeature()')) throw new Error('Token stats addon body not found.');

main = main.replace('// @version      1.5.0', '// @version      1.5.1');
main = main.replace(
  /^\/\/ @description\s+.*$/m,
  '// @description  ChatGPT 长对话性能、导航、提示词、导出与排版工具箱；v1.5.1 新增可见文本 token 估算：逐消息、本轮输入/输出与活动分支可见上下文统计。'
);
main = main.replace("runtime.version = '1.5.0';", "runtime.version = '1.5.1';");
main = `${main.trimEnd()}\n\n${marker}\n${body}\n`;

fs.writeFileSync(mainPath, main);
execFileSync(process.execPath, ['--check', mainPath], { stdio: 'inherit' });
console.log('Integrated token stats into', mainPath);
