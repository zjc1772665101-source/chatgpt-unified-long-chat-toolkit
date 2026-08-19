// ==UserScript==
// @name         ChatGPT 长对话统一工具箱（性能·导航·提示词·导出·排版）
// @namespace    local.codex.chatgpt.unified
// @version      1.0.5
// @description  合并长对话性能优化、可恢复 DOM 卸载、双层/自适应大纲、提示词库、Markdown/JSON/TXT 会话导出、字体与滚动修复；目录跳转与生成期防自动沉底协同工作。
// @author       Codex；含 Alex S Hamilton 的 ChatGPT Lazy Chat++（GPL-3.0-or-later）
// @homepageURL  https://github.com/zjc1772665101-source/chatgpt-unified-long-chat-toolkit
// @supportURL   https://github.com/zjc1772665101-source/chatgpt-unified-long-chat-toolkit/issues
// @downloadURL  https://raw.githubusercontent.com/zjc1772665101-source/chatgpt-unified-long-chat-toolkit/main/chatgpt-unified-long-chat-toolkit.user.js
// @updateURL    https://raw.githubusercontent.com/zjc1772665101-source/chatgpt-unified-long-chat-toolkit/main/chatgpt-unified-long-chat-toolkit.user.js
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @run-at       document-start
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_getResourceText
// @grant        unsafeWindow
// @require      https://cdn.jsdelivr.net/npm/katex@0.16.44/dist/katex.min.js
// @resource     ophelKatexCss https://cdn.jsdelivr.net/npm/katex@0.16.44/dist/katex.min.css
// @noframes
// @license      GPL-3.0-or-later
// ==/UserScript==


/* SPDX-License-Identifier: GPL-3.0-or-later */

(function coordinatorBundle() {
  'use strict';

  const RUNTIME_KEY = '__cgptUnifiedRuntimeV1';
  const NAV_ATTR = 'data-cgpt-unified-navigation-active';
  const PROMPT_STORAGE_KEY = 'cgpt-unified-prompt-library-v1';
  const runtime = globalThis[RUNTIME_KEY] || (globalThis[RUNTIME_KEY] = {});

  runtime.version = '1.0.5';
  runtime.lazy = runtime.lazy || null;
  runtime.navigationLeaseTimer = 0;
  runtime.beginNavigationLease = (duration = 3200) => {
    const root = document.documentElement;
    if (!root) return;
    root.setAttribute(NAV_ATTR, '1');
    clearTimeout(runtime.navigationLeaseTimer);
    runtime.navigationLeaseTimer = setTimeout(() => {
      document.documentElement?.removeAttribute(NAV_ATTR);
      runtime.navigationLeaseTimer = 0;
    }, Math.max(500, Number(duration) || 3200));
  };
  runtime.isNavigationLeaseActive = () =>
    document.documentElement?.hasAttribute(NAV_ATTR) === true;

  const normalizeText = (value) => String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const safeFilename = (value) => String(value || 'ChatGPT 会话')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/[. ]+$/g, '')
    .slice(0, 120) || 'ChatGPT 会话';

  function escapeMarkdown(value) {
    return String(value ?? '').replace(/([\\`*_{}\[\]<>])/g, '\\$1');
  }

  function nodeToMarkdown(node, depth = 0) {
    if (node.nodeType === Node.TEXT_NODE) return node.nodeValue || '';
    if (!(node instanceof Element)) return '';
    if (node.matches('button, script, style, svg, [aria-hidden="true"], [role="tooltip"]')) return '';

    const tag = node.tagName.toLowerCase();
    const children = () => Array.from(node.childNodes).map((child) => nodeToMarkdown(child, depth)).join('');
    const text = () => normalizeText(children());

    if (node.matches('.katex')) {
      const latex = node.querySelector('annotation[encoding="application/x-tex"]')?.textContent?.trim();
      if (latex) return node.closest('.katex-display') ? `\n$$\n${latex}\n$$\n\n` : `$${latex}$`;
    }
    if (/^h[1-6]$/.test(tag)) return `${'#'.repeat(Number(tag[1]))} ${text()}\n\n`;
    if (tag === 'br') return '\n';
    if (tag === 'hr') return '\n---\n\n';
    if (tag === 'img') {
      const src = node.getAttribute('src') || '';
      return src ? `![${escapeMarkdown(node.getAttribute('alt') || '图片')}](${src})` : '';
    }
    if (tag === 'strong' || tag === 'b') return `**${text()}**`;
    if (tag === 'em' || tag === 'i') return `*${text()}*`;
    if (tag === 'code' && node.parentElement?.tagName.toLowerCase() !== 'pre') return `\`${children()}\``;
    if (tag === 'pre') {
      const code = node.querySelector('code')?.textContent ?? node.textContent ?? '';
      const language = node.querySelector('code')?.className.match(/language-([\w+-]+)/)?.[1] || '';
      return `\n\`\`\`${language}\n${code.replace(/\n+$/, '')}\n\`\`\`\n\n`;
    }
    if (tag === 'a') return `[${text() || node.getAttribute('href') || '链接'}](${node.getAttribute('href') || ''})`;
    if (tag === 'blockquote') return `${text().split('\n').map((line) => `> ${line}`).join('\n')}\n\n`;
    if (tag === 'li') {
      const parentTag = node.parentElement?.tagName.toLowerCase();
      const prefix = parentTag === 'ol'
        ? `${Array.from(node.parentElement.children).indexOf(node) + 1}. `
        : '- ';
      return `${'  '.repeat(Math.max(0, depth))}${prefix}${text()}\n`;
    }
    if (tag === 'ul' || tag === 'ol') {
      return `${Array.from(node.children).map((child) => nodeToMarkdown(child, depth + 1)).join('')}\n`;
    }
    if (tag === 'table') {
      const rows = Array.from(node.querySelectorAll('tr')).map((row) =>
        Array.from(row.querySelectorAll(':scope > th, :scope > td')).map((cell) => normalizeText(cell.textContent))
      ).filter((row) => row.length);
      if (!rows.length) return '';
      const width = Math.max(...rows.map((row) => row.length));
      const normalizedRows = rows.map((row) => [...row, ...Array(Math.max(0, width - row.length)).fill('')]);
      const lines = [
        `| ${normalizedRows[0].map(escapeMarkdown).join(' | ')} |`,
        `| ${Array(width).fill('---').join(' | ')} |`,
        ...normalizedRows.slice(1).map((row) => `| ${row.map(escapeMarkdown).join(' | ')} |`),
      ];
      return `${lines.join('\n')}\n\n`;
    }
    if (tag === 'p' || tag === 'div' || tag === 'section' || tag === 'article') {
      const value = children();
      return value.trim() ? `${value.trim()}\n\n` : '';
    }
    return children();
  }

  class SessionExporter {
    getTurnNodes() {
      const bridged = runtime.lazy?.getAllTurnNodes?.();
      const turns = Array.isArray(bridged) && bridged.length
        ? bridged
        : Array.from(document.querySelectorAll('main [data-testid^="conversation-turn-"]'));
      const seen = new Set();
      return turns.filter((turn) => turn instanceof Element && !seen.has(turn) && seen.add(turn));
    }

    extractContent(roleNode) {
      const source = roleNode.querySelector('.markdown, [data-message-content], .whitespace-pre-wrap') || roleNode;
      const markdown = normalizeText(nodeToMarkdown(source));
      return markdown || normalizeText(source.textContent);
    }

    collect() {
      const messages = [];
      const seen = new Set();
      for (const turn of this.getTurnNodes()) {
        let roleNodes = Array.from(turn.querySelectorAll('[data-message-author-role]'));
        if (turn.matches('[data-message-author-role]')) roleNodes.unshift(turn);
        roleNodes = roleNodes.filter((node) => !node.parentElement?.closest('[data-message-author-role]'));
        for (const roleNode of roleNodes) {
          const role = roleNode.getAttribute('data-message-author-role');
          if (role !== 'user' && role !== 'assistant') continue;
          const messageId = roleNode.getAttribute('data-message-id')
            || roleNode.closest('[data-message-id]')?.getAttribute('data-message-id')
            || `${turn.getAttribute('data-testid') || messages.length}:${role}`;
          if (seen.has(messageId)) continue;
          const content = this.extractContent(roleNode);
          if (!content) continue;
          seen.add(messageId);
          messages.push({ index: messages.length, id: messageId, role, content });
        }
      }
      const title = normalizeText(document.title.replace(/\s*[|·-]\s*ChatGPT.*$/i, '')) || 'ChatGPT 会话';
      return {
        schema: 'cgpt-unified-session-export/v1',
        title,
        url: location.href,
        exportedAt: new Date().toISOString(),
        messages,
      };
    }

    toMarkdown(session = this.collect()) {
      const lines = [
        `# ${session.title}`,
        '',
        `- 导出时间：${session.exportedAt}`,
        `- 来源：${session.url}`,
        `- 消息数：${session.messages.length}`,
        '',
        '---',
        '',
      ];
      session.messages.forEach((message, index) => {
        lines.push(`## ${message.role === 'user' ? '用户' : 'ChatGPT'} · ${index + 1}`, '', message.content, '', '---', '');
      });
      return lines.join('\n');
    }

    toText(session = this.collect()) {
      return session.messages.map((message, index) =>
        `[${index + 1}] ${message.role === 'user' ? '用户' : 'ChatGPT'}\n${message.content}`
      ).join('\n\n' + '-'.repeat(72) + '\n\n');
    }

    serialize(format, session = this.collect()) {
      if (format === 'json') return JSON.stringify(session, null, 2);
      if (format === 'txt') return this.toText(session);
      return this.toMarkdown(session);
    }

    download(format = 'markdown') {
      const session = this.collect();
      if (!session.messages.length) {
        window.alert('暂未找到可导出的会话内容。');
        return false;
      }
      const normalized = format === 'md' ? 'markdown' : format;
      const extension = normalized === 'markdown' ? 'md' : normalized;
      const mime = normalized === 'json' ? 'application/json' : 'text/plain';
      const blob = new Blob([this.serialize(normalized, session)], { type: `${mime};charset=utf-8` });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${safeFilename(session.title)}-${new Date().toISOString().slice(0, 10)}.${extension}`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      return true;
    }

    async copyMarkdown() {
      const session = this.collect();
      if (!session.messages.length) return false;
      const text = this.toMarkdown(session);
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        textarea.remove();
      }
      return true;
    }
  }

  function storageRead(key, fallback) {
    try {
      if (typeof GM_getValue === 'function') return GM_getValue(key, fallback);
    } catch {}
    try {
      const raw = localStorage.getItem(key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  function storageWrite(key, value) {
    try {
      if (typeof GM_setValue === 'function') {
        GM_setValue(key, value);
        return;
      }
    } catch {}
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {}
  }

  // Tabler Icons (MIT): https://github.com/tabler/tabler-icons
  const PROMPT_ACTION_ICONS = Object.freeze({
    pin: [
      'M15 4.5l-4 4l-4 1.5l-1.5 1.5l7 7l1.5 -1.5l1.5 -4l4 -4',
      'M9 15l-4.5 4.5',
      'M14.5 4l5.5 5.5',
    ],
    edit: [
      'M7 7h-1a2 2 0 0 0 -2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2 -2v-1',
      'M20.385 6.585a2.1 2.1 0 0 0 -2.97 -2.97l-8.415 8.385v3h3l8.385 -8.415',
      'M16 5l3 3',
    ],
  });

  class PromptLibrary {
    constructor() {
      this.prompts = this.normalizeLibrary(storageRead(PROMPT_STORAGE_KEY, []));
      this.nav = null;
      this.shadow = null;
      this.list = null;
      this.searchInput = null;
      this.categorySelect = null;
      this.editor = null;
      this.editingId = null;
      this.onCountChange = null;
      this.draggedPromptId = null;
      this.suppressPromptClickUntil = 0;
    }

    normalizeLibrary(value) {
      if (!Array.isArray(value)) return [];
      const normalized = value.map((item, index) => ({
        id: String(item?.id || `prompt-${Date.now()}-${index}`),
        title: normalizeText(item?.title || `提示词 ${index + 1}`).slice(0, 120),
        category: normalizeText(item?.category || '未分类').slice(0, 48),
        content: String(item?.content || ''),
        pinned: Boolean(item?.pinned),
        order: Number.isFinite(Number(item?.order)) ? Number(item.order) : index,
        useCount: Math.max(0, Number(item?.useCount) || 0),
        createdAt: item?.createdAt || new Date().toISOString(),
        updatedAt: item?.updatedAt || new Date().toISOString(),
        lastUsedAt: item?.lastUsedAt || null,
      })).filter((item) => item.content.trim());
      normalized.sort((a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt));
      return this.reindexPromptOrder(normalized);
    }

    get count() {
      return this.prompts.length;
    }

    persist() {
      storageWrite(PROMPT_STORAGE_KEY, this.prompts);
      this.onCountChange?.(this.count);
    }

    mount({ shadow, nav, onCountChange }) {
      if (!(shadow instanceof ShadowRoot) || !(nav instanceof HTMLElement)) return;
      this.shadow = shadow;
      this.nav = nav;
      this.onCountChange = onCountChange;
      this.installStyles();
      this.buildShell();
      this.render();
      this.onCountChange?.(this.count);
    }

    installStyles() {
      if (this.shadow.getElementById('cgpt-unified-prompt-style')) return;
      const style = document.createElement('style');
      style.id = 'cgpt-unified-prompt-style';
      style.textContent = `
        .prompt-view { min-height: 0; display: flex; flex: 1; flex-direction: column; overflow: hidden; }
        .prompt-view[hidden] { display: none !important; }
        .prompt-toolbar, .session-export-toolbar { display: flex; flex: none; gap: 5px; padding: 6px; border-bottom: 1px solid var(--border-light, rgba(0,0,0,.1)); }
        .prompt-toolbar input, .prompt-toolbar select, .prompt-editor input, .prompt-editor textarea { min-width: 0; border: 1px solid var(--border-light, rgba(0,0,0,.16)); border-radius: 7px; background: var(--main-surface-primary, var(--bg-primary, #fff)); color: var(--text-primary, #161616); font: inherit; }
        .prompt-toolbar input { flex: 1; padding: 5px 7px; }
        .prompt-toolbar select { max-width: 88px; padding: 4px; }
        .prompt-mini-btn { flex: none; min-height: 29px; padding: 4px 7px; border: 0; border-radius: 7px; background: var(--main-surface-secondary, var(--bg-secondary, #eee)); color: var(--text-primary, #161616); font: inherit; cursor: pointer; }
        .prompt-mini-btn:hover { filter: brightness(.96); }
        .prompt-mini-btn[hidden] { display: none !important; }
        .prompt-mini-btn.danger { margin-right: auto; background: color-mix(in srgb, #dc2626 14%, var(--main-surface-secondary, var(--bg-secondary, #eee))); color: #dc2626; }
        .session-export-toolbar { align-items: center; color: var(--text-tertiary, #777); font-size: 11px; }
        .session-export-toolbar .prompt-mini-btn { min-height: 25px; padding: 3px 6px; font-size: 11px; }
        .prompt-list { min-height: 0; flex: 1; overflow-y: auto; padding: 6px; scrollbar-width: thin; }
        .prompt-card { position: relative; margin-bottom: 5px; padding: 8px; border: 1px solid transparent; border-radius: 9px; background: color-mix(in srgb, var(--main-surface-secondary, #eee) 58%, transparent); cursor: grab; transition: border-color 120ms ease, opacity 120ms ease, transform 120ms ease; }
        .prompt-card[data-pinned="true"] { border-color: color-mix(in srgb, #d99b18 45%, transparent); }
        .prompt-card.dragging { opacity: .42; cursor: grabbing; }
        .prompt-card.drop-before::before, .prompt-card.drop-after::after { position: absolute; right: 5px; left: 5px; z-index: 2; height: 2px; border-radius: 99px; background: #6d5dfc; content: ''; pointer-events: none; }
        .prompt-card.drop-before::before { top: -4px; }
        .prompt-card.drop-after::after { bottom: -4px; }
        .prompt-card-main { width: 100%; min-width: 0; padding: 0 64px 5px 0; border: 0; background: transparent; color: inherit; text-align: start; cursor: pointer; }
        .prompt-card-title { display: flex; min-width: 0; gap: 6px; align-items: center; font-weight: 600; }
        .prompt-card-title-text { display: block; min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .prompt-card-category { flex: none; max-width: 42%; padding: 1px 5px; overflow: hidden; border-radius: 99px; background: color-mix(in srgb, currentColor 9%, transparent); color: var(--text-tertiary, #777); font-size: 10px; font-weight: 400; text-overflow: ellipsis; white-space: nowrap; }
        .prompt-card-preview { display: -webkit-box; margin-top: 4px; overflow: hidden; -webkit-box-orient: vertical; -webkit-line-clamp: 2; color: var(--text-secondary, #555); font-size: 11.5px; white-space: pre-wrap; }
        .prompt-card-actions { position: absolute; top: 6px; right: 6px; display: flex; gap: 2px; opacity: 0; visibility: hidden; pointer-events: none; transform: translateY(-2px); transition: opacity 120ms ease, transform 120ms ease, visibility 120ms; }
        .prompt-card:hover .prompt-card-actions, .prompt-card:focus-within .prompt-card-actions { opacity: 1; visibility: visible; pointer-events: auto; transform: translateY(0); }
        .prompt-action-btn { display: grid; width: 28px; height: 28px; padding: 0; place-items: center; border: 0; border-radius: 7px; background: color-mix(in srgb, var(--main-surface-primary, #fff) 72%, transparent); color: var(--text-secondary, #666); cursor: pointer; }
        .prompt-action-btn:hover, .prompt-action-btn:focus-visible { background: var(--main-surface-primary, var(--bg-primary, #fff)); color: var(--text-primary, #161616); outline: none; }
        .prompt-action-btn.active { background: #6d5dfc; color: #fff; }
        .prompt-action-icon { display: block; width: 17px; height: 17px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
        .prompt-empty { padding: 24px 12px; color: var(--text-tertiary, #777); text-align: center; font-size: 12px; }
        .toc-item[data-unloaded="true"] { color: var(--text-tertiary, #777); font-style: italic; }
        .prompt-editor { width: min(520px, calc(100vw - 32px)); max-height: calc(100vh - 32px); padding: 0; overflow: hidden; border: 1px solid var(--border-light, rgba(0,0,0,.18)); border-radius: 12px; background: var(--main-surface-primary, var(--bg-primary, #fff)); color: var(--text-primary, #161616); pointer-events: auto !important; }
        .prompt-editor::backdrop { background: rgba(0,0,0,.45); pointer-events: auto !important; }
        .prompt-editor-form { display: flex; flex-direction: column; gap: 9px; max-height: calc(100vh - 32px); padding: 16px; overflow-y: auto; overscroll-behavior: contain; }
        .prompt-editor h3 { margin: 0 0 3px; font-size: 16px; }
        .prompt-editor label { display: grid; gap: 4px; color: var(--text-secondary, #555); font-size: 12px; }
        .prompt-editor input, .prompt-editor textarea { padding: 7px 9px; }
        .prompt-editor textarea { min-height: 140px; max-height: 46vh; resize: vertical; }
        .prompt-editor-actions { display: flex; gap: 7px; justify-content: flex-end; }
        @media (hover: none), (pointer: coarse) {
          .prompt-card-actions { opacity: 1; visibility: visible; pointer-events: auto; transform: none; }
        }
        @media (prefers-reduced-motion: reduce) {
          .prompt-card, .prompt-card-actions { transition: none; }
        }
      `;
      this.shadow.appendChild(style);
    }

    makeButton(label, title, handler) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'prompt-mini-btn';
      button.textContent = label;
      button.title = title || label;
      button.addEventListener('click', handler);
      return button;
    }

    makeIconButton(iconName, title, handler) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'prompt-action-btn';
      button.title = title;
      button.setAttribute('aria-label', title);
      button.draggable = false;
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.classList.add('prompt-action-icon');
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.setAttribute('aria-hidden', 'true');
      for (const pathData of PROMPT_ACTION_ICONS[iconName] || []) {
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', pathData);
        svg.appendChild(path);
      }
      button.appendChild(svg);
      button.addEventListener('dragstart', (event) => event.preventDefault());
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        handler(event);
      });
      return button;
    }

    buildShell() {
      this.nav.replaceChildren();
      this.nav.classList.add('prompt-view');

      const toolbar = document.createElement('div');
      toolbar.className = 'prompt-toolbar';
      this.searchInput = document.createElement('input');
      this.searchInput.type = 'search';
      this.searchInput.placeholder = '搜索提示词';
      this.searchInput.addEventListener('input', () => this.render());
      this.categorySelect = document.createElement('select');
      this.categorySelect.title = '按分类筛选';
      this.categorySelect.addEventListener('change', () => this.render());
      toolbar.append(
        this.searchInput,
        this.categorySelect,
        this.makeButton('＋', '新建提示词', () => this.openEditor()),
        this.makeButton('⇩', '导入提示词 JSON', () => this.importPrompts()),
        this.makeButton('⇧', '导出提示词 JSON', () => this.exportPrompts()),
      );

      const exportToolbar = document.createElement('div');
      exportToolbar.className = 'session-export-toolbar';
      const label = document.createElement('span');
      label.textContent = '导出会话';
      exportToolbar.append(
        label,
        this.makeButton('MD', '导出 Markdown', () => runtime.sessionExporter.download('markdown')),
        this.makeButton('JSON', '导出 JSON', () => runtime.sessionExporter.download('json')),
        this.makeButton('TXT', '导出纯文本', () => runtime.sessionExporter.download('txt')),
        this.makeButton('复制 MD', '复制完整会话 Markdown', async () => {
          const ok = await runtime.sessionExporter.copyMarkdown();
          if (!ok) window.alert('暂未找到可复制的会话内容。');
        }),
      );

      this.list = document.createElement('div');
      this.list.className = 'prompt-list';
      this.nav.append(toolbar, exportToolbar, this.list);
      this.buildEditor();
    }

    buildEditor() {
      const dialog = document.createElement('dialog');
      dialog.className = 'prompt-editor';
      const form = document.createElement('form');
      form.className = 'prompt-editor-form';
      form.method = 'dialog';
      const title = document.createElement('h3');
      title.textContent = '提示词';
      const titleLabel = document.createElement('label');
      titleLabel.textContent = '名称';
      const titleInput = document.createElement('input');
      titleInput.name = 'title';
      titleInput.required = true;
      titleLabel.appendChild(titleInput);
      const categoryLabel = document.createElement('label');
      categoryLabel.textContent = '分类';
      const categoryInput = document.createElement('input');
      categoryInput.name = 'category';
      categoryInput.placeholder = '未分类';
      categoryLabel.appendChild(categoryInput);
      const contentLabel = document.createElement('label');
      contentLabel.textContent = '内容（变量写作 {{变量名}}）';
      const contentInput = document.createElement('textarea');
      contentInput.name = 'content';
      contentInput.required = true;
      contentLabel.appendChild(contentInput);
      const actions = document.createElement('div');
      actions.className = 'prompt-editor-actions';
      const remove = this.makeButton('删除提示词', '删除当前提示词', () => {
        const id = this.editingId;
        if (id && this.deletePrompt(id)) dialog.close();
      });
      remove.classList.add('danger');
      remove.hidden = true;
      const cancel = this.makeButton('取消', '取消', () => dialog.close());
      const save = this.makeButton('保存', '保存提示词', () => {
        if (!form.reportValidity()) return;
        this.saveEditor({
          title: titleInput.value,
          category: categoryInput.value,
          content: contentInput.value,
        });
        dialog.close();
      });
      actions.append(remove, cancel, save);
      form.append(title, titleLabel, categoryLabel, contentLabel, actions);
      dialog.appendChild(form);
      dialog.addEventListener('cancel', () => {
        this.editingId = null;
      });
      dialog.addEventListener('close', () => {
        this.editingId = null;
      });
      this.shadow.appendChild(dialog);
      this.editor = { dialog, form, titleInput, categoryInput, contentInput, remove };
    }

    refreshCategories() {
      const current = this.categorySelect.value;
      const categories = [...new Set(this.prompts.map((item) => item.category))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
      this.categorySelect.replaceChildren(new Option('全部分类', ''));
      categories.forEach((category) => this.categorySelect.appendChild(new Option(category, category)));
      this.categorySelect.value = categories.includes(current) ? current : '';
    }

    filteredPrompts() {
      const query = normalizeText(this.searchInput?.value).toLocaleLowerCase();
      const category = this.categorySelect?.value || '';
      return this.prompts.filter((item) => {
        if (category && item.category !== category) return false;
        if (!query) return true;
        return `${item.title}\n${item.category}\n${item.content}`.toLocaleLowerCase().includes(query);
      }).sort((a, b) => a.order - b.order || a.title.localeCompare(b.title, 'zh-CN'));
    }

    orderedPrompts() {
      return [...this.prompts].sort((a, b) => a.order - b.order || a.title.localeCompare(b.title, 'zh-CN'));
    }

    reindexPromptOrder(items = this.prompts) {
      items.forEach((item, index) => {
        item.order = index;
      });
      return items;
    }

    movePrompt(draggedId, targetId, placeAfter = false) {
      if (!draggedId || !targetId || draggedId === targetId) return false;
      const ordered = this.orderedPrompts();
      const fromIndex = ordered.findIndex((item) => item.id === draggedId);
      if (fromIndex < 0) return false;
      const [dragged] = ordered.splice(fromIndex, 1);
      const targetIndex = ordered.findIndex((item) => item.id === targetId);
      if (targetIndex < 0) return false;
      ordered.splice(targetIndex + (placeAfter ? 1 : 0), 0, dragged);
      this.prompts = this.reindexPromptOrder(ordered);
      this.persist();
      this.render();
      return true;
    }

    clearPromptDropIndicators() {
      this.list?.querySelectorAll('.drop-before, .drop-after').forEach((card) => {
        card.classList.remove('drop-before', 'drop-after');
      });
    }

    finishPromptDrag() {
      this.list?.querySelectorAll('.prompt-card.dragging').forEach((card) => {
        card.classList.remove('dragging');
        card.setAttribute('aria-grabbed', 'false');
      });
      this.clearPromptDropIndicators();
      this.draggedPromptId = null;
      this.suppressPromptClickUntil = Date.now() + 250;
    }

    handlePromptDragStart(event, item, card) {
      const target = event.target;
      if (target instanceof Element && target.closest('.prompt-action-btn')) {
        event.preventDefault();
        return;
      }
      this.draggedPromptId = item.id;
      card.classList.add('dragging');
      card.setAttribute('aria-grabbed', 'true');
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', item.id);
      }
    }

    handlePromptDragOver(event, item, card) {
      if (!this.draggedPromptId || this.draggedPromptId === item.id) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
      this.clearPromptDropIndicators();
      const rect = card.getBoundingClientRect();
      card.classList.add(event.clientY < rect.top + rect.height / 2 ? 'drop-before' : 'drop-after');
    }

    handlePromptDrop(event, item, card) {
      event.preventDefault();
      const draggedId = this.draggedPromptId;
      if (!draggedId || draggedId === item.id) {
        this.finishPromptDrag();
        return;
      }
      const rect = card.getBoundingClientRect();
      const placeAfter = event.clientY >= rect.top + rect.height / 2;
      this.finishPromptDrag();
      this.movePrompt(draggedId, item.id, placeAfter);
    }

    render() {
      if (!this.list) return;
      this.refreshCategories();
      const fragment = document.createDocumentFragment();
      const items = this.filteredPrompts();
      if (!items.length) {
        const empty = document.createElement('div');
        empty.className = 'prompt-empty';
        empty.textContent = this.prompts.length ? '没有匹配的提示词' : '还没有提示词。点击“＋”创建。';
        fragment.appendChild(empty);
      }
      items.forEach((item) => fragment.appendChild(this.renderCard(item)));
      this.list.replaceChildren(fragment);
    }

    renderCard(item) {
      const card = document.createElement('article');
      card.className = 'prompt-card';
      card.dataset.pinned = String(item.pinned);
      card.dataset.promptId = item.id;
      card.draggable = true;
      card.setAttribute('aria-grabbed', 'false');
      const main = document.createElement('button');
      main.type = 'button';
      main.className = 'prompt-card-main';
      main.title = `${item.title}\n点击插入；按住拖动可调整顺序`;
      const title = document.createElement('div');
      title.className = 'prompt-card-title';
      const titleText = document.createElement('span');
      titleText.className = 'prompt-card-title-text';
      titleText.textContent = `${item.pinned ? '★ ' : ''}${item.title}`;
      titleText.title = item.title;
      const category = document.createElement('span');
      category.className = 'prompt-card-category';
      category.textContent = item.category;
      title.append(titleText, category);
      const preview = document.createElement('div');
      preview.className = 'prompt-card-preview';
      preview.textContent = item.content;
      main.append(title, preview);
      main.addEventListener('click', (event) => {
        if (Date.now() < this.suppressPromptClickUntil) {
          event.preventDefault();
          return;
        }
        this.usePrompt(item);
      });

      const actions = document.createElement('div');
      actions.className = 'prompt-card-actions';
      const pin = this.makeIconButton('pin', item.pinned ? '取消置顶' : '置顶', () => this.togglePin(item.id));
      pin.classList.toggle('active', item.pinned);
      pin.setAttribute('aria-pressed', String(item.pinned));
      actions.append(pin, this.makeIconButton('edit', '编辑', () => this.openEditor(item)));
      card.append(main, actions);
      card.addEventListener('dragstart', (event) => this.handlePromptDragStart(event, item, card));
      card.addEventListener('dragover', (event) => this.handlePromptDragOver(event, item, card));
      card.addEventListener('dragleave', (event) => {
        if (!card.contains(event.relatedTarget)) card.classList.remove('drop-before', 'drop-after');
      });
      card.addEventListener('drop', (event) => this.handlePromptDrop(event, item, card));
      card.addEventListener('dragend', () => this.finishPromptDrag());
      return card;
    }

    openEditor(item = null) {
      if (!this.editor) return;
      this.editingId = item?.id || null;
      this.editor.titleInput.value = item?.title || '';
      this.editor.categoryInput.value = item?.category || '未分类';
      this.editor.contentInput.value = item?.content || '';
      this.editor.remove.hidden = !item;
      if (typeof this.editor.dialog.showModal === 'function') this.editor.dialog.showModal();
      else this.editor.dialog.setAttribute('open', '');
      setTimeout(() => this.editor.titleInput.focus(), 0);
    }

    saveEditor(draft) {
      const now = new Date().toISOString();
      const normalized = {
        title: normalizeText(draft.title).slice(0, 120),
        category: normalizeText(draft.category || '未分类').slice(0, 48) || '未分类',
        content: String(draft.content || '').trim(),
        updatedAt: now,
      };
      if (!normalized.title || !normalized.content) return;
      const index = this.prompts.findIndex((item) => item.id === this.editingId);
      if (index >= 0) this.prompts[index] = { ...this.prompts[index], ...normalized };
      else this.prompts.push({
        id: `prompt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        ...normalized,
        pinned: false,
        order: this.prompts.length,
        useCount: 0,
        createdAt: now,
        lastUsedAt: null,
      });
      this.persist();
      this.render();
    }

    togglePin(id) {
      const item = this.prompts.find((prompt) => prompt.id === id);
      if (!item) return;
      item.pinned = !item.pinned;
      item.updatedAt = new Date().toISOString();
      if (item.pinned) {
        const ordered = this.orderedPrompts().filter((prompt) => prompt.id !== id);
        this.prompts = this.reindexPromptOrder([item, ...ordered]);
      }
      this.persist();
      this.render();
    }

    deletePrompt(id) {
      const item = this.prompts.find((prompt) => prompt.id === id);
      if (!item || !window.confirm(`删除提示词“${item.title}”？`)) return false;
      this.prompts = this.prompts.filter((prompt) => prompt.id !== id);
      this.reindexPromptOrder(this.prompts);
      this.persist();
      this.render();
      return true;
    }

    resolveVariables(content) {
      const names = [...new Set(Array.from(String(content).matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g), (match) => match[1].trim()))];
      let resolved = String(content);
      for (const name of names) {
        const value = window.prompt(`填写变量：${name}`, '');
        if (value === null) return null;
        const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        resolved = resolved.replace(new RegExp(`\\{\\{\\s*${escaped}\\s*\\}\\}`, 'g'), value);
      }
      return resolved;
    }

    findComposer() {
      const candidates = [...new Set(document.querySelectorAll([
        '#prompt-textarea',
        '.ProseMirror[contenteditable="true"]',
        '[contenteditable="true"][role="textbox"]',
        'form[class*="composer"] [contenteditable="true"]',
        'textarea[name="prompt-textarea"]',
      ].join(', ')))];
      return candidates.find((element) => {
        if (!element?.isConnected || element.hasAttribute('disabled')) return false;
        if (element.getAttribute('aria-disabled') === 'true' || element.getAttribute('contenteditable') === 'false') return false;
        const view = element.ownerDocument?.defaultView || window;
        const style = view.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== 'none'
          && style.visibility !== 'hidden'
          && Number(style.opacity || 1) > 0
          && rect.width > 0
          && rect.height > 0;
      }) || null;
    }

    insertIntoComposer(text) {
      const composer = this.findComposer();
      if (!composer || typeof composer.focus !== 'function') {
        window.alert('没有找到 ChatGPT 输入框。请先打开一个可输入的会话。');
        return false;
      }
      const ownerDocument = composer.ownerDocument || document;
      const ownerWindow = ownerDocument.defaultView || window;
      const TextareaCtor = ownerWindow.HTMLTextAreaElement;
      const InputCtor = ownerWindow.HTMLInputElement;
      const isTextControl = (TextareaCtor && composer instanceof TextareaCtor)
        || (InputCtor && composer instanceof InputCtor);
      composer.focus({ preventScroll: true });
      if (isTextControl) {
        const start = composer.selectionStart ?? composer.value.length;
        const end = composer.selectionEnd ?? start;
        composer.setRangeText(text, start, end, 'end');
        let inputEvent;
        try {
          inputEvent = new ownerWindow.InputEvent('input', {
            bubbles: true,
            composed: true,
            inputType: 'insertText',
            data: text,
          });
        } catch {
          inputEvent = new ownerWindow.Event('input', { bubbles: true, composed: true });
        }
        composer.dispatchEvent(inputEvent);
      } else if (composer.isContentEditable || composer.getAttribute('contenteditable') === 'true') {
        const selection = ownerWindow.getSelection();
        if (!selection) return false;

        const placeCaretAtEnd = () => {
          const endRange = ownerDocument.createRange();
          endRange.selectNodeContents(composer);
          endRange.collapse(false);
          selection.removeAllRanges();
          selection.addRange(endRange);
        };
        if (!selection.rangeCount || !composer.contains(selection.anchorNode)) placeCaretAtEnd();

        const beforeText = composer.textContent || '';
        try {
          // ChatGPT 的 ProseMirror 会处理 beforeinput；先走它自己的编辑事务，
          // 可避免“DOM 看似写入后又被 React 状态还原”。
          composer.dispatchEvent(new ownerWindow.InputEvent('beforeinput', {
            bubbles: true,
            cancelable: true,
            composed: true,
            inputType: 'insertText',
            data: text,
          }));
        } catch {}

        let inserted = (composer.textContent || '') !== beforeText;
        if (!inserted) {
          if (!selection.rangeCount || !composer.contains(selection.anchorNode)) placeCaretAtEnd();
          try {
            ownerDocument.execCommand('insertText', false, text);
          } catch {}
          inserted = (composer.textContent || '') !== beforeText;
        }

        if (!inserted) {
          if (!selection.rangeCount || !composer.contains(selection.anchorNode)) placeCaretAtEnd();
          const range = selection.getRangeAt(0);
          range.deleteContents();
          const node = ownerDocument.createTextNode(text);
          range.insertNode(node);
          range.setStartAfter(node);
          range.collapse(true);
          selection.removeAllRanges();
          selection.addRange(range);
          let inputEvent;
          try {
            inputEvent = new ownerWindow.InputEvent('input', {
              bubbles: true,
              composed: true,
              inputType: 'insertText',
              data: text,
            });
          } catch {
            inputEvent = new ownerWindow.Event('input', { bubbles: true, composed: true });
          }
          composer.dispatchEvent(inputEvent);
        }
      } else {
        return false;
      }
      composer.focus({ preventScroll: true });
      return true;
    }

    usePrompt(item) {
      const resolved = this.resolveVariables(item.content);
      if (resolved == null || !this.insertIntoComposer(resolved)) return;
      item.useCount += 1;
      item.lastUsedAt = new Date().toISOString();
      this.persist();
      this.render();
    }

    async copyText(text) {
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        textarea.remove();
      }
    }

    exportPrompts() {
      const blob = new Blob([JSON.stringify(this.prompts, null, 2)], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `chatgpt-prompts-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    importPrompts() {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json,application/json';
      input.addEventListener('change', async () => {
        const file = input.files?.[0];
        if (!file) return;
        try {
          const imported = this.normalizeLibrary(JSON.parse(await file.text()));
          if (!imported.length) throw new Error('文件中没有有效提示词');
          const overwrite = window.confirm('确定：覆盖现有提示词\n取消：按 ID/标题合并');
          if (overwrite) {
            this.prompts = imported;
          } else {
            const merged = new Map(this.prompts.map((item) => [item.id, item]));
            for (const item of imported) {
              const sameTitle = [...merged.values()].find((current) => current.title === item.title);
              const existing = merged.get(item.id) || sameTitle || null;
              const id = existing?.id || item.id;
              merged.set(id, {
                ...(existing || {}),
                ...item,
                id,
                order: existing?.order ?? merged.size,
              });
            }
            this.prompts = this.reindexPromptOrder([...merged.values()].sort((a, b) => a.order - b.order));
          }
          this.persist();
          this.render();
        } catch (error) {
          window.alert(`导入失败：${error?.message || error}`);
        }
      }, { once: true });
      input.click();
    }
  }

  runtime.sessionExporter = runtime.sessionExporter || new SessionExporter();
  runtime.promptLibrary = runtime.promptLibrary || new PromptLibrary();
})();

/* ===== Module 1: long-chat performance + adaptive navigation ===== */

(() => {
  'use strict';

  const CONFIG = Object.freeze({
    // 单条回答本身非常长时再开启。默认关闭，兼容性更稳。
    optimizeBlocksInsideLongAnswers: false,

    // 仅当“正在输入的提示词本身也很长”时尝试开启。
    disableEditorSpellcheck: false,

    // 隐藏选中文字后出现的“询问 ChatGPT / 开始写作”浮层。
    hideSelectionActions: true,

    // 启用当前 Assistant 回答内部的自适应章节目录。
    enableAnswerToc: true,

    // “章节”只描述当前回答内部结构；完整读取 H1-H6，再按需补充回答内的派生小节。
    answerTocHeadingSelector: 'h1, h2, h3, h4, h5, h6',

    answerTocDerivedOutline: true,
    answerTocDerivedMaxItems: 18,
    answerTocDerivedMinTextLength: 8,

    // 第一次使用时是否默认收起；之后会记住手动选择。
    answerTocInitiallyCollapsed: false,
    answerTocRememberCollapsedState: true,

    // 目录跳转动画。系统开启“减少动态效果”时会自动禁用动画。
    answerTocSmoothScroll: true,

    // 以视口从上往下 28% 的位置作为“当前章节”判定线。
    answerTocActiveLineRatio: 0.28,

    // 为官方右侧问答导航预留的最小空间。
    answerTocFallbackInlineEndPx: 68,
    answerTocOfficialNavGapPx: 12,

    // 窗口太窄时隐藏目录，避免覆盖主要内容。设为 0 可始终显示。
    answerTocMinViewportWidth: 820,

    // 目录条目的最大文本长度；完整标题仍会放在 title 提示中。
    answerTocMaxLabelLength: 180,

    // 目录与折叠按钮的背景透明度，范围 0～1。
    answerTocPanelOpacity: 0.72,
    answerTocLauncherOpacity: 0.68,

    // 半透明背景后的模糊强度。默认关闭，避免固定模糊层增加绘制开销。
    answerTocBackdropBlurPx: 0,

    // 折叠按钮悬停多久后临时展开；光标离开整个面板后多久自动收起。
    answerTocHoverExpandDelayMs: 180,
    answerTocHoverCollapseDelayMs: 220,

    // 一级目录：整段对话中的用户提问；二级目录：当前回答里的 H1/H2。
    enableConversationToc: true,
    hideOfficialConversationToc: true,
    answerTocInitialView: 'headings', // 可选：'conversation' 或 'headings'
    answerTocRememberView: true,
    // 问答预览最多显示 3 行；完整提问仍保留在鼠标悬停提示中。
    // 设为 0 可取消按行限制。
    conversationTocPreviewMaxLines: 3,

    // 超长提问最多保留 240 个字符；设为 0 可取消按字符限制。
    conversationTocMaxLabelLength: 240,

    // 问答跳转后，目标提问与滚动视口顶部之间保留的距离。
    conversationTocScrollOffsetPx: 88,

    // 隐藏官方问答导航后，自定义目录距页面右侧的默认距离。
    answerTocStandaloneInlineEndPx: 20,

    // 拖动后是否记住位置，以及控件与视口边缘的最小距离。
    answerTocRememberPosition: true,
    answerTocDragViewportMarginPx: 8,

    // 面板四角缩放范围及尺寸持久化。缩放会自动转为手动定位。
    answerTocRememberSize: true,
    answerTocMinWidthPx: 220,
    answerTocMaxWidthPx: 560,
    answerTocMinHeightPx: 170,
    answerTocMaxHeightPx: 760,
  });

  const TURN_SELECTOR = 'main [data-testid^="conversation-turn-"]';
  const ASSISTANT_SELECTOR = 'main [data-message-author-role="assistant"]';
  const USER_SELECTOR = 'main [data-message-author-role="user"]';

  const LONG_ANSWER_BLOCK_SELECTOR = [
    `${ASSISTANT_SELECTOR} .markdown > p`,
    `${ASSISTANT_SELECTOR} .markdown > pre`,
    `${ASSISTANT_SELECTOR} .markdown > blockquote`,
    `${ASSISTANT_SELECTOR} .markdown > ul`,
    `${ASSISTANT_SELECTOR} .markdown > ol`,
    `${ASSISTANT_SELECTOR} .markdown > table`,
    `${ASSISTANT_SELECTOR} .markdown > h1`,
    `${ASSISTANT_SELECTOR} .markdown > h2`,
    `${ASSISTANT_SELECTOR} .markdown > h3`,
    `${ASSISTANT_SELECTOR} .markdown > h4`,
    `${ASSISTANT_SELECTOR} .markdown > div`,
  ].join(',\n');

  const css = [];

  css.push(`
    @supports (content-visibility: auto) {
      /*
       * 屏幕外的历史轮次仍保留在 DOM 中，但浏览器可以跳过其子树的
       * 大量样式计算、布局和绘制工作。
       */
      ${TURN_SELECTOR} {
        content-visibility: auto !important;
        contain-intrinsic-size: auto 640px !important;
        contain-intrinsic-size: auto none auto 640px !important;
      }

      /* data-testid 结构变化时的保守后备。 */
      ${ASSISTANT_SELECTOR} {
        content-visibility: auto !important;
        contain-intrinsic-size: auto 480px !important;
        contain-intrinsic-size: auto none auto 480px !important;
      }
    }
  `);

  if (CONFIG.optimizeBlocksInsideLongAnswers) {
    css.push(`
      @supports (content-visibility: auto) {
        /* 仅用于“一条回答本身就非常长”的情况。 */
        ${LONG_ANSWER_BLOCK_SELECTOR} {
          content-visibility: auto !important;
          contain-intrinsic-size: auto 128px !important;
          contain-intrinsic-size: auto none auto 128px !important;
        }
      }
    `);
  }

  if (CONFIG.hideSelectionActions) {
    css.push(`
      [popover="manual"][style*="--targeted-action-selection"] {
        display: none !important;
        pointer-events: none !important;
      }
    `);
  }

  if (CONFIG.hideOfficialConversationToc) {
    css.push(`
      /*
       * 只在视觉和指针层面隐藏官方问答导航，不使用 display:none。
       * 这样仍可调用其原生点击逻辑处理尚未挂载的远端历史轮次。
       */
      [data-cgpt-native-conversation-toc-hidden] {
        visibility: hidden !important;
        opacity: 0 !important;
        pointer-events: none !important;
      }
    `);
  }

  if (CONFIG.enableAnswerToc) {
    css.push(`
      /* 让目录跳转后的标题与页面顶部保留适当间距。 */
      ${ASSISTANT_SELECTOR} :is(h1, h2, h3, h4) {
        scroll-margin-block-start: 88px;
      }

      /*
       * 远距离跳转时临时完整布局目标轮次，减少 content-visibility
       * 使用估算高度而导致的落点偏差。脚本会在定位稳定后移除此属性。
       */
      [data-cgpt-conversation-jump-target] {
        content-visibility: visible !important;
        contain-intrinsic-size: none !important;
      }
    `);
  }

  css.push(`
    @media print {
      ${TURN_SELECTOR},
      ${ASSISTANT_SELECTOR}${CONFIG.optimizeBlocksInsideLongAnswers ? `,\n${LONG_ANSWER_BLOCK_SELECTOR}` : ''} {
        content-visibility: visible !important;
        contain-intrinsic-size: none !important;
      }

      #cgpt-answer-toc-host {
        display: none !important;
      }
    }
  `);

  GM_addStyle(css.join('\n'));

  if (CONFIG.disableEditorSpellcheck) {
    const EDITOR_SELECTOR = [
      '#prompt-textarea[contenteditable="true"]',
      'textarea[name="prompt-textarea"]',
    ].join(',');

    const tuneEditor = (element) => {
      if (!(element instanceof HTMLElement)) return;
      element.setAttribute('spellcheck', 'false');
      element.setAttribute('autocorrect', 'off');
      element.setAttribute('autocapitalize', 'off');
    };

    document.addEventListener(
      'focusin',
      (event) => {
        const target = event.target;
        if (target instanceof Element && target.matches(EDITOR_SELECTOR)) {
          tuneEditor(target);
        }
      },
      true,
    );
  }

  if (!CONFIG.enableAnswerToc) return;

  class AnswerTocController {
    constructor(config) {
      this.config = config;

      this.host = null;
      this.shadow = null;
      this.launcher = null;
      this.panel = null;
      this.list = null;
      this.tocNav = null;
      this.conversationList = null;
      this.conversationNav = null;
      this.headingEmptyState = null;
      this.conversationEmptyState = null;
      this.countLabel = null;
      this.launcherCount = null;
      this.launcherMode = null;
      this.panelHeader = null;
      this.collapseButton = null;
      this.viewConversationButton = null;
      this.viewHeadingsButton = null;
      this.viewPromptsButton = null;
      this.viewConversationCount = null;
      this.viewHeadingsCount = null;
      this.viewPromptsCount = null;
      this.promptNav = null;
      this.promptLibrary = globalThis.__cgptUnifiedRuntimeV1?.promptLibrary || null;
      this.resizeHandles = [];

      this.currentAnswer = null;
      this.currentContentRoot = null;
      this.currentScrollRoot = null;
      this.headings = [];
      this.itemButtons = [];
      this.activeIndex = -1;

      this.conversationItems = [];
      this.conversationItemButtons = [];
      this.activeConversationIndex = -1;
      this.lastConversationSignature = '';
      this.officialNavContainer = null;
      this.conversationLabelCache = new Map();
      this.conversationCacheIdentityByIndex = new Map();
      this.conversationCacheIndexByIdentity = new Map();
      this.maxObservedOfficialLogicalIndex = -1;
      this.pendingConversationLogicalIndex = -1;
      this.pendingConversationUntil = 0;
      this.conversationJumpToken = 0;
      this.conversationJumpTimers = new Set();
      this.conversationJumpRevealElement = null;
      this.conversationJumpRevealTimer = 0;

      this.mainElement = null;
      this.mainObserver = null;
      this.answerObserver = null;
      this.headingTextObserver = null;

      this.frameId = 0;
      this.forceAnswerDetection = false;
      this.lastAnswerDetectionAt = 0;
      this.answerDetectionTimer = 0;
      this.lastScrollTop = 0;
      this.rebuildTimer = 0;
      this.conversationRebuildTimer = 0;
      this.rebindTimer = 0;
      this.healthTimer = 0;
      this.lastUrl = location.href;

      this.hoverExpandTimer = 0;
      this.hoverCollapseTimer = 0;
      this.launcherHovered = false;
      this.transientHoverOpen = false;

      /*
       * 悬浮展开时，面板右上角的“收起”按钮可能正好覆盖折叠启动器原位置。
       * 记录启动器矩形，才能把用户在原位置的第一次点击识别为“固定展开”，
       * 而不是误触面板里的收起按钮。
       */
      this.transientHoverOriginRect = null;
      this.suppressTransientOriginClick = false;
      this.suppressTransientOriginClickRect = null;
      this.suppressTransientOriginClickTimer = 0;

      this.dragState = null;
      this.dragFrameId = 0;
      this.pendingDragPoint = null;
      this.suppressNextLauncherClick = false;
      this.rootStyleBeforeDrag = null;

      this.resizeState = null;
      this.resizeFrameId = 0;
      this.pendingResizePoint = null;
      this.rootStyleBeforeResize = null;

      this.savedPosition = this.readPositionState();
      this.positionMode = this.savedPosition ? 'manual' : 'auto';
      this.savedSize = this.readSizeState();
      this.sizeMode = this.savedSize ? 'manual' : 'auto';
      this.collapsed = this.readCollapsedState();
      this.activeView = this.readViewState();

      this.onScroll = this.onScroll.bind(this);
      this.onResize = this.onResize.bind(this);
      this.onKeyDown = this.onKeyDown.bind(this);
      this.onVisibilityChange = this.onVisibilityChange.bind(this);
      this.onRouteSignal = this.onRouteSignal.bind(this);
      this.onMainMutations = this.onMainMutations.bind(this);
      this.onAnswerMutations = this.onAnswerMutations.bind(this);
      this.onLauncherPointerEnter = this.onLauncherPointerEnter.bind(this);
      this.onLauncherPointerLeave = this.onLauncherPointerLeave.bind(this);
      this.onPanelPointerEnter = this.onPanelPointerEnter.bind(this);
      this.onPanelPointerLeave = this.onPanelPointerLeave.bind(this);
      this.onPanelClickCapture = this.onPanelClickCapture.bind(this);
      this.onDocumentPointerDown = this.onDocumentPointerDown.bind(this);
      this.onDocumentClick = this.onDocumentClick.bind(this);
      this.onDragPointerMove = this.onDragPointerMove.bind(this);
      this.onDragPointerEnd = this.onDragPointerEnd.bind(this);
      this.onDragPointerCancel = this.onDragPointerCancel.bind(this);
      this.onResizePointerMove = this.onResizePointerMove.bind(this);
      this.onResizePointerEnd = this.onResizePointerEnd.bind(this);
      this.onResizePointerCancel = this.onResizePointerCancel.bind(this);
    }

    start() {
      if (!document.body) return;

      this.createUi();
      this.bindMainObserver();
      this.syncOfficialConversationNav();
      this.rebuildConversationToc();
      this.updateInlineEndOffset();
      this.syncVisibility();

      document.addEventListener('scroll', this.onScroll, {
        capture: true,
        passive: true,
      });
      window.addEventListener('resize', this.onResize, { passive: true });
      window.addEventListener('popstate', this.onRouteSignal, { passive: true });
      window.addEventListener('hashchange', this.onRouteSignal, { passive: true });
      document.addEventListener('keydown', this.onKeyDown, true);
      document.addEventListener('pointerdown', this.onDocumentPointerDown, true);
      document.addEventListener('click', this.onDocumentClick, true);
      document.addEventListener('visibilitychange', this.onVisibilityChange);

      if (window.navigation && typeof window.navigation.addEventListener === 'function') {
        window.navigation.addEventListener('navigatesuccess', this.onRouteSignal);
      }

      this.healthTimer = window.setInterval(() => {
        if (document.hidden) return;

        if (location.href !== this.lastUrl || !this.mainElement?.isConnected) {
          this.resetForNavigation();
          return;
        }

        this.syncOfficialConversationNav();
        this.refreshConversationTocIfNeeded();
      }, 1600);

      this.requestFrame(true);
    }
    createUi() {
      document.querySelector('#cgpt-answer-toc-host')?.remove();

      const clampUnit = (value, fallback) => {
        const number = Number(value);
        return Number.isFinite(number) ? Math.min(1, Math.max(0, number)) : fallback;
      };
      const panelOpacity = clampUnit(this.config.answerTocPanelOpacity, 0.72);
      const launcherOpacity = clampUnit(this.config.answerTocLauncherOpacity, 0.68);
      const panelOpacityPercent = `${Math.round(panelOpacity * 100)}%`;
      const launcherOpacityPercent = `${Math.round(launcherOpacity * 100)}%`;
      const backdropBlur = Math.max(0, Number(this.config.answerTocBackdropBlurPx) || 0);
      const minWidth = Math.max(160, Number(this.config.answerTocMinWidthPx) || 220);
      const minHeight = Math.max(120, Number(this.config.answerTocMinHeightPx) || 170);
      const conversationPreviewMaxLines = Math.max(
        0,
        Math.floor(Number(this.config.conversationTocPreviewMaxLines) || 0),
      );
      const conversationPreviewCss = conversationPreviewMaxLines > 0
        ? `display: -webkit-box;
            overflow: hidden;
            -webkit-box-orient: vertical;
            -webkit-line-clamp: ${conversationPreviewMaxLines};`
        : `display: block;
            overflow: visible;
            -webkit-box-orient: initial;
            -webkit-line-clamp: unset;`;
      const backdropFilterCss = backdropBlur > 0
        ? `-webkit-backdrop-filter: blur(${backdropBlur}px) saturate(118%);
            backdrop-filter: blur(${backdropBlur}px) saturate(118%);`
        : '';

      const host = document.createElement('div');
      host.id = 'cgpt-answer-toc-host';
      host.hidden = true;
      host.setAttribute('data-cgpt-answer-toc', '');
      host.dataset.dockSide = 'right';

      const shadow = host.attachShadow({ mode: 'open' });
      shadow.innerHTML = `
        <style>
          :host {
            all: initial;
            position: fixed !important;
            inset-inline-end: var(--cgpt-answer-toc-inline-end, 20px) !important;
            top: 50% !important;
            z-index: 30 !important;
            width: max-content !important;
            height: max-content !important;
            display: block !important;
            transform: translateY(-50%) !important;
            font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont,
              "Segoe UI", sans-serif !important;
            font-size: 13px !important;
            line-height: 1.4 !important;
            color: var(--text-primary, #161616) !important;
            color-scheme: light dark !important;
            direction: inherit !important;
            pointer-events: none !important;
          }

          :host([data-position-mode="manual"]) {
            inset-inline: auto !important;
            right: auto !important;
            bottom: auto !important;
            left: var(--cgpt-answer-toc-left, 8px) !important;
            top: var(--cgpt-answer-toc-top, 8px) !important;
            transform: none !important;
          }

          :host([hidden]) {
            display: none !important;
          }

          *, *::before, *::after {
            box-sizing: border-box;
          }

          button {
            font: inherit;
          }

          .launcher,
          .panel {
            pointer-events: auto;
            ${backdropFilterCss}
          }

          .launcher {
            display: inline-flex;
            min-width: 42px;
            height: 38px;
            align-items: center;
            justify-content: center;
            gap: 5px;
            padding: 0 9px;
            border: 1px solid var(--border-light, rgba(0, 0, 0, 0.14));
            border-radius: 12px;
            background: rgba(255, 255, 255, ${launcherOpacity});
            background: color-mix(
              in srgb,
              var(--main-surface-primary, var(--bg-primary, #ffffff)) ${launcherOpacityPercent},
              transparent
            );
            color: var(--text-secondary, #444444);
            box-shadow: 0 6px 22px rgba(0, 0, 0, 0.14);
            cursor: grab;
            touch-action: none;
            user-select: none;
          }

          .launcher:hover {
            background: rgba(244, 244, 244, ${launcherOpacity});
            background: color-mix(
              in srgb,
              var(--main-surface-secondary, var(--bg-secondary, #f4f4f4)) ${launcherOpacityPercent},
              transparent
            );
            color: var(--text-primary, #161616);
          }

          .launcher:focus-visible,
          .icon-button:focus-visible,
          .view-tab:focus-visible,
          .toc-item:focus-visible {
            outline: 2px solid var(--text-primary, #161616);
            outline-offset: 2px;
          }

          .launcher svg,
          .icon-button svg {
            width: 17px;
            height: 17px;
            flex: none;
          }

          .launcher-mode {
            min-width: 1em;
            color: var(--text-tertiary, #777777);
            font-size: 10px;
            font-weight: 600;
          }

          .launcher-count {
            min-width: 1.3em;
            text-align: center;
            font-size: 11px;
            font-variant-numeric: tabular-nums;
          }

          .panel {
            position: relative;
            width: min(var(--cgpt-answer-toc-width, 300px), calc(100vw - 16px));
            max-height: min(68vh, 660px, calc(100vh - 16px));
            display: flex;
            flex-direction: column;
            overflow: hidden;
            border: 1px solid var(--border-light, rgba(0, 0, 0, 0.14));
            border-radius: 14px;
            background: rgba(255, 255, 255, ${panelOpacity});
            background: color-mix(
              in srgb,
              var(--main-surface-primary, var(--bg-primary, #ffffff)) ${panelOpacityPercent},
              transparent
            );
            box-shadow: 0 10px 34px rgba(0, 0, 0, 0.16);
          }

          :host([data-size-mode="manual"]) .panel {
            width: var(--cgpt-answer-toc-width, 300px);
            height: var(--cgpt-answer-toc-height, 420px);
            min-width: ${minWidth}px;
            min-height: ${minHeight}px;
            max-width: calc(100vw - 16px);
            max-height: calc(100vh - 16px);
          }

          .panel[hidden],
          .launcher[hidden],
          .toc-nav[hidden],
          .empty-state[hidden] {
            display: none !important;
          }

          .panel-header {
            min-height: 42px;
            display: flex;
            flex: none;
            align-items: center;
            gap: 8px;
            padding-block: 7px;
            padding-inline-start: 9px;
            padding-inline-end: 24px;
            border-bottom: 1px solid var(--border-light, rgba(0, 0, 0, 0.11));
            cursor: grab;
            touch-action: none;
            user-select: none;
          }

          .drag-grip {
            width: 12px;
            height: 22px;
            display: grid;
            flex: none;
            grid-template-columns: repeat(2, 3px);
            grid-auto-rows: 3px;
            place-content: center;
            gap: 3px;
            color: var(--text-tertiary, #777777);
            opacity: 0.75;
          }

          .drag-grip::before,
          .drag-grip::after {
            width: 3px;
            height: 3px;
            border-radius: 50%;
            background: currentColor;
            box-shadow: 0 6px currentColor, 0 -6px currentColor;
            content: "";
          }

          :host([data-dragging]) .launcher,
          :host([data-dragging]) .panel-header {
            cursor: grabbing;
          }

          :host([data-resizing]) .panel {
            user-select: none;
          }

          .panel-title-wrap {
            min-width: 0;
            display: flex;
            flex: 1;
            align-items: baseline;
            gap: 7px;
          }

          .panel-title {
            overflow: hidden;
            color: var(--text-primary, #161616);
            font-weight: 600;
            text-overflow: ellipsis;
            white-space: nowrap;
          }

          .count-label {
            flex: none;
            color: var(--text-tertiary, #777777);
            font-size: 11px;
            font-variant-numeric: tabular-nums;
          }

          .icon-button {
            position: relative;
            z-index: 4;
            width: 29px;
            height: 29px;
            display: inline-flex;
            flex: none;
            align-items: center;
            justify-content: center;
            padding: 0;
            border: 0;
            border-radius: 8px;
            background: transparent;
            color: var(--text-secondary, #555555);
            cursor: pointer;
          }

          .icon-button:hover {
            background: var(--main-surface-secondary, var(--bg-secondary, #f1f1f1));
            color: var(--text-primary, #161616);
          }

          .view-tabs {
            display: grid;
            flex: none;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 4px;
            padding: 5px 6px;
            border-bottom: 1px solid var(--border-light, rgba(0, 0, 0, 0.09));
          }

          .view-tab {
            min-width: 0;
            min-height: 31px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
            padding: 5px 8px;
            border: 0;
            border-radius: 8px;
            background: transparent;
            color: var(--text-secondary, #4a4a4a);
            cursor: pointer;
          }

          .view-tab:hover {
            background: color-mix(
              in srgb,
              var(--main-surface-secondary, var(--bg-secondary, #f3f3f3)) 74%,
              transparent
            );
            color: var(--text-primary, #161616);
          }

          .view-tab[aria-selected="true"] {
            background: var(--main-surface-secondary, var(--bg-secondary, #ededed));
            color: var(--text-primary, #111111);
            font-weight: 600;
          }

          .view-count {
            min-width: 1.6em;
            padding: 1px 5px;
            border-radius: 999px;
            background: color-mix(in srgb, currentColor 10%, transparent);
            font-size: 10px;
            font-variant-numeric: tabular-nums;
            font-weight: 500;
          }

          .toc-nav {
            min-height: 0;
            flex: 1;
            overflow-y: auto;
            overscroll-behavior: contain;
            padding: 6px;
            scrollbar-width: thin;
          }

          .toc-list {
            display: flex;
            flex-direction: column;
            gap: 2px;
            margin: 0;
            padding: 0;
            list-style: none;
          }

          /* 长提问由目录区域滚动，不压缩单个条目的实际高度。 */
          .toc-list > li {
            min-width: 0;
            flex: 0 0 auto;
          }

          .toc-item {
            position: relative;
            width: 100%;
            min-height: 30px;
            display: flex;
            align-items: flex-start;
            gap: 7px;
            overflow: hidden;
            padding: 6px 9px 6px 11px;
            border: 0;
            border-radius: 8px;
            background: transparent;
            color: var(--text-secondary, #4a4a4a);
            text-align: start;
            cursor: pointer;
          }

          .toc-item::before {
            position: absolute;
            inset-block: 7px;
            inset-inline-start: 3px;
            width: 2px;
            border-radius: 2px;
            background: transparent;
            content: "";
          }

          .toc-item:hover {
            background: color-mix(
              in srgb,
              var(--main-surface-secondary, var(--bg-secondary, #f3f3f3)) 82%,
              transparent
            );
            color: var(--text-primary, #161616);
          }

          .toc-item[data-active="true"] {
            background: var(--main-surface-secondary, var(--bg-secondary, #ededed));
            color: var(--text-primary, #111111);
          }

          .toc-item[data-active="true"]::before {
            background: var(--text-primary, #111111);
          }

          .toc-item[data-level="1"] {
            font-weight: 600;
          }

          .toc-item[data-level="2"] {
            padding-inline-start: 25px;
            font-size: 12.5px;
          }

          .toc-item[data-level="3"],
          .toc-item[data-level="4"] {
            padding-inline-start: 38px;
            font-size: 12px;
          }

          .prompt-index {
            width: 2.4em;
            flex: none;
            padding-top: 1px;
            color: var(--text-tertiary, #777777);
            font-size: 10.5px;
            font-variant-numeric: tabular-nums;
            text-align: end;
          }

          .toc-item-label {
            min-width: 0;
            display: -webkit-box;
            flex: 1;
            overflow: hidden;
            -webkit-box-orient: vertical;
            -webkit-line-clamp: 2;
            overflow-wrap: anywhere;
          }

          /*
           * 问答级目录只在提问过长时按配置限制行数和字符数；
           * 完整文本仍写入按钮 title。章节标题继续保持两行预览。
           */
          #conversation-list .toc-item {
            height: auto;
            flex: 0 0 auto;
          }

          #conversation-list .toc-item-label {
            ${conversationPreviewCss}
            max-height: none;
            text-overflow: clip;
            white-space: pre-wrap;
            word-break: break-word;
          }

          .empty-state {
            margin: 6px;
            padding: 18px 12px;
            border: 1px dashed var(--border-light, rgba(0, 0, 0, 0.14));
            border-radius: 10px;
            color: var(--text-tertiary, #777777);
            text-align: center;
            font-size: 12px;
          }

          /*
           * 四个角仍可缩放，但命中区域完全透明，不绘制任何角标。
           * 鼠标进入角落命中区时，仅通过系统 resize 光标提示该功能。
           */
          .resize-handle {
            position: absolute;
            z-index: 3;
            width: 18px;
            height: 18px;
            display: block;
            border: 0;
            background: transparent;
            opacity: 0;
            pointer-events: auto;
            touch-action: none;
            user-select: none;
          }

          .resize-handle::before,
          .resize-handle::after {
            display: none !important;
            content: none !important;
          }

          .resize-handle[data-resize-corner="top-left"] {
            top: 0;
            left: 0;
            cursor: nwse-resize;
          }

          .resize-handle[data-resize-corner="top-right"] {
            top: 0;
            right: 0;
            cursor: nesw-resize;
          }

          .resize-handle[data-resize-corner="bottom-left"] {
            bottom: 0;
            left: 0;
            cursor: nesw-resize;
          }

          .resize-handle[data-resize-corner="bottom-right"] {
            right: 0;
            bottom: 0;
            cursor: nwse-resize;
          }

          @media (prefers-color-scheme: dark) {
            .launcher {
              border-color: rgba(255, 255, 255, 0.14);
              background: rgba(33, 33, 33, ${launcherOpacity});
              background: color-mix(
                in srgb,
                var(--main-surface-primary, var(--bg-primary, #212121)) ${launcherOpacityPercent},
                transparent
              );
              box-shadow: 0 8px 28px rgba(0, 0, 0, 0.42);
            }

            .panel {
              border-color: rgba(255, 255, 255, 0.14);
              background: rgba(33, 33, 33, ${panelOpacity});
              background: color-mix(
                in srgb,
                var(--main-surface-primary, var(--bg-primary, #212121)) ${panelOpacityPercent},
                transparent
              );
              box-shadow: 0 8px 28px rgba(0, 0, 0, 0.42);
            }

            .panel-header,
            .view-tabs {
              border-bottom-color: rgba(255, 255, 255, 0.11);
            }
          }

          @media (prefers-reduced-motion: reduce) {
            *, *::before, *::after {
              scroll-behavior: auto !important;
              transition: none !important;
            }
          }
        </style>

        <button
          id="launcher"
          class="launcher"
          type="button"
          aria-label="展开导航目录"
          aria-expanded="false"
          title="悬停临时展开；在目录中点击、拖动或缩放后保持展开（Alt+Shift+O）"
          hidden
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5 6h14M5 12h14M5 18h14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
          </svg>
          <span id="launcher-mode" class="launcher-mode">章</span>
          <span id="launcher-count" class="launcher-count">0</span>
        </button>

        <aside id="panel" class="panel" aria-label="ChatGPT 导航目录" hidden>
          <div class="panel-header" title="拖动标题栏可移动目录">
            <span class="drag-grip" aria-hidden="true"></span>
            <div class="panel-title-wrap">
              <span class="panel-title">导航目录</span>
              <span id="count-label" class="count-label">0 节</span>
            </div>
            <button
              id="collapse-button"
              class="icon-button"
              type="button"
              aria-label="收起导航目录"
              title="收起目录（Alt+Shift+O）"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="m9 6 6 6-6 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>
          </div>

          <div class="view-tabs" role="tablist" aria-label="目录层级">
            <button id="view-conversation" class="view-tab" type="button" role="tab" data-view="conversation" aria-selected="false">
              <span>问答</span><span id="view-conversation-count" class="view-count">0</span>
            </button>
            <button id="view-headings" class="view-tab" type="button" role="tab" data-view="headings" aria-selected="true">
              <span>章节</span><span id="view-headings-count" class="view-count">0</span>
            </button>
            <button id="view-prompts" class="view-tab" type="button" role="tab" data-view="prompts" aria-selected="false">
              <span>提示词</span><span id="view-prompts-count" class="view-count">0</span>
            </button>
          </div>

          <nav id="conversation-nav" class="toc-nav" aria-label="对话问答导航" hidden>
            <div id="conversation-empty" class="empty-state" hidden>暂未找到可跳转的提问</div>
            <ol id="conversation-list" class="toc-list"></ol>
          </nav>

          <nav id="heading-nav" class="toc-nav" aria-label="当前回答章节">
            <div id="heading-empty" class="empty-state" hidden>当前回答没有可导航的标题或段落</div>
            <ol id="toc-list" class="toc-list"></ol>
          </nav>

          <section id="prompt-nav" class="prompt-view" aria-label="提示词与会话导出" hidden></section>

          <span class="resize-handle" aria-hidden="true" data-resize-corner="top-left"></span>
          <span class="resize-handle" aria-hidden="true" data-resize-corner="top-right"></span>
          <span class="resize-handle" aria-hidden="true" data-resize-corner="bottom-left"></span>
          <span class="resize-handle" aria-hidden="true" data-resize-corner="bottom-right"></span>
        </aside>
      `;

      document.body.appendChild(host);

      this.host = host;
      this.shadow = shadow;
      this.launcher = shadow.getElementById('launcher');
      this.panel = shadow.getElementById('panel');
      this.list = shadow.getElementById('toc-list');
      this.tocNav = shadow.getElementById('heading-nav');
      this.conversationList = shadow.getElementById('conversation-list');
      this.conversationNav = shadow.getElementById('conversation-nav');
      this.headingEmptyState = shadow.getElementById('heading-empty');
      this.conversationEmptyState = shadow.getElementById('conversation-empty');
      this.countLabel = shadow.getElementById('count-label');
      this.launcherCount = shadow.getElementById('launcher-count');
      this.launcherMode = shadow.getElementById('launcher-mode');
      this.panelHeader = shadow.querySelector('.panel-header');
      this.collapseButton = shadow.getElementById('collapse-button');
      this.viewConversationButton = shadow.getElementById('view-conversation');
      this.viewHeadingsButton = shadow.getElementById('view-headings');
      this.viewPromptsButton = shadow.getElementById('view-prompts');
      this.viewConversationCount = shadow.getElementById('view-conversation-count');
      this.viewHeadingsCount = shadow.getElementById('view-headings-count');
      this.viewPromptsCount = shadow.getElementById('view-prompts-count');
      this.promptNav = shadow.getElementById('prompt-nav');
      this.resizeHandles = Array.from(
        shadow.querySelectorAll('[data-resize-corner]'),
      );
      this.promptLibrary?.mount({
        shadow,
        nav: this.promptNav,
        onCountChange: () => this.updateViewMeta(),
      });

      host.dataset.positionMode = this.positionMode;
      host.dataset.sizeMode = this.sizeMode;
      if (this.savedPosition) {
        this.setManualPosition(
          this.savedPosition.left,
          this.savedPosition.top,
          false,
        );
      }
      if (this.savedSize) {
        this.setPanelSize(this.savedSize.width, this.savedSize.height, false);
      }

      this.launcher.addEventListener('pointerenter', this.onLauncherPointerEnter);
      this.launcher.addEventListener('pointerleave', this.onLauncherPointerLeave);
      this.launcher.addEventListener('pointerdown', (event) => {
        this.beginDrag(event, 'launcher');
      });
      this.launcher.addEventListener('click', (event) => {
        if (this.suppressNextLauncherClick) {
          event.preventDefault();
          event.stopImmediatePropagation();
          this.suppressNextLauncherClick = false;
          return;
        }
        this.setCollapsed(false, { source: 'click', persist: true });
      });

      this.panel.addEventListener('pointerenter', this.onPanelPointerEnter);
      this.panel.addEventListener('pointerleave', this.onPanelPointerLeave);
      this.panel.addEventListener('click', this.onPanelClickCapture, true);

      this.panelHeader?.addEventListener('pointerdown', (event) => {
        const target = event.target;
        if (target instanceof Element && target.closest('button, a, input, textarea, select')) {
          return;
        }
        this.beginDrag(event, 'panel');
      });

      this.collapseButton?.addEventListener('click', () => {
        this.setCollapsed(true, { source: 'click', persist: true });
      });

      this.viewConversationButton?.addEventListener('click', () => {
        this.setActiveView('conversation', true);
      });
      this.viewHeadingsButton?.addEventListener('click', () => {
        this.setActiveView('headings', true);
      });
      this.viewPromptsButton?.addEventListener('click', () => {
        this.setActiveView('prompts', true);
      });

      this.list.addEventListener('click', (event) => {
        const button = event.target instanceof Element
          ? event.target.closest('button[data-heading-index]')
          : null;
        if (!(button instanceof HTMLButtonElement)) return;

        const index = Number.parseInt(button.dataset.headingIndex ?? '', 10);
        if (Number.isInteger(index)) this.jumpToHeading(index);
      });

      this.conversationList.addEventListener('click', (event) => {
        const button = event.target instanceof Element
          ? event.target.closest('button[data-conversation-index]')
          : null;
        if (!(button instanceof HTMLButtonElement)) return;

        const index = Number.parseInt(button.dataset.conversationIndex ?? '', 10);
        if (Number.isInteger(index)) this.jumpToConversation(index);
      });

      for (const handle of this.resizeHandles) {
        handle.addEventListener('pointerdown', (event) => {
          this.beginResize(event, handle.dataset.resizeCorner);
        });
      }

      this.applyActiveView();
      this.applyCollapsedState();
      this.updateViewMeta();
    }

    readPositionState() {
      if (!this.config.answerTocRememberPosition) return null;

      try {
        const raw = localStorage.getItem('cgpt-answer-toc-position-v1');
        if (!raw) return null;

        const parsed = JSON.parse(raw);
        const left = Number(parsed?.left);
        const top = Number(parsed?.top);
        if (Number.isFinite(left) && Number.isFinite(top)) return { left, top };
      } catch {
        // 忽略存储不可用或旧数据损坏的情况。
      }

      return null;
    }

    writePositionState() {
      if (!this.config.answerTocRememberPosition || this.positionMode !== 'manual') {
        return;
      }

      const left = Number.parseFloat(
        this.host?.style.getPropertyValue('--cgpt-answer-toc-left') ?? '',
      );
      const top = Number.parseFloat(
        this.host?.style.getPropertyValue('--cgpt-answer-toc-top') ?? '',
      );
      if (!Number.isFinite(left) || !Number.isFinite(top)) return;

      try {
        localStorage.setItem(
          'cgpt-answer-toc-position-v1',
          JSON.stringify({ left, top }),
        );
      } catch {
        // 忽略严格隐私模式下的存储错误。
      }
    }

    setManualPosition(left, top, persist = false) {
      if (!this.host || !Number.isFinite(left) || !Number.isFinite(top)) return;

      this.positionMode = 'manual';
      this.host.dataset.positionMode = 'manual';
      this.host.style.setProperty('--cgpt-answer-toc-left', `${left}px`);
      this.host.style.setProperty('--cgpt-answer-toc-top', `${top}px`);
      if (persist) this.writePositionState();
    }

    readSizeState() {
      if (!this.config.answerTocRememberSize) return null;

      try {
        const raw = localStorage.getItem('cgpt-answer-toc-size-v1');
        if (!raw) return null;

        const parsed = JSON.parse(raw);
        const width = Number(parsed?.width);
        const height = Number(parsed?.height);
        if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
          return { width, height };
        }
      } catch {
        // 忽略存储不可用或旧数据损坏的情况。
      }

      return null;
    }

    getPanelSizeLimits() {
      const margin = Math.max(0, Number(this.config.answerTocDragViewportMarginPx) || 0);
      const viewportWidth = Math.max(1, document.documentElement.clientWidth);
      const viewportHeight = Math.max(1, document.documentElement.clientHeight);
      const configuredMinWidth = Math.max(160, Number(this.config.answerTocMinWidthPx) || 220);
      const configuredMaxWidth = Math.max(
        configuredMinWidth,
        Number(this.config.answerTocMaxWidthPx) || 560,
      );
      const configuredMinHeight = Math.max(120, Number(this.config.answerTocMinHeightPx) || 170);
      const configuredMaxHeight = Math.max(
        configuredMinHeight,
        Number(this.config.answerTocMaxHeightPx) || 760,
      );
      const maxWidth = Math.max(1, Math.min(configuredMaxWidth, viewportWidth - margin * 2));
      const maxHeight = Math.max(1, Math.min(configuredMaxHeight, viewportHeight - margin * 2));

      return {
        minWidth: Math.min(configuredMinWidth, maxWidth),
        maxWidth,
        minHeight: Math.min(configuredMinHeight, maxHeight),
        maxHeight,
      };
    }

    setPanelSize(width, height, persist = false) {
      if (!this.host || !Number.isFinite(width) || !Number.isFinite(height)) return null;

      const limits = this.getPanelSizeLimits();
      const nextWidth = Math.round(
        Math.min(limits.maxWidth, Math.max(limits.minWidth, width)),
      );
      const nextHeight = Math.round(
        Math.min(limits.maxHeight, Math.max(limits.minHeight, height)),
      );

      this.savedSize = { width: nextWidth, height: nextHeight };
      this.sizeMode = 'manual';
      this.host.dataset.sizeMode = 'manual';
      this.host.style.setProperty('--cgpt-answer-toc-width', `${nextWidth}px`);
      this.host.style.setProperty('--cgpt-answer-toc-height', `${nextHeight}px`);

      if (persist) this.writeSizeState();
      return this.savedSize;
    }

    writeSizeState() {
      if (!this.config.answerTocRememberSize || !this.savedSize) return;

      try {
        localStorage.setItem(
          'cgpt-answer-toc-size-v1',
          JSON.stringify(this.savedSize),
        );
      } catch {
        // 忽略严格隐私模式下的存储错误。
      }
    }

    ensurePanelSizeInViewport(persist = false) {
      if (this.sizeMode !== 'manual' || !this.savedSize) return;

      const anchor = !this.collapsed ? this.captureWidgetEdgeAnchor() : null;
      const previous = this.savedSize;
      const next = this.setPanelSize(previous.width, previous.height, false);
      const changed = next && (
        next.width !== previous.width || next.height !== previous.height
      );

      if (anchor) this.alignManualWidgetToEdgeAnchor(anchor, false);
      if (persist && changed) this.writeSizeState();
    }

    readViewState() {
      const fallback = this.config.answerTocInitialView === 'conversation'
        ? 'conversation'
        : 'headings';
      if (!this.config.answerTocRememberView) return fallback;

      try {
        const stored = localStorage.getItem('cgpt-answer-toc-view-v1');
        if (stored === 'conversation' || stored === 'headings' || stored === 'prompts') return stored;
      } catch {
        // 忽略存储不可用的情况。
      }

      return fallback;
    }

    writeViewState() {
      if (!this.config.answerTocRememberView) return;

      try {
        localStorage.setItem('cgpt-answer-toc-view-v1', this.activeView);
      } catch {
        // 忽略存储不可用的情况。
      }
    }

    setActiveView(view, persist = true) {
      const nextView = view === 'conversation' || view === 'prompts' ? view : 'headings';
      if (nextView === this.activeView) {
        this.applyActiveView();
        return;
      }

      this.activeView = nextView;
      if (persist) this.writeViewState();
      this.applyActiveView();
      this.updateViewMeta();

      window.requestAnimationFrame(() => {
        if (this.activeView === 'conversation') {
          const current = this.conversationItemButtons[this.activeConversationIndex];
          if (current) this.scrollItemIntoView(this.conversationNav, current);
        } else if (this.activeView === 'headings') {
          const current = this.itemButtons[this.activeIndex];
          if (current) this.scrollItemIntoView(this.tocNav, current);
        }
      });
    }

    applyActiveView() {
      if (!this.conversationNav || !this.tocNav || !this.promptNav) return;

      const conversationActive = this.activeView === 'conversation';
      const headingsActive = this.activeView === 'headings';
      const promptsActive = this.activeView === 'prompts';
      this.conversationNav.hidden = !conversationActive;
      this.tocNav.hidden = !headingsActive;
      this.promptNav.hidden = !promptsActive;
      this.viewConversationButton?.setAttribute('aria-selected', String(conversationActive));
      this.viewHeadingsButton?.setAttribute('aria-selected', String(headingsActive));
      this.viewPromptsButton?.setAttribute('aria-selected', String(promptsActive));
      this.viewConversationButton?.setAttribute('tabindex', conversationActive ? '0' : '-1');
      this.viewHeadingsButton?.setAttribute('tabindex', headingsActive ? '0' : '-1');
      this.viewPromptsButton?.setAttribute('tabindex', promptsActive ? '0' : '-1');
    }

    updateViewMeta() {
      const conversationCount = this.conversationItems.length;
      const headingCount = this.headings.length;
      const promptCount = this.promptLibrary?.count || 0;
      const conversationActive = this.activeView === 'conversation';
      const promptsActive = this.activeView === 'prompts';
      const activeCount = conversationActive ? conversationCount : promptsActive ? promptCount : headingCount;

      if (this.viewConversationCount) {
        this.viewConversationCount.textContent = String(conversationCount);
      }
      if (this.viewHeadingsCount) {
        this.viewHeadingsCount.textContent = String(headingCount);
      }
      if (this.viewPromptsCount) {
        this.viewPromptsCount.textContent = String(promptCount);
      }
      if (this.countLabel) {
        this.countLabel.textContent = conversationActive
          ? `${conversationCount} 问`
          : promptsActive ? `${promptCount} 条提示词` : `${headingCount} 节`;
      }
      if (this.launcherMode) {
        this.launcherMode.textContent = conversationActive ? '问' : promptsActive ? '词' : '章';
      }
      if (this.launcherCount) {
        this.launcherCount.textContent = String(activeCount);
      }
      if (this.launcher) {
        this.launcher.title = `悬停临时展开；在目录中点击、拖动或缩放后保持展开；问答 ${conversationCount}，章节 ${headingCount}，提示词 ${promptCount}`;
      }
      if (this.conversationEmptyState) {
        this.conversationEmptyState.hidden = conversationCount > 0;
      }
      if (this.headingEmptyState) {
        this.headingEmptyState.hidden = headingCount > 0;
      }
    }

    getVisibleWidget() {
      if (!this.launcher || !this.panel) return null;
      return this.collapsed ? this.launcher : this.panel;
    }

    getWidgetDockSide(rect) {
      const viewportWidth = Math.max(1, document.documentElement.clientWidth);
      const centerX = rect.left + rect.width / 2;
      return centerX <= viewportWidth / 2 ? 'left' : 'right';
    }

    captureWidgetEdgeAnchor() {
      if (this.positionMode !== 'manual') return null;

      const widget = this.getVisibleWidget();
      if (!(widget instanceof HTMLElement) || widget.hidden) return null;

      const rect = widget.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return null;

      const side = this.getWidgetDockSide(rect);
      if (this.host) this.host.dataset.dockSide = side;
      return {
        side,
        left: rect.left,
        right: rect.right,
        top: rect.top,
      };
    }

    alignManualWidgetToEdgeAnchor(anchor, persist = false) {
      if (!anchor || this.positionMode !== 'manual' || !this.host || this.host.hidden) {
        return;
      }

      const widget = this.getVisibleWidget();
      if (!(widget instanceof HTMLElement) || widget.hidden) return;

      const rect = widget.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;

      const desiredLeft = anchor.side === 'right'
        ? anchor.right - rect.width
        : anchor.left;
      const clamped = this.clampPosition(
        desiredLeft,
        anchor.top,
        rect.width,
        rect.height,
      );

      this.host.dataset.dockSide = anchor.side;
      this.setManualPosition(clamped.left, clamped.top, persist);
    }

    readCollapsedState() {
      if (!this.config.answerTocRememberCollapsedState) {
        return this.config.answerTocInitiallyCollapsed;
      }

      try {
        const stored = localStorage.getItem('cgpt-answer-toc-collapsed');
        if (stored === '1') return true;
        if (stored === '0') return false;
      } catch {
        // 某些严格隐私模式可能阻止 localStorage。
      }

      return this.config.answerTocInitiallyCollapsed;
    }

    writeCollapsedState() {
      if (!this.config.answerTocRememberCollapsedState) return;

      try {
        localStorage.setItem('cgpt-answer-toc-collapsed', this.collapsed ? '1' : '0');
      } catch {
        // 忽略存储不可用的情况。
      }
    }

    cancelHoverExpand() {
      window.clearTimeout(this.hoverExpandTimer);
      this.hoverExpandTimer = 0;
    }

    cancelHoverCollapse() {
      window.clearTimeout(this.hoverCollapseTimer);
      this.hoverCollapseTimer = 0;
    }

    captureHoverOriginRect() {
      if (!(this.launcher instanceof HTMLElement) || this.launcher.hidden) return null;
      const rect = this.launcher.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return null;
      return {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
      };
    }

    isPointInsideRect(clientX, clientY, rect, tolerance = 0) {
      return Boolean(
        rect &&
        Number.isFinite(clientX) &&
        Number.isFinite(clientY) &&
        clientX >= rect.left - tolerance &&
        clientX <= rect.right + tolerance &&
        clientY >= rect.top - tolerance &&
        clientY <= rect.bottom + tolerance
      );
    }

    clearTransientOriginClickSuppression() {
      window.clearTimeout(this.suppressTransientOriginClickTimer);
      this.suppressTransientOriginClickTimer = 0;
      this.suppressTransientOriginClick = false;
      this.suppressTransientOriginClickRect = null;
    }

    armTransientOriginClickSuppression(rect) {
      this.clearTransientOriginClickSuppression();
      this.suppressTransientOriginClick = true;
      this.suppressTransientOriginClickRect = rect ? { ...rect } : null;
      this.suppressTransientOriginClickTimer = window.setTimeout(() => {
        this.clearTransientOriginClickSuppression();
      }, 900);
    }

    onDocumentPointerDown(event) {
      if (!this.transientHoverOpen || this.collapsed) return;
      if (
        event instanceof PointerEvent &&
        (event.button !== 0 || event.isPrimary === false)
      ) {
        return;
      }

      const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
      const insidePanel = Boolean(this.host && path.includes(this.host));
      const insideOrigin = this.isPointInsideRect(
        event.clientX,
        event.clientY,
        this.transientHoverOriginRect,
        3,
      );

      if (!insidePanel && !insideOrigin) return;

      if (insideOrigin) {
        /*
         * 面板展开后，原启动器位置通常会被“收起”按钮覆盖。抑制这一次
         * 随后的 click，避免用户本想点击展开，却立即触发收起。
         */
        this.armTransientOriginClickSuppression(this.transientHoverOriginRect);
      }

      // pointerdown 早于 click：先把临时悬浮状态提升为持久展开。
      this.pinTransientHoverOpen(true);
    }

    onDocumentClick(event) {
      if (!this.suppressTransientOriginClick) return;

      const shouldSuppress = this.isPointInsideRect(
        event.clientX,
        event.clientY,
        this.suppressTransientOriginClickRect,
        5,
      );
      this.clearTransientOriginClickSuppression();
      if (!shouldSuppress) return;

      event.preventDefault();
      event.stopPropagation();
    }

    scheduleHoverCollapse() {
      this.cancelHoverCollapse();
      if (
        !this.transientHoverOpen ||
        this.collapsed ||
        this.dragState ||
        this.resizeState
      ) {
        return;
      }

      const delay = Math.max(
        0,
        Number(this.config.answerTocHoverCollapseDelayMs) || 0,
      );
      this.hoverCollapseTimer = window.setTimeout(() => {
        this.hoverCollapseTimer = 0;
        if (
          this.transientHoverOpen &&
          !this.collapsed &&
          !this.dragState &&
          !this.resizeState &&
          !this.panel?.matches(':hover')
        ) {
          this.setCollapsed(true, { source: 'hover-leave', persist: false });
        }
      }, delay);
    }

    onLauncherPointerEnter(event) {
      this.launcherHovered = true;
      this.cancelHoverCollapse();
      if (
        !this.collapsed ||
        this.dragState ||
        this.resizeState ||
        (event.pointerType && event.pointerType !== 'mouse')
      ) {
        return;
      }

      this.cancelHoverExpand();
      const delay = Math.max(0, Number(this.config.answerTocHoverExpandDelayMs) || 0);
      this.hoverExpandTimer = window.setTimeout(() => {
        this.hoverExpandTimer = 0;
        if (this.collapsed && this.launcherHovered && !this.dragState && !this.resizeState) {
          this.transientHoverOriginRect = this.captureHoverOriginRect();
          this.setCollapsed(false, { source: 'hover', persist: false });
          window.requestAnimationFrame(() => {
            if (this.transientHoverOpen && !this.panel?.matches(':hover')) {
              this.scheduleHoverCollapse();
            }
          });
        }
      }, delay);
    }

    onLauncherPointerLeave() {
      this.launcherHovered = false;
      this.cancelHoverExpand();
    }

    onPanelPointerEnter() {
      this.cancelHoverCollapse();
    }

    onPanelPointerLeave(event) {
      const related = event.relatedTarget;
      if (
        related instanceof Node &&
        (this.panel?.contains(related) || this.launcher?.contains(related))
      ) {
        return;
      }
      this.scheduleHoverCollapse();
    }

    /*
     * 悬浮展开只有在“纯浏览、无交互”时才会自动收起。
     * 一旦用户点击、拖动或缩放目录，就将本次展开提升为持久展开。
     */
    pinTransientHoverOpen(persist = true) {
      if (!this.transientHoverOpen || this.collapsed) return false;

      this.transientHoverOpen = false;
      this.cancelHoverCollapse();
      this.transientHoverOriginRect = null;
      if (persist) this.writeCollapsedState();
      return true;
    }

    onPanelClickCapture(event) {
      const target = event.target;

      // “收起”按钮是明确的折叠意图，不先把状态提升为持久展开。
      if (target instanceof Element && target.closest('#collapse-button')) return;
      this.pinTransientHoverOpen(true);
    }

    setCollapsed(collapsed, options = {}) {
      const nextCollapsed = Boolean(collapsed);
      const source = options.source || 'manual';
      const persist = options.persist !== false;

      this.cancelHoverExpand();
      this.cancelHoverCollapse();

      if (!nextCollapsed && source === 'hover') {
        this.transientHoverOpen = true;
      } else if (source !== 'layout') {
        this.transientHoverOpen = false;
        this.transientHoverOriginRect = null;
      }

      if (nextCollapsed === this.collapsed) {
        /*
         * 悬浮已经把面板打开后，后续点击的视觉状态仍是“展开”。这里不能
         * 因状态相同而丢弃点击语义，必须写入持久展开状态。
         */
        if (persist) this.writeCollapsedState();
        this.applyCollapsedState();
        return;
      }

      const edgeAnchor = this.captureWidgetEdgeAnchor();
      this.collapsed = nextCollapsed;
      if (persist) this.writeCollapsedState();
      this.applyCollapsedState();

      if (edgeAnchor) this.alignManualWidgetToEdgeAnchor(edgeAnchor, false);

      window.requestAnimationFrame(() => {
        if (edgeAnchor) {
          this.alignManualWidgetToEdgeAnchor(edgeAnchor, true);
        } else {
          this.ensureManualPositionInViewport(true);
        }

        if (!this.collapsed) {
          this.ensurePanelSizeInViewport(false);
          const current = this.activeView === 'conversation'
            ? this.conversationItemButtons[this.activeConversationIndex]
            : this.itemButtons[this.activeIndex];
          const nav = this.activeView === 'conversation'
            ? this.conversationNav
            : this.tocNav;
          if (current) this.scrollItemIntoView(nav, current);

          if (this.transientHoverOpen && !this.panel?.matches(':hover')) {
            this.scheduleHoverCollapse();
          }
        }
      });
    }

    applyCollapsedState() {
      if (!this.launcher || !this.panel) return;

      this.launcher.hidden = !this.collapsed;
      this.panel.hidden = this.collapsed;
      this.launcher.setAttribute('aria-expanded', String(!this.collapsed));
    }

    beginDrag(event, source) {
      if (
        !(event instanceof PointerEvent) ||
        event.button !== 0 ||
        event.isPrimary === false ||
        this.dragState ||
        this.resizeState ||
        !this.host
      ) {
        return;
      }

      const widget = this.getVisibleWidget();
      if (!(widget instanceof HTMLElement) || widget.hidden) return;

      if (source === 'panel') this.pinTransientHoverOpen(true);
      this.cancelHoverExpand();
      this.cancelHoverCollapse();
      event.preventDefault();

      const rect = widget.getBoundingClientRect();
      this.dragState = {
        pointerId: event.pointerId,
        source,
        captureTarget: event.currentTarget instanceof Element
          ? event.currentTarget
          : null,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startLeft: rect.left,
        startTop: rect.top,
        width: rect.width,
        height: rect.height,
        moved: false,
      };

      this.rootStyleBeforeDrag = {
        userSelect: document.documentElement.style.userSelect,
        cursor: document.documentElement.style.cursor,
      };
      document.documentElement.style.userSelect = 'none';
      document.documentElement.style.cursor = 'grabbing';

      try {
        this.dragState.captureTarget?.setPointerCapture?.(event.pointerId);
      } catch {
        // window 级监听仍可完成拖动。
      }

      window.addEventListener('pointermove', this.onDragPointerMove, {
        capture: true,
        passive: false,
      });
      window.addEventListener('pointerup', this.onDragPointerEnd, true);
      window.addEventListener('pointercancel', this.onDragPointerCancel, true);
    }

    onDragPointerMove(event) {
      const state = this.dragState;
      if (!state || event.pointerId !== state.pointerId) return;

      event.preventDefault();
      const deltaX = event.clientX - state.startClientX;
      const deltaY = event.clientY - state.startClientY;

      if (!state.moved) {
        if (Math.hypot(deltaX, deltaY) < 4) return;
        state.moved = true;
        this.host?.setAttribute('data-dragging', '');
        this.setManualPosition(state.startLeft, state.startTop, false);
      }

      this.pendingDragPoint = {
        clientX: event.clientX,
        clientY: event.clientY,
      };

      if (this.dragFrameId) return;
      this.dragFrameId = window.requestAnimationFrame(() => {
        this.dragFrameId = 0;
        const point = this.pendingDragPoint;
        this.pendingDragPoint = null;
        if (point) this.applyDragPoint(point.clientX, point.clientY);
      });
    }

    applyDragPoint(clientX, clientY) {
      const state = this.dragState;
      if (!state?.moved) return;

      const left = state.startLeft + clientX - state.startClientX;
      const top = state.startTop + clientY - state.startClientY;
      const clamped = this.clampPosition(left, top, state.width, state.height);
      this.setManualPosition(clamped.left, clamped.top, false);
    }

    onDragPointerEnd(event) {
      this.finishDrag(event, false);
    }

    onDragPointerCancel(event) {
      this.finishDrag(event, true);
    }

    finishDrag(event, cancelled) {
      const state = this.dragState;
      if (!state || event.pointerId !== state.pointerId) return;

      if (this.dragFrameId) {
        window.cancelAnimationFrame(this.dragFrameId);
        this.dragFrameId = 0;
      }

      const point = this.pendingDragPoint;
      this.pendingDragPoint = null;
      if (point && state.moved) this.applyDragPoint(point.clientX, point.clientY);

      try {
        state.captureTarget?.releasePointerCapture?.(state.pointerId);
      } catch {
        // 忽略 pointer capture 已释放的情况。
      }

      window.removeEventListener('pointermove', this.onDragPointerMove, true);
      window.removeEventListener('pointerup', this.onDragPointerEnd, true);
      window.removeEventListener('pointercancel', this.onDragPointerCancel, true);

      this.host?.removeAttribute('data-dragging');
      if (this.rootStyleBeforeDrag) {
        document.documentElement.style.userSelect = this.rootStyleBeforeDrag.userSelect;
        document.documentElement.style.cursor = this.rootStyleBeforeDrag.cursor;
      }
      this.rootStyleBeforeDrag = null;
      this.dragState = null;

      const launcherActivation =
        state.source === 'launcher' &&
        !state.moved &&
        !cancelled;

      if (launcherActivation) {
        /*
         * launcher 的 pointerdown 同时承担拖动起点，并调用了 preventDefault。
         * 某些 Chromium/React 组合不会再派发可靠的 click；在 pointerup 这里
         * 直接按“点击展开”处理，且明确退出 hover 临时展开状态。
         */
        this.suppressNextLauncherClick = true;
        this.setCollapsed(false, { source: 'click', persist: true });
        window.setTimeout(() => {
          this.suppressNextLauncherClick = false;
        }, 0);
        return;
      }

      if (state.moved && !cancelled) {
        this.ensureManualPositionInViewport(true);

        if (state.source === 'launcher') {
          this.suppressNextLauncherClick = true;
          window.setTimeout(() => {
            this.suppressNextLauncherClick = false;
          }, 0);
        }
      }

      this.resumeTransientAutoCollapse(event.clientX, event.clientY);
    }

    beginResize(event, handleCorner) {
      if (
        !(event instanceof PointerEvent) ||
        event.button !== 0 ||
        event.isPrimary === false ||
        this.resizeState ||
        this.dragState ||
        this.collapsed ||
        !this.host ||
        !this.panel
      ) {
        return;
      }

      const allowedCorners = new Set([
        'top-left',
        'top-right',
        'bottom-left',
        'bottom-right',
      ]);
      const corner = allowedCorners.has(handleCorner)
        ? handleCorner
        : 'bottom-right';
      const [verticalSide, horizontalSide] = corner.split('-');
      const rect = this.panel.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;

      // 缩放属于明确交互：若面板由 hover 临时展开，则从此保持展开。
      this.pinTransientHoverOpen(true);
      this.cancelHoverExpand();
      this.cancelHoverCollapse();
      event.preventDefault();
      event.stopPropagation();

      this.resizeState = {
        pointerId: event.pointerId,
        captureTarget: event.currentTarget instanceof Element
          ? event.currentTarget
          : null,
        corner,
        horizontalSide,
        verticalSide,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startWidth: rect.width,
        startHeight: rect.height,
        startLeft: rect.left,
        startRight: rect.right,
        startTop: rect.top,
        startBottom: rect.bottom,
        moved: false,
      };

      this.rootStyleBeforeResize = {
        userSelect: document.documentElement.style.userSelect,
        cursor: document.documentElement.style.cursor,
      };
      document.documentElement.style.userSelect = 'none';
      document.documentElement.style.cursor = (
        corner === 'top-left' || corner === 'bottom-right'
      ) ? 'nwse-resize' : 'nesw-resize';

      try {
        this.resizeState.captureTarget?.setPointerCapture?.(event.pointerId);
      } catch {
        // window 级监听仍可完成缩放。
      }

      window.addEventListener('pointermove', this.onResizePointerMove, {
        capture: true,
        passive: false,
      });
      window.addEventListener('pointerup', this.onResizePointerEnd, true);
      window.addEventListener('pointercancel', this.onResizePointerCancel, true);
    }

    onResizePointerMove(event) {
      const state = this.resizeState;
      if (!state || event.pointerId !== state.pointerId) return;

      event.preventDefault();
      const deltaX = event.clientX - state.startClientX;
      const deltaY = event.clientY - state.startClientY;

      if (!state.moved) {
        if (Math.hypot(deltaX, deltaY) < 3) return;
        state.moved = true;
        this.host?.setAttribute('data-resizing', '');
        this.setManualPosition(state.startLeft, state.startTop, false);
        this.setPanelSize(state.startWidth, state.startHeight, false);
      }

      this.pendingResizePoint = {
        clientX: event.clientX,
        clientY: event.clientY,
      };

      if (this.resizeFrameId) return;
      this.resizeFrameId = window.requestAnimationFrame(() => {
        this.resizeFrameId = 0;
        const point = this.pendingResizePoint;
        this.pendingResizePoint = null;
        if (point) this.applyResizePoint(point.clientX, point.clientY);
      });
    }

    applyResizePoint(clientX, clientY) {
      const state = this.resizeState;
      if (!state?.moved) return;

      const deltaX = clientX - state.startClientX;
      const deltaY = clientY - state.startClientY;
      const requestedWidth = state.horizontalSide === 'left'
        ? state.startWidth - deltaX
        : state.startWidth + deltaX;
      const requestedHeight = state.verticalSide === 'top'
        ? state.startHeight - deltaY
        : state.startHeight + deltaY;

      const margin = Math.max(
        0,
        Number(this.config.answerTocDragViewportMarginPx) || 0,
      );
      const viewportWidth = Math.max(1, document.documentElement.clientWidth);
      const viewportHeight = Math.max(1, document.documentElement.clientHeight);
      const limits = this.getPanelSizeLimits();

      // 固定对角：从哪个角拖动，就保持其对角在原位置。
      const maxWidthByAnchor = Math.max(
        1,
        state.horizontalSide === 'left'
          ? state.startRight - margin
          : viewportWidth - state.startLeft - margin,
      );
      const maxHeightByAnchor = Math.max(
        1,
        state.verticalSide === 'top'
          ? state.startBottom - margin
          : viewportHeight - state.startTop - margin,
      );
      const effectiveMinWidth = Math.min(limits.minWidth, maxWidthByAnchor);
      const effectiveMaxWidth = Math.max(
        effectiveMinWidth,
        Math.min(limits.maxWidth, maxWidthByAnchor),
      );
      const effectiveMinHeight = Math.min(limits.minHeight, maxHeightByAnchor);
      const effectiveMaxHeight = Math.max(
        effectiveMinHeight,
        Math.min(limits.maxHeight, maxHeightByAnchor),
      );
      const width = Math.round(
        Math.min(effectiveMaxWidth, Math.max(effectiveMinWidth, requestedWidth)),
      );
      const height = Math.round(
        Math.min(effectiveMaxHeight, Math.max(effectiveMinHeight, requestedHeight)),
      );
      const left = state.horizontalSide === 'left'
        ? state.startRight - width
        : state.startLeft;
      const top = state.verticalSide === 'top'
        ? state.startBottom - height
        : state.startTop;

      this.setPanelSize(width, height, false);
      this.setManualPosition(left, top, false);
    }

    onResizePointerEnd(event) {
      this.finishResize(event, false);
    }

    onResizePointerCancel(event) {
      this.finishResize(event, true);
    }

    finishResize(event, cancelled) {
      const state = this.resizeState;
      if (!state || event.pointerId !== state.pointerId) return;

      if (this.resizeFrameId) {
        window.cancelAnimationFrame(this.resizeFrameId);
        this.resizeFrameId = 0;
      }

      const point = this.pendingResizePoint;
      this.pendingResizePoint = null;
      if (point && state.moved) this.applyResizePoint(point.clientX, point.clientY);

      try {
        state.captureTarget?.releasePointerCapture?.(state.pointerId);
      } catch {
        // 忽略 pointer capture 已释放的情况。
      }

      window.removeEventListener('pointermove', this.onResizePointerMove, true);
      window.removeEventListener('pointerup', this.onResizePointerEnd, true);
      window.removeEventListener('pointercancel', this.onResizePointerCancel, true);

      this.host?.removeAttribute('data-resizing');
      if (this.rootStyleBeforeResize) {
        document.documentElement.style.userSelect = this.rootStyleBeforeResize.userSelect;
        document.documentElement.style.cursor = this.rootStyleBeforeResize.cursor;
      }
      this.rootStyleBeforeResize = null;
      this.resizeState = null;

      if (state.moved && !cancelled) {
        this.ensurePanelSizeInViewport(false);
        this.ensureManualPositionInViewport(true);
        this.writeSizeState();
      }

      this.resumeTransientAutoCollapse(event.clientX, event.clientY);
    }

    resumeTransientAutoCollapse(clientX, clientY) {
      if (!this.transientHoverOpen || this.collapsed || this.dragState || this.resizeState) {
        return;
      }

      const rect = this.panel?.getBoundingClientRect();
      const pointInside = rect && Number.isFinite(clientX) && Number.isFinite(clientY)
        ? clientX >= rect.left && clientX <= rect.right &&
          clientY >= rect.top && clientY <= rect.bottom
        : false;
      if (!pointInside && !this.panel?.matches(':hover')) this.scheduleHoverCollapse();
    }

    clampPosition(left, top, width, height) {
      const margin = Math.max(
        0,
        Number(this.config.answerTocDragViewportMarginPx) || 0,
      );
      const viewportWidth = Math.max(1, document.documentElement.clientWidth);
      const viewportHeight = Math.max(1, document.documentElement.clientHeight);
      const safeWidth = Math.max(1, Number(width) || 1);
      const safeHeight = Math.max(1, Number(height) || 1);
      const maxLeft = Math.max(margin, viewportWidth - safeWidth - margin);
      const maxTop = Math.max(margin, viewportHeight - safeHeight - margin);

      return {
        left: Math.min(maxLeft, Math.max(margin, left)),
        top: Math.min(maxTop, Math.max(margin, top)),
      };
    }

    ensureManualPositionInViewport(persist = false) {
      if (
        this.positionMode !== 'manual' ||
        !this.host ||
        this.host.hidden
      ) {
        return;
      }

      const widget = this.getVisibleWidget();
      if (!(widget instanceof HTMLElement) || widget.hidden) return;

      const rect = widget.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;

      this.host.dataset.dockSide = this.getWidgetDockSide(rect);
      const clamped = this.clampPosition(
        rect.left,
        rect.top,
        rect.width,
        rect.height,
      );
      this.setManualPosition(clamped.left, clamped.top, persist);
    }

    onScroll(event) {
      const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
      if (this.host && path.includes(this.host)) return;

      if (this.currentAnswer?.isConnected) {
        const target = event.target;

        if (this.currentScrollRoot instanceof HTMLElement) {
          const isDocumentScroll =
            target === document ||
            target === document.documentElement ||
            target === document.body ||
            target === window;

          if (target !== this.currentScrollRoot && !isDocumentScroll) return;
        } else if (target instanceof Element && !target.contains(this.currentAnswer)) {
          return;
        }
      }

      this.requestFrame(false);
    }

    onResize() {
      if (this.currentAnswer?.isConnected) {
        this.currentScrollRoot = this.findScrollRoot(this.currentAnswer);
      }

      window.requestAnimationFrame(() => {
        this.ensurePanelSizeInViewport(true);
        if (this.positionMode === 'manual') {
          this.ensureManualPositionInViewport(true);
        } else {
          this.updateInlineEndOffset();
        }
      });

      this.syncVisibility();
      this.requestFrame(true);
    }

    onKeyDown(event) {
      if (event.altKey && event.shiftKey && event.code === 'KeyO') {
        if (!this.host?.hidden) {
          event.preventDefault();
          this.setCollapsed(!this.collapsed, { source: 'keyboard', persist: true });
        }
        return;
      }

      if (event.key === 'Escape' && !this.collapsed) {
        const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
        if (this.host && path.includes(this.host)) {
          this.setCollapsed(true, { source: 'keyboard', persist: true });
        }
      }
    }

    onVisibilityChange() {
      if (!document.hidden) {
        this.syncOfficialConversationNav();
        this.refreshConversationTocIfNeeded();
        this.requestFrame(true);
      }
    }

    onRouteSignal() {
      window.setTimeout(() => this.resetForNavigation(), 0);
      window.setTimeout(() => this.requestFrame(true), 180);
    }

    resetForNavigation() {
      this.lastUrl = location.href;
      this.cancelConversationJump();
      this.clearConversationLabelCacheState();
      this.maxObservedOfficialLogicalIndex = -1;
      this.disconnectCurrentAnswer();
      this.clearToc();
      this.clearConversationToc();
      this.bindMainObserver();
      this.syncOfficialConversationNav();
      this.scheduleConversationRebuild(80);
      this.updateInlineEndOffset();
      this.requestFrame(true);
    }

    bindMainObserver() {
      const conversationAnchor =
        document.querySelector('[data-message-author-role="assistant"]') ||
        document.querySelector('[data-message-author-role="user"]') ||
        document.querySelector('[data-composer-surface="true"], #prompt-textarea');
      const main = conversationAnchor?.closest('main') || document.querySelector('main');
      if (!main) {
        window.clearTimeout(this.rebindTimer);
        this.rebindTimer = window.setTimeout(() => this.bindMainObserver(), 300);
        return;
      }

      if (main === this.mainElement && this.mainObserver) return;

      this.mainObserver?.disconnect();
      this.mainElement = main;
      this.mainObserver = new MutationObserver(this.onMainMutations);
      this.mainObserver.observe(main, {
        childList: true,
        subtree: true,
      });
      this.scheduleConversationRebuild(60);
    }

    nodeMatchesOrContains(node, selector) {
      return node instanceof Element && (
        node.matches?.(selector) || Boolean(node.querySelector?.(selector))
      );
    }

    onMainMutations(records) {
      let assistantAdded = false;
      let conversationChanged = false;

      for (const record of records) {
        if (
          this.currentAnswer?.isConnected &&
          record.target instanceof Node &&
          this.currentAnswer.contains(record.target)
        ) {
          continue;
        }

        for (const node of [...record.addedNodes, ...record.removedNodes]) {
          if (this.nodeMatchesOrContains(node, '[data-message-author-role="assistant"]')) {
            assistantAdded = true;
          }
          if (
            this.nodeMatchesOrContains(node, '[data-message-author-role="user"]') ||
            this.nodeMatchesOrContains(node, 'button[data-toc-item-index]')
          ) {
            conversationChanged = true;
          }
        }
      }

      if (this.currentAnswer && !this.currentAnswer.isConnected) {
        this.disconnectCurrentAnswer();
        this.clearToc();
        assistantAdded = true;
      }

      if (conversationChanged) this.scheduleConversationRebuild();
      if (assistantAdded) this.requestFrame(true);
    }

    requestFrame(forceAnswerDetection) {
      this.forceAnswerDetection ||= Boolean(forceAnswerDetection);
      if (this.frameId) return;

      this.frameId = window.requestAnimationFrame((timestamp) => {
        this.frameId = 0;

        if (!this.isViewportEligible()) {
          this.syncVisibility();
          return;
        }

        const elapsedSinceDetection = timestamp - this.lastAnswerDetectionAt;
        const shouldDetect =
          this.forceAnswerDetection ||
          !this.currentAnswer?.isConnected ||
          elapsedSinceDetection >= 180;

        this.forceAnswerDetection = false;

        if (shouldDetect) {
          window.clearTimeout(this.answerDetectionTimer);
          this.answerDetectionTimer = 0;
          this.lastAnswerDetectionAt = timestamp;
          this.detectCurrentAnswer();
        } else {
          window.clearTimeout(this.answerDetectionTimer);
          this.answerDetectionTimer = window.setTimeout(() => {
            this.answerDetectionTimer = 0;
            this.requestFrame(true);
          }, Math.max(0, Math.ceil(180 - elapsedSinceDetection)));
        }

        this.updateActiveHeading();
      });
    }

    detectCurrentAnswer() {
      const answer = this.findAnswerAtViewport();

      if (answer && answer !== this.currentAnswer) {
        this.setCurrentAnswer(answer);
      } else if (this.currentAnswer && !this.currentAnswer.isConnected) {
        this.disconnectCurrentAnswer();
        this.clearToc();
      }
    }

    findAnswerAtViewport() {
      const width = document.documentElement.clientWidth;
      const height = document.documentElement.clientHeight;
      if (width < 1 || height < 1) return null;

      const yRatios = [
        this.config.answerTocActiveLineRatio,
        0.5,
        0.68,
        0.16,
        0.82,
      ];
      const scores = new Map();

      const sampleAtX = (xRatio) => {
        const x = Math.min(width - 1, Math.max(0, width * xRatio));

        for (const yRatio of yRatios) {
          const y = Math.min(height - 1, Math.max(0, height * yRatio));
          const element = document.elementFromPoint(x, y);
          const answer = element?.closest?.('[data-message-author-role="assistant"]');
          if (!answer) continue;

          const verticalWeight =
            1 / (0.18 + Math.abs(yRatio - this.config.answerTocActiveLineRatio));
          const currentBonus = answer === this.currentAnswer ? 0.15 : 0;
          scores.set(answer, (scores.get(answer) ?? 0) + verticalWeight + currentBonus);
        }
      };

      sampleAtX(0.5);
      if (scores.size === 0) {
        sampleAtX(0.42);
        sampleAtX(0.58);
      }

      let bestAnswer = null;
      let bestScore = -Infinity;
      for (const [answer, score] of scores) {
        if (score > bestScore) {
          bestAnswer = answer;
          bestScore = score;
        }
      }
      if (bestAnswer) return bestAnswer;

      let currentStillVisible = false;
      if (this.currentAnswer?.isConnected) {
        const rect = this.currentAnswer.getBoundingClientRect();
        currentStillVisible = rect.bottom > 0 && rect.top < height;
      }

      if (!currentStillVisible) {
        let bestVisiblePixels = 0;
        for (const answer of document.querySelectorAll(ASSISTANT_SELECTOR)) {
          const rect = answer.getBoundingClientRect();
          const visiblePixels = Math.max(
            0,
            Math.min(rect.bottom, height) - Math.max(rect.top, 0),
          );
          if (visiblePixels > bestVisiblePixels) {
            bestVisiblePixels = visiblePixels;
            bestAnswer = answer;
          }
        }
      }

      return bestAnswer;
    }

    setCurrentAnswer(answer) {
      this.disconnectCurrentAnswer();

      this.currentAnswer = answer;
      this.currentContentRoot = answer;
      this.currentScrollRoot = this.findScrollRoot(answer);
      this.lastScrollTop = this.getScrollTop();

      this.answerObserver = new MutationObserver(this.onAnswerMutations);
      this.answerObserver.observe(answer, {
        childList: true,
        subtree: true,
      });

      this.rebuildToc();
      this.scheduleConversationRebuild(30);
      this.updateActiveConversation(true);
      this.updateInlineEndOffset();
    }

    disconnectCurrentAnswer() {
      this.answerObserver?.disconnect();
      this.answerObserver = null;
      this.headingTextObserver?.disconnect();
      this.headingTextObserver = null;
      this.currentAnswer = null;
      this.currentContentRoot = null;
      this.currentScrollRoot = null;
      this.activeIndex = -1;
      this.lastScrollTop = 0;
      window.clearTimeout(this.answerDetectionTimer);
      this.answerDetectionTimer = 0;
      window.clearTimeout(this.rebuildTimer);
      this.rebuildTimer = 0;
    }

    onAnswerMutations(records) {
      let touchesHeading = false;

      for (const record of records) {
        if (record.type !== 'childList') continue;

        if (
          record.target instanceof Element &&
          record.target.closest(this.config.answerTocHeadingSelector)
        ) {
          touchesHeading = true;
          break;
        }

        const changedNodes = [...record.addedNodes, ...record.removedNodes];
        for (const node of changedNodes) {
          if (!(node instanceof Element)) continue;
          if (
            node.matches?.(this.config.answerTocHeadingSelector) ||
            node.querySelector?.(this.config.answerTocHeadingSelector)
          ) {
            touchesHeading = true;
            break;
          }
        }
        if (touchesHeading) break;
      }

      if (touchesHeading || records.some((record) => record.type === 'childList')) {
        this.scheduleTocRebuild();
      }
    }

    scheduleTocRebuild() {
      window.clearTimeout(this.rebuildTimer);
      this.rebuildTimer = window.setTimeout(() => {
        this.rebuildTimer = 0;
        this.rebuildToc();
      }, 180);
    }

    rebuildToc() {
      if (!this.currentAnswer?.isConnected || !this.currentContentRoot) {
        this.clearToc();
        return;
      }

      this.headingTextObserver?.disconnect();

      const headings = [];
      const hasMarkdownRoot =
        this.currentAnswer.matches('.markdown') ||
        Boolean(this.currentAnswer.querySelector('.markdown'));
      const nodes = this.currentContentRoot.querySelectorAll(
        this.config.answerTocHeadingSelector,
      );

      for (const element of nodes) {
        if (!(element instanceof HTMLElement)) continue;
        if (element.closest('[hidden], [aria-hidden="true"]')) continue;
        if (hasMarkdownRoot && !element.closest('.markdown')) continue;
        if (element.closest('[data-message-author-role="assistant"]') !== this.currentAnswer) {
          continue;
        }

        const fullLabel = this.normalizeText(element.textContent ?? '');
        if (!fullLabel) continue;

        headings.push({
          element,
          level: Number.parseInt(element.tagName.slice(1), 10) || 2,
          fullLabel,
          label: this.truncateLabel(fullLabel, this.config.answerTocMaxLabelLength, 180),
        });
      }

      if (this.config.answerTocDerivedOutline) {
        headings.push(...this.collectAdaptiveOutline(headings));
      }
      headings.sort((a, b) => {
        if (a.element === b.element) return 0;
        const position = a.element.compareDocumentPosition(b.element);
        if (position & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
        if (position & Node.DOCUMENT_POSITION_PRECEDING) return 1;
        return 0;
      });

      this.headings = headings.slice(0, Math.max(3, Number(this.config.answerTocDerivedMaxItems) || 18));
      this.observeHeadingText();
      this.renderTocItems();
      const nextActiveIndex = this.findActiveIndexBinary();
      this.activeIndex = -1;
      this.applyActiveIndex(nextActiveIndex, false);
      this.updateViewMeta();
      this.syncVisibility();
    }

    collectDerivedOutline() {
      const answer = this.currentAnswer;
      if (!(answer instanceof HTMLElement)) return [];
      const markdownRoot = answer.matches('.markdown') ? answer : answer.querySelector('.markdown');
      const root = markdownRoot || answer;
      const minLength = Math.max(3, Number(this.config.answerTocDerivedMinTextLength) || 8);
      const maxItems = Math.max(3, Number(this.config.answerTocDerivedMaxItems) || 18);
      const belongsToAnswer = (element) =>
        element.closest('[data-message-author-role="assistant"]') === answer
        && !element.closest('[hidden], [aria-hidden="true"]');
      const makeItem = (element, level, prefix = '') => {
        const raw = this.normalizeText(element.textContent ?? '');
        if (raw.length < minLength) return null;
        const sentence = raw.split(/(?<=[。！？.!?])\s+|\n+/)[0] || raw;
        const fullLabel = prefix + sentence.slice(0, 220);
        return {
          element,
          level,
          fullLabel,
          label: this.truncateLabel(fullLabel, this.config.answerTocMaxLabelLength, 180),
          derived: true,
        };
      };

      // Atlas 风格的最大标题层级降级：H1/H2 缺失时仍使用 H3-H6。
      const lowerHeadings = Array.from(root.querySelectorAll('h3, h4, h5, h6'))
        .filter((element) => element instanceof HTMLElement && belongsToAnswer(element))
        .map((element) => makeItem(element, Number(element.tagName.slice(1))))
        .filter(Boolean);
      if (lowerHeadings.length) return lowerHeadings.slice(0, maxItems);

      // 其次识别“加粗段首/独立加粗段”，它们常被模型当作视觉章节标题。
      const strongSections = Array.from(root.querySelectorAll('p, li'))
        .filter((element) => element instanceof HTMLElement && belongsToAnswer(element))
        .map((element) => {
          const strong = element.querySelector(':scope > strong:first-child, :scope > b:first-child');
          if (!(strong instanceof HTMLElement)) return null;
          const label = this.normalizeText(strong.textContent ?? '');
          if (label.length < 2 || label.length > 100) return null;
          return {
            element,
            level: element.tagName === 'LI' ? 3 : 2,
            fullLabel: label,
            label: this.truncateLabel(label, this.config.answerTocMaxLabelLength, 180),
            derived: true,
          };
        }).filter(Boolean);
      if (strongSections.length >= 2) return strongSections.slice(0, maxItems);

      // 最后按顶层结构块建立“幽灵章节”，使完全无标题的回答仍可导航。
      let blocks = Array.from(root.querySelectorAll(':scope > p, :scope > blockquote, :scope > pre, :scope > ul, :scope > ol, :scope > table, :scope > div'))
        .filter((element) => element instanceof HTMLElement && belongsToAnswer(element));
      if (!blocks.length) {
        blocks = Array.from(root.querySelectorAll('p, blockquote, pre, ul, ol, table'))
          .filter((element) => element instanceof HTMLElement && belongsToAnswer(element));
      }
      const meaningful = blocks.filter((element) => this.normalizeText(element.textContent ?? '').length >= minLength);
      const stride = Math.max(1, Math.ceil(meaningful.length / maxItems));
      return meaningful.filter((_, index) => index === 0 || index % stride === 0)
        .slice(0, maxItems)
        .map((element) => {
          const prefix = element.tagName === 'PRE' ? '代码：' : element.tagName === 'TABLE' ? '表格：' : '';
          return makeItem(element, 3, prefix);
        }).filter(Boolean);
    }

    collectAdaptiveOutline(existing = []) {
      const answer = this.currentAnswer;
      if (!(answer instanceof HTMLElement)) return [];
      const markdownRoot = answer.matches('.markdown') ? answer : answer.querySelector('.markdown');
      const root = markdownRoot || answer;
      const minLength = Math.max(3, Number(this.config.answerTocDerivedMinTextLength) || 8);
      const maxItems = Math.max(3, Number(this.config.answerTocDerivedMaxItems) || 18);
      const totalTextLength = this.normalizeText(root.textContent ?? '').length;
      const separatorTarget = Math.min(6, root.querySelectorAll('hr').length + 1);
      const targetCount = Math.min(maxItems, Math.max(
        existing.length,
        separatorTarget,
        totalTextLength >= 1400 ? 4 : totalTextLength >= 600 ? 3 : totalTextLength >= 240 ? 2 : 1,
      ));
      const needed = Math.max(0, targetCount - existing.length);
      if (!needed) return [];

      const existingElements = new Set(existing.map((item) => item.element));
      const existingLabels = new Set(existing.map((item) => this.normalizeText(item.fullLabel ?? '').toLocaleLowerCase()));
      const belongsToAnswer = (element) =>
        element.closest('[data-message-author-role="assistant"]') === answer
        && !element.closest('[hidden], [aria-hidden="true"]');
      const compareElements = (a, b) => {
        if (a === b) return 0;
        const position = a.compareDocumentPosition(b);
        if (position & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
        if (position & Node.DOCUMENT_POSITION_PRECEDING) return 1;
        return 0;
      };
      const makeItem = (element, labelOverride = '', level = 3) => {
        if (!(element instanceof HTMLElement) || existingElements.has(element) || !belongsToAnswer(element)) return null;
        const raw = this.normalizeText(element.textContent ?? '');
        const source = this.normalizeText(labelOverride || raw)
          .replace(/\*\*([^*]+)\*\*/g, '$1');
        if (raw.length < minLength || source.length < 2) return null;
        const sentence = source.split(/[。！？.!?](?:\s+|$)|\n+/)[0] || source;
        const prefix = element.tagName === 'PRE' ? '代码：' : element.tagName === 'TABLE' ? '表格：' : '';
        const fullLabel = (prefix + sentence).slice(0, 220);
        if (existingLabels.has(this.normalizeText(fullLabel).toLocaleLowerCase())) return null;
        return {
          element,
          level,
          fullLabel,
          label: this.truncateLabel(fullLabel, this.config.answerTocMaxLabelLength, 180),
          derived: true,
        };
      };
      const extractLeadingLabel = (element) => {
        const raw = this.normalizeText(element.textContent ?? '');
        const markdownBold = raw.match(/^\*\*([^*\n]{2,100})\*\*[:：]?/);
        if (markdownBold) return this.normalizeText(markdownBold[1]);
        const strong = element.querySelector(':scope > strong:first-child, :scope > b:first-child');
        if (!(strong instanceof HTMLElement)) return '';
        let textBefore = '';
        for (const node of element.childNodes) {
          if (node === strong) break;
          textBefore += node.textContent ?? '';
        }
        if (this.normalizeText(textBefore)) return '';
        const label = this.normalizeText(strong.textContent ?? '');
        return label.length >= 2 && label.length <= 100 ? label : '';
      };

      const blockSelector = 'p, blockquote, pre, ul, ol, table';
      const blocks = Array.from(root.querySelectorAll(blockSelector))
        .filter((element) => element instanceof HTMLElement && belongsToAnswer(element))
        .filter((element) => {
          const ancestorBlock = element.parentElement?.closest(blockSelector);
          return !(ancestorBlock instanceof HTMLElement) || !root.contains(ancestorBlock);
        })
        .filter((element) => this.normalizeText(element.textContent ?? '').length >= minLength)
        .sort(compareElements);
      if (!blocks.length) return existing.length ? [] : this.collectDerivedOutline();

      const candidates = new Map();
      const offer = (element, labelOverride, level, priority) => {
        const item = makeItem(element, labelOverride, level);
        if (!item) return;
        const current = candidates.get(element);
        if (!current || priority < current.priority) candidates.set(element, { item, priority });
      };

      const firstExisting = existing.map((item) => item.element).filter(Boolean).sort(compareElements)[0] || null;
      const leadingBlock = blocks.find((block) => !firstExisting
        || Boolean(block.compareDocumentPosition(firstExisting) & Node.DOCUMENT_POSITION_FOLLOWING));
      if (leadingBlock) offer(leadingBlock, '', 2, 0);

      for (const element of root.querySelectorAll('p, li')) {
        if (!(element instanceof HTMLElement) || !belongsToAnswer(element)) continue;
        const leadingLabel = extractLeadingLabel(element);
        if (leadingLabel) offer(element, leadingLabel, element.tagName === 'LI' ? 4 : 3, 1);
      }

      const boundaryNodes = Array.from(root.querySelectorAll('hr, h1, h2, h3, h4, h5, h6, p, blockquote, pre, ul, ol, table'))
        .filter((element) => element instanceof HTMLElement && belongsToAnswer(element));
      for (let index = 0; index < boundaryNodes.length; index += 1) {
        if (boundaryNodes[index].tagName !== 'HR') continue;
        const next = boundaryNodes.slice(index + 1).find((element) => element.tagName !== 'HR');
        if (!next || /^H[1-6]$/.test(next.tagName) || existingElements.has(next)) continue;
        offer(next, '', 3, 2);
      }

      const stride = Math.max(1, Math.floor(blocks.length / Math.max(1, needed)));
      blocks.forEach((element, index) => {
        if (index === 0 || index % stride === 0 || index === blocks.length - 1) offer(element, '', 3, 3);
      });

      return [...candidates.values()]
        .sort((a, b) => a.priority - b.priority || compareElements(a.item.element, b.item.element))
        .slice(0, needed)
        .map((entry) => entry.item)
        .sort((a, b) => compareElements(a.element, b.element));
    }

    observeHeadingText() {
      this.headingTextObserver?.disconnect();
      this.headingTextObserver = null;
      if (!this.headings.length) return;

      this.headingTextObserver = new MutationObserver(() => {
        this.scheduleTocRebuild();
      });

      for (const heading of this.headings) {
        this.headingTextObserver.observe(heading.element, {
          childList: true,
          subtree: true,
          characterData: true,
        });
      }
    }

    normalizeText(text) {
      return String(text).replace(/\s+/g, ' ').trim();
    }

    truncateLabel(label, configuredMax, fallback) {
      const max = Math.max(20, Number(configuredMax) || fallback);
      if (label.length <= max) return label;
      return `${label.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
    }

    formatConversationLabel(label) {
      const configuredMax = Number(this.config.conversationTocMaxLabelLength);

      // 0 或负数代表不按字符数截断。
      if (Number.isFinite(configuredMax) && configuredMax <= 0) return label;

      return this.truncateLabel(label, configuredMax, 120);
    }

    renderTocItems() {
      if (!this.list) return;

      const fragment = document.createDocumentFragment();
      this.itemButtons = [];

      this.headings.forEach((heading, index) => {
        const item = document.createElement('li');
        const button = document.createElement('button');
        const label = document.createElement('span');

        button.type = 'button';
        button.className = 'toc-item';
        button.dataset.kind = 'heading';
        button.dataset.headingIndex = String(index);
        button.dataset.level = String(heading.level);
        button.dataset.active = 'false';
        button.title = heading.fullLabel;

        label.className = 'toc-item-label';
        label.textContent = heading.label;

        button.appendChild(label);
        item.appendChild(button);
        fragment.appendChild(item);
        this.itemButtons.push(button);
      });

      this.list.replaceChildren(fragment);
      this.updateViewMeta();
    }

    clearToc() {
      this.headings = [];
      this.itemButtons = [];
      this.activeIndex = -1;
      this.list?.replaceChildren();
      this.updateViewMeta();
      this.syncVisibility();
    }

    getConversationTurnElement(element) {
      return element instanceof Element
        ? element.closest('[data-testid^="conversation-turn-"]')
        : null;
    }

    getConversationTurnNumber(element) {
      const turn = this.getConversationTurnElement(element);
      const testId = turn?.getAttribute('data-testid') || '';
      const match = /^conversation-turn-(\d+)$/.exec(testId);
      if (!match) return null;

      const number = Number.parseInt(match[1], 10);
      return Number.isInteger(number) && number >= 0 ? number : null;
    }

    getConversationRecordIdentity(element, fallbackIndex = 0) {
      const turn = this.getConversationTurnElement(element);
      const messageId =
        element?.getAttribute?.('data-message-id') ||
        element?.closest?.('[data-message-id]')?.getAttribute('data-message-id') ||
        turn?.querySelector?.('[data-message-id]')?.getAttribute('data-message-id') ||
        '';
      if (messageId) return `message:${messageId}`;

      const testId = turn?.getAttribute('data-testid') || '';
      return testId || `user-node:${fallbackIndex}`;
    }

    getUserMessageElements() {
      const bridgedTurns = globalThis.__cgptUnifiedRuntimeV1?.lazy?.getAllTurnNodes?.() || [];
      const candidateSource = bridgedTurns.length
        ? bridgedTurns.flatMap((turn) => [
            ...(turn.matches?.('[data-message-author-role="user"]') ? [turn] : []),
            ...turn.querySelectorAll?.('[data-message-author-role="user"]') || [],
          ])
        : [...document.querySelectorAll(USER_SELECTOR)];
      const candidates = candidateSource.filter((element) => {
        if (!(element instanceof HTMLElement) || (!element.isConnected && !bridgedTurns.length)) return false;
        if (element.parentElement?.closest('[data-message-author-role="user"]')) return false;
        if (element.closest('[hidden]')) return false;
        return true;
      });

      /*
       * 响应式布局或分支切换期间可能同时存在同一轮次的多个副本。
       * 每个 conversation-turn 仅保留“可见且文本更完整”的那个节点。
       */
      const bestByIdentity = new Map();
      candidates.forEach((element, index) => {
        const identity = this.getConversationRecordIdentity(element, index);
        const textLength = (element.textContent ?? '').trim().length;
        const hiddenPenalty = element.closest('[aria-hidden="true"]') ? 0 : 1_000_000;
        const score = hiddenPenalty + textLength;
        const current = bestByIdentity.get(identity);
        if (!current || score > current.score) {
          bestByIdentity.set(identity, { element, score });
        }
      });

      const bestElements = [...bestByIdentity.values()].map((entry) => entry.element);
      if (bridgedTurns.length) return bestElements;
      return bestElements.sort((a, b) => {
          if (a === b) return 0;
          const relation = a.compareDocumentPosition(b);
          if (relation & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
          if (relation & Node.DOCUMENT_POSITION_PRECEDING) return 1;
          return 0;
        });
    }

    normalizeConversationText(text) {
      return String(text)
        .replace(/\r\n?/g, '\n')
        .replace(/[^\S\n]+/g, ' ')
        .replace(/ *\n */g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    }

    extractUserPromptText(element) {
      const source =
        element.querySelector('[data-message-content]') ||
        element.querySelector('.whitespace-pre-wrap') ||
        element.querySelector('.markdown') ||
        element;

      const clone = source.cloneNode(true);
      if (clone instanceof Element) {
        for (const removable of clone.querySelectorAll(
          'button, script, style, svg, [aria-hidden="true"], [role="tooltip"]',
        )) {
          removable.remove();
        }
      }

      return this.normalizeConversationText(clone.textContent ?? '')
        .replace(/^(?:You said:|你说[:：])\s*/i, '')
        .trim();
    }

    collectUserMessageRecords() {
      return this.getUserMessageElements().map((userElement, index) => ({
        userElement,
        targetElement: this.getConversationTurnElement(userElement) || userElement,
        turnNumber: this.getConversationTurnNumber(userElement),
        identity: this.getConversationRecordIdentity(userElement, index),
        fullLabel: this.extractUserPromptText(userElement),
        ariaHidden: Boolean(userElement.closest('[aria-hidden="true"]')),
      }));
    }

    getOfficialNavButtons() {
      return [...document.querySelectorAll('button[data-toc-item-index]')]
        .filter((button) => button instanceof HTMLButtonElement && button.isConnected)
        .sort((a, b) => {
          const ai = Number.parseInt(a.dataset.tocItemIndex ?? '', 10);
          const bi = Number.parseInt(b.dataset.tocItemIndex ?? '', 10);
          return (Number.isFinite(ai) ? ai : 0) - (Number.isFinite(bi) ? bi : 0);
        });
    }

    getOfficialActiveLogicalIndex(buttons = this.getOfficialNavButtons()) {
      const activeButton = buttons.find((button) => button.hasAttribute('data-toc-active'));
      const index = Number.parseInt(activeButton?.dataset.tocItemIndex ?? '', 10);
      return Number.isInteger(index) && index >= 0 ? index : -1;
    }

    findFixedAncestor(element) {
      for (let current = element?.parentElement; current; current = current.parentElement) {
        if (
          getComputedStyle(current).position === 'fixed' ||
          current.classList.contains('fixed')
        ) {
          return current;
        }
      }
      return null;
    }

    syncOfficialConversationNav() {
      const buttons = this.getOfficialNavButtons();
      const container = buttons.length ? this.findFixedAncestor(buttons[0]) : null;

      if (
        this.officialNavContainer &&
        this.officialNavContainer !== container &&
        this.officialNavContainer.isConnected
      ) {
        this.officialNavContainer.removeAttribute(
          'data-cgpt-native-conversation-toc-hidden',
        );
      }

      this.officialNavContainer = container;
      if (container) {
        if (this.config.hideOfficialConversationToc) {
          container.setAttribute('data-cgpt-native-conversation-toc-hidden', '');
        } else {
          container.removeAttribute('data-cgpt-native-conversation-toc-hidden');
        }
      }

      return buttons;
    }

    getConversationSignature() {
      const users = this.getUserMessageElements();
      const buttons = this.getOfficialNavButtons();
      const currentAnswerIdentity = this.currentAnswer?.closest?.(
        '[data-testid^="conversation-turn-"]',
      )?.getAttribute('data-testid') || '';
      const userSignature = users.map((element, index) => {
        const text = (element.textContent ?? '').trim();
        const identity = this.getConversationRecordIdentity(element, index);
        return `${identity}:${text.length}:${text.slice(0, 16)}:${text.slice(-16)}`;
      }).join('|');
      const buttonSignature = buttons.map((button) => {
        const index = button.dataset.tocItemIndex ?? '?';
        const active = button.hasAttribute('data-toc-active') ? 'a' : '';
        return `${index}${active}`;
      }).join(',');
      return `${currentAnswerIdentity}||${userSignature}||${buttonSignature}`;
    }

    refreshConversationTocIfNeeded() {
      const signature = this.getConversationSignature();
      if (signature !== this.lastConversationSignature) {
        this.scheduleConversationRebuild(40);
      }
    }

    scheduleConversationRebuild(delay = 120) {
      window.clearTimeout(this.conversationRebuildTimer);
      this.conversationRebuildTimer = window.setTimeout(() => {
        this.conversationRebuildTimer = 0;
        this.rebuildConversationToc();
      }, Math.max(0, Number(delay) || 0));
    }

    findCurrentPromptRecordIndex(records) {
      if (!this.currentAnswer?.isConnected || !records.length) return -1;

      let bestIndex = -1;
      for (let index = 0; index < records.length; index += 1) {
        const userElement = records[index].userElement;
        if (!userElement?.isConnected) continue;

        const relation = userElement.compareDocumentPosition(this.currentAnswer);
        if (relation & Node.DOCUMENT_POSITION_FOLLOWING) {
          bestIndex = index;
        } else if (relation & Node.DOCUMENT_POSITION_PRECEDING) {
          break;
        }
      }
      return bestIndex;
    }

    findViewportPromptRecordIndex(records) {
      if (!records.length) return -1;
      const lineY = this.getActiveLineViewportY();
      let bestIndex = -1;
      let bestDistance = Number.POSITIVE_INFINITY;

      records.forEach((record, index) => {
        const target = record.targetElement || record.userElement;
        if (!(target instanceof HTMLElement) || !target.isConnected) return;
        const rect = target.getBoundingClientRect();
        const distance = rect.top <= lineY && rect.bottom >= lineY
          ? 0
          : Math.min(Math.abs(rect.top - lineY), Math.abs(rect.bottom - lineY));
        if (distance < bestDistance) {
          bestDistance = distance;
          bestIndex = index;
        }
      });
      return bestIndex;
    }

    getUserTurnStride(records) {
      const numbers = records
        .map((record) => record.turnNumber)
        .filter((number) => Number.isInteger(number));
      if (numbers.length < 2) return 2;

      const parity = numbers[0] % 2;
      return numbers.every((number) => number % 2 === parity) ? 2 : 1;
    }

    validateRecordIndexMapping(indices, maxOfficialIndex) {
      if (!indices.length) return false;
      const seen = new Set();
      let previous = -1;

      for (const index of indices) {
        if (!Number.isInteger(index) || index < 0) return false;
        if (maxOfficialIndex >= 0 && index > maxOfficialIndex) return false;
        if (seen.has(index) || index <= previous) return false;
        seen.add(index);
        previous = index;
      }
      return true;
    }

    clearConversationLabelCacheState() {
      this.conversationLabelCache.clear();
      this.conversationCacheIdentityByIndex.clear();
      this.conversationCacheIndexByIdentity.clear();
    }

    removeConversationCachedLabel(logicalIndex) {
      const identity = this.conversationCacheIdentityByIndex.get(logicalIndex);
      if (
        identity &&
        this.conversationCacheIndexByIdentity.get(identity) === logicalIndex
      ) {
        this.conversationCacheIndexByIdentity.delete(identity);
      }
      this.conversationCacheIdentityByIndex.delete(logicalIndex);
      this.conversationLabelCache.delete(logicalIndex);
    }

    cacheConversationRecordLabel(logicalIndex, record) {
      if (
        !Number.isInteger(logicalIndex) ||
        logicalIndex < 0 ||
        !record?.fullLabel
      ) {
        return;
      }

      const identity = String(record.identity || '');
      if (identity) {
        const previousIndex = this.conversationCacheIndexByIdentity.get(identity);
        if (Number.isInteger(previousIndex) && previousIndex !== logicalIndex) {
          this.removeConversationCachedLabel(previousIndex);
        }

        const displacedIdentity = this.conversationCacheIdentityByIndex.get(logicalIndex);
        if (
          displacedIdentity &&
          displacedIdentity !== identity &&
          this.conversationCacheIndexByIdentity.get(displacedIdentity) === logicalIndex
        ) {
          this.conversationCacheIndexByIdentity.delete(displacedIdentity);
        }

        this.conversationCacheIdentityByIndex.set(logicalIndex, identity);
        this.conversationCacheIndexByIdentity.set(identity, logicalIndex);
      }

      this.conversationLabelCache.set(logicalIndex, record.fullLabel);
    }

    mapUserRecordsToLogicalIndices(records, officialButtons) {
      const buttonsByIndex = new Map();
      let maxOfficialIndex = -1;

      for (const button of officialButtons) {
        const logicalIndex = Number.parseInt(button.dataset.tocItemIndex ?? '', 10);
        if (!Number.isInteger(logicalIndex) || logicalIndex < 0) continue;
        if (!buttonsByIndex.has(logicalIndex)) buttonsByIndex.set(logicalIndex, button);
        maxOfficialIndex = Math.max(maxOfficialIndex, logicalIndex);
      }

      const officialIndices = [...buttonsByIndex.keys()].sort((a, b) => a - b);
      const officialCount = officialIndices.length;
      const activeLogicalIndex = this.getOfficialActiveLogicalIndex(officialButtons);
      const anchorRecordIndex = this.findCurrentPromptRecordIndex(records);
      const viewportAnchorIndex = this.findViewportPromptRecordIndex(records);
      const stride = this.getUserTurnStride(records);
      const officialNavAppearsPartial =
        this.maxObservedOfficialLogicalIndex >= 0 &&
        maxOfficialIndex >= 0 &&
        maxOfficialIndex < this.maxObservedOfficialLogicalIndex;

      let mappedIndices = null;
      let confident = false;
      let trustLabels = false;
      let source = 'none';
      let tentativeTurnCandidate = null;

      const acceptCandidate = (
        candidate,
        candidateSource,
        candidateConfident,
        candidateTrustLabels,
      ) => {
        if (mappedIndices || !this.validateRecordIndexMapping(candidate, maxOfficialIndex)) {
          return false;
        }
        mappedIndices = candidate;
        source = candidateSource;
        confident = Boolean(candidateConfident);
        trustLabels = Boolean(candidateTrustLabels);
        return true;
      };

      if (!records.length) {
        return {
          buttonsByIndex,
          recordsByIndex: new Map(),
          maxIndex: maxOfficialIndex,
          officialMaxIndex: maxOfficialIndex,
          confident: true,
          trustLabels: true,
          source: 'empty',
        };
      }

      if (!officialCount) {
        acceptCandidate(
          records.map((_, index) => index),
          'dom-only',
          true,
          true,
        );
      }

      /*
       * 官方 active 项与“当前回答之前的用户提问”是最可靠的独立锚点。
       * 必须优先于 conversation-turn-N；页面首轮 hydration/虚拟化期间，
       * 后者可能暂时从 0 重新编号，不能直接视为绝对问答序号。
       */
      if (!mappedIndices && activeLogicalIndex >= 0 && anchorRecordIndex >= 0) {
        const anchorTurn = records[anchorRecordIndex].turnNumber;
        const candidate = records.map((record, index) => {
          if (Number.isInteger(anchorTurn) && Number.isInteger(record.turnNumber)) {
            const delta = record.turnNumber - anchorTurn;
            if (delta % stride === 0) return activeLogicalIndex + delta / stride;
          }
          return activeLogicalIndex + index - anchorRecordIndex;
        });
        acceptCandidate(candidate, 'active-current-answer', true, true);
      }

      if (!mappedIndices && activeLogicalIndex >= 0 && viewportAnchorIndex >= 0) {
        const candidate = records.map((_, index) =>
          activeLogicalIndex + index - viewportAnchorIndex);
        acceptCandidate(candidate, 'active-viewport', true, true);
      }

      if (!mappedIndices) {
        const recordsWithTurns = records.every((record) =>
          Number.isInteger(record.turnNumber));
        if (recordsWithTurns) {
          const candidates = [
            records.map((record) => Math.floor(record.turnNumber / 2)),
            records.map((record) => record.turnNumber),
          ];

          for (const candidate of candidates) {
            if (!this.validateRecordIndexMapping(candidate, maxOfficialIndex)) continue;

            const matchesCurrentAnchor =
              activeLogicalIndex >= 0 &&
              anchorRecordIndex >= 0 &&
              candidate[anchorRecordIndex] === activeLogicalIndex;
            const matchesViewportAnchor =
              activeLogicalIndex >= 0 &&
              viewportAnchorIndex >= 0 &&
              candidate[viewportAnchorIndex] === activeLogicalIndex;
            const matchesCompleteOfficialSet =
              records.length === officialCount &&
              candidate.length === officialIndices.length &&
              candidate.every((value, index) => value === officialIndices[index]);
            const reachesKnownConversationEnd =
              maxOfficialIndex >= 0 &&
              candidate[candidate.length - 1] === maxOfficialIndex;

            if (matchesCurrentAnchor || matchesViewportAnchor) {
              acceptCandidate(candidate, 'turn-number-aligned', true, true);
              break;
            }

            if (
              reachesKnownConversationEnd &&
              records.length < officialCount &&
              !officialNavAppearsPartial
            ) {
              acceptCandidate(candidate, 'turn-number-end-aligned', true, true);
              break;
            }

            if (matchesCompleteOfficialSet && !officialNavAppearsPartial) {
              acceptCandidate(candidate, 'turn-number-complete', true, true);
              break;
            }

            tentativeTurnCandidate ||= candidate;
          }
        }
      }

      /*
       * DOM 记录数与当前官方按钮数相等时可以临时一一对应；但如果此前
       * 已观察到更多官方项，则当前按钮集只是 React 过渡态，不能缓存标签。
       */
      if (!mappedIndices && records.length === officialCount) {
        acceptCandidate(
          officialIndices.slice(),
          'count-match',
          !officialNavAppearsPartial,
          !officialNavAppearsPartial,
        );
      }

      if (!mappedIndices && tentativeTurnCandidate) {
        acceptCandidate(tentativeTurnCandidate, 'turn-number-tentative', false, false);
      }

      if (!mappedIndices) {
        const offset = Math.max(0, maxOfficialIndex + 1 - records.length);
        acceptCandidate(
          records.map((_, index) => index + offset),
          'tail-fallback',
          false,
          false,
        );
      }

      const recordsByIndex = new Map();
      mappedIndices.forEach((logicalIndex, recordIndex) => {
        if (!Number.isInteger(logicalIndex) || logicalIndex < 0) return;
        if (maxOfficialIndex >= 0 && logicalIndex > maxOfficialIndex) return;
        const record = records[recordIndex];
        if (!record) return;

        const previous = recordsByIndex.get(logicalIndex);
        if (!previous) {
          recordsByIndex.set(logicalIndex, record);
          return;
        }

        const previousScore = (previous.ariaHidden ? 0 : 1_000_000) + previous.fullLabel.length;
        const nextScore = (record.ariaHidden ? 0 : 1_000_000) + record.fullLabel.length;
        if (nextScore > previousScore) recordsByIndex.set(logicalIndex, record);
      });

      let maxMappedIndex = -1;
      for (const index of recordsByIndex.keys()) {
        maxMappedIndex = Math.max(maxMappedIndex, index);
      }

      return {
        buttonsByIndex,
        recordsByIndex,
        maxIndex: Math.max(maxOfficialIndex, maxMappedIndex),
        officialMaxIndex: maxOfficialIndex,
        confident,
        trustLabels,
        source,
      };
    }

    rebuildConversationToc() {
      if (!this.config.enableConversationToc) {
        this.clearConversationToc();
        return;
      }

      const records = this.collectUserMessageRecords();
      const officialButtons = this.syncOfficialConversationNav();
      const mapping = this.mapUserRecordsToLogicalIndices(records, officialButtons);
      const items = [];

      /*
       * 首次 hydration 时官方目录可能先出现 1～2 项，随后一次性扩展为
       * 完整问答数。此前按“小目录”写入的缓存没有可信的绝对索引，必须清空。
       */
      if (
        this.maxObservedOfficialLogicalIndex >= 0 &&
        mapping.officialMaxIndex > this.maxObservedOfficialLogicalIndex + 1
      ) {
        this.clearConversationLabelCacheState();
      }
      if (mapping.officialMaxIndex >= 0) {
        this.maxObservedOfficialLogicalIndex = Math.max(
          this.maxObservedOfficialLogicalIndex,
          mapping.officialMaxIndex,
        );
      }

      if (mapping.trustLabels) {
        for (const [logicalIndex, record] of mapping.recordsByIndex) {
          this.cacheConversationRecordLabel(logicalIndex, record);
        }
      }

      const liveLabelIndices = new Map();
      if (mapping.trustLabels) {
        for (const [logicalIndex, record] of mapping.recordsByIndex) {
          if (!record.fullLabel) continue;
          const indices = liveLabelIndices.get(record.fullLabel) || new Set();
          indices.add(logicalIndex);
          liveLabelIndices.set(record.fullLabel, indices);
        }
      }

      const knownIndices = new Set([
        ...mapping.buttonsByIndex.keys(),
        ...mapping.recordsByIndex.keys(),
        ...this.conversationLabelCache.keys(),
      ]);
      const maxKnownIndex = knownIndices.size ? Math.max(...knownIndices) : -1;
      const maxIndex = Math.max(mapping.maxIndex, maxKnownIndex);

      for (let logicalIndex = 0; logicalIndex <= maxIndex; logicalIndex += 1) {
        const mappedRecord = mapping.recordsByIndex.get(logicalIndex) ?? null;
        const displayRecord = mapping.trustLabels ? mappedRecord : null;
        const officialButton = mapping.buttonsByIndex.get(logicalIndex) ?? null;
        let cachedLabel = this.conversationLabelCache.get(logicalIndex) || '';

        /*
         * 若某个仅来自缓存的标签，与当前已可信挂载在另一个序号的记录完全
         * 相同，它通常就是 hydration 早期错位留下的副本。宁可退回 Prompt N，
         * 也不把最后两问错误显示到最前两问。
         */
        if (!displayRecord && cachedLabel) {
          const liveIndices = liveLabelIndices.get(cachedLabel);
          if (liveIndices && !liveIndices.has(logicalIndex)) {
            this.removeConversationCachedLabel(logicalIndex);
            cachedLabel = '';
          }
        }

        const unloaded = !mappedRecord && !officialButton && !cachedLabel;
        const fullLabel =
          displayRecord?.fullLabel ||
          cachedLabel ||
          officialButton?.getAttribute('aria-label') ||
          (unloaded
            ? `提问 ${logicalIndex + 1}（尚未加载，点击加载）`
            : `提问 ${logicalIndex + 1}`);

        items.push({
          logicalIndex,
          userElement: mapping.confident ? mappedRecord?.userElement ?? null : null,
          targetElement: mapping.confident ? mappedRecord?.targetElement ?? null : null,
          officialButton,
          fullLabel,
          label: this.formatConversationLabel(fullLabel),
          mappingConfident: mapping.confident,
          unloaded,
        });
      }

      this.conversationItems = items;
      this.lastConversationSignature = this.getConversationSignature();
      this.renderConversationItems();
      const active = this.findActiveConversationIndex();
      this.activeConversationIndex = -1;
      this.applyActiveConversationIndex(active, false);
      this.updateViewMeta();
      this.syncVisibility();
    }

    renderConversationItems() {
      if (!this.conversationList) return;

      const fragment = document.createDocumentFragment();
      this.conversationItemButtons = [];

      this.conversationItems.forEach((conversation, index) => {
        const item = document.createElement('li');
        const button = document.createElement('button');
        const number = document.createElement('span');
        const label = document.createElement('span');

        button.type = 'button';
        button.className = 'toc-item';
        button.dataset.kind = 'conversation';
        button.dataset.conversationIndex = String(index);
        button.dataset.active = 'false';
        button.dataset.unloaded = String(Boolean(conversation.unloaded));
        button.title = conversation.fullLabel;

        number.className = 'prompt-index';
        number.textContent = String(conversation.logicalIndex + 1);
        label.className = 'toc-item-label';
        label.textContent = conversation.label;

        button.append(number, label);
        item.appendChild(button);
        fragment.appendChild(item);
        this.conversationItemButtons.push(button);
      });

      this.conversationList.replaceChildren(fragment);
      this.updateViewMeta();
    }

    clearConversationToc(clearCache = false) {
      window.clearTimeout(this.conversationRebuildTimer);
      this.conversationRebuildTimer = 0;
      this.conversationItems = [];
      this.conversationItemButtons = [];
      this.activeConversationIndex = -1;
      this.lastConversationSignature = '';
      this.pendingConversationLogicalIndex = -1;
      this.pendingConversationUntil = 0;
      if (clearCache) this.clearConversationLabelCacheState();
      this.conversationList?.replaceChildren();
      this.updateViewMeta();
      this.syncVisibility();
    }

    findActiveConversationIndex() {
      if (!this.conversationItems.length) return -1;

      if (
        this.pendingConversationLogicalIndex >= 0 &&
        performance.now() < this.pendingConversationUntil
      ) {
        const pendingIndex = this.conversationItems.findIndex(
          (item) => item.logicalIndex === this.pendingConversationLogicalIndex,
        );
        if (pendingIndex >= 0) return pendingIndex;
      }

      if (this.currentAnswer?.isConnected) {
        let best = -1;
        for (let index = 0; index < this.conversationItems.length; index += 1) {
          const userElement = this.conversationItems[index].userElement;
          if (!userElement?.isConnected) continue;

          const relation = userElement.compareDocumentPosition(this.currentAnswer);
          if (relation & Node.DOCUMENT_POSITION_FOLLOWING) {
            best = index;
          } else if (relation & Node.DOCUMENT_POSITION_PRECEDING) {
            break;
          }
        }
        if (best >= 0) return best;
      }

      const officialActiveLogicalIndex = this.getOfficialActiveLogicalIndex();
      if (officialActiveLogicalIndex >= 0) {
        const officialActiveIndex = this.conversationItems.findIndex(
          (item) => item.logicalIndex === officialActiveLogicalIndex,
        );
        if (officialActiveIndex >= 0) return officialActiveIndex;
      }

      if (
        this.activeConversationIndex >= 0 &&
        this.activeConversationIndex < this.conversationItems.length
      ) {
        return this.activeConversationIndex;
      }

      return 0;
    }

    updateActiveConversation(force = false) {
      const index = this.findActiveConversationIndex();
      this.applyActiveConversationIndex(index, force);
    }

    applyActiveConversationIndex(index, ensureVisible) {
      if (
        !Number.isInteger(index) ||
        index < 0 ||
        index >= this.conversationItemButtons.length
      ) {
        return;
      }
      if (this.activeConversationIndex === index && !ensureVisible) return;

      const previous = this.conversationItemButtons[this.activeConversationIndex];
      if (previous) {
        previous.dataset.active = 'false';
        previous.removeAttribute('aria-current');
      }

      this.activeConversationIndex = index;
      const current = this.conversationItemButtons[index];
      if (!current) return;

      current.dataset.active = 'true';
      current.setAttribute('aria-current', 'location');
      if (ensureVisible || (!this.collapsed && this.activeView === 'conversation')) {
        this.scrollItemIntoView(this.conversationNav, current);
      }
    }

    clearConversationJumpReveal() {
      window.clearTimeout(this.conversationJumpRevealTimer);
      this.conversationJumpRevealTimer = 0;
      if (this.conversationJumpRevealElement?.isConnected) {
        this.conversationJumpRevealElement.removeAttribute(
          'data-cgpt-conversation-jump-target',
        );
      }
      this.conversationJumpRevealElement = null;
    }

    revealConversationJumpTarget(target) {
      if (!(target instanceof HTMLElement)) return;
      if (this.conversationJumpRevealElement !== target) {
        this.clearConversationJumpReveal();
      }
      this.conversationJumpRevealElement = target;
      target.setAttribute('data-cgpt-conversation-jump-target', '');
      window.clearTimeout(this.conversationJumpRevealTimer);
      this.conversationJumpRevealTimer = window.setTimeout(() => {
        this.clearConversationJumpReveal();
      }, 2400);
    }

    cancelConversationJump() {
      this.conversationJumpToken += 1;
      for (const timer of this.conversationJumpTimers) window.clearTimeout(timer);
      this.conversationJumpTimers.clear();
      this.pendingConversationLogicalIndex = -1;
      this.pendingConversationUntil = 0;
      this.clearConversationJumpReveal();
    }

    scheduleConversationJumpTask(callback, delay, token) {
      const timer = window.setTimeout(() => {
        this.conversationJumpTimers.delete(timer);
        if (token !== this.conversationJumpToken) return;
        callback();
      }, Math.max(0, Number(delay) || 0));
      this.conversationJumpTimers.add(timer);
      return timer;
    }

    resolveConversationTarget(logicalIndex) {
      const currentItem = this.conversationItems.find(
        (item) => item.logicalIndex === logicalIndex,
      );
      if (
        currentItem?.mappingConfident &&
        currentItem.targetElement?.isConnected
      ) {
        return currentItem.targetElement;
      }

      const records = this.collectUserMessageRecords();
      const mapping = this.mapUserRecordsToLogicalIndices(
        records,
        this.getOfficialNavButtons(),
      );
      const record = mapping.recordsByIndex.get(logicalIndex);
      if (!record || !mapping.confident) return null;

      if (record.fullLabel && mapping.trustLabels) {
        this.cacheConversationRecordLabel(logicalIndex, record);
      }
      if (currentItem) {
        currentItem.userElement = record.userElement;
        currentItem.targetElement = record.targetElement;
        currentItem.fullLabel = record.fullLabel || currentItem.fullLabel;
        currentItem.label = this.formatConversationLabel(currentItem.fullLabel);
        currentItem.mappingConfident = true;
      }
      return record.targetElement || record.userElement;
    }

    isUsableConversationTarget(element) {
      if (!(element instanceof HTMLElement) || !element.isConnected) return false;
      if (element.closest('[hidden]')) return false;
      const rect = element.getBoundingClientRect();
      return rect.width > 0 || rect.height > 0 || element.getClientRects().length > 0;
    }

    getConversationJumpBehavior() {
      const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      return this.config.answerTocSmoothScroll && !reduceMotion ? 'smooth' : 'auto';
    }

    getConversationScrollOffset() {
      return Math.max(
        0,
        Number(this.config.conversationTocScrollOffsetPx) || 88,
      );
    }

    scrollConversationTarget(target, behavior = 'auto') {
      if (!this.isUsableConversationTarget(target)) return false;
      this.revealConversationJumpTarget(target);

      const targetRect = target.getBoundingClientRect();
      const offset = this.getConversationScrollOffset();
      const scrollRoot = this.findScrollRoot(target);

      if (scrollRoot instanceof HTMLElement) {
        const rootRect = scrollRoot.getBoundingClientRect();
        const visibleTop = Math.max(0, rootRect.top);
        const visibleBottom = Math.min(window.innerHeight, rootRect.bottom);
        const availableHeight = Math.max(1, visibleBottom - visibleTop);
        const desiredTop = visibleTop + Math.min(offset, availableHeight * 0.3);
        const delta = targetRect.top - desiredTop;
        scrollRoot.scrollBy({ top: delta, behavior });
      } else {
        const desiredTop = Math.min(offset, window.innerHeight * 0.3);
        const delta = targetRect.top - desiredTop;
        window.scrollBy({ top: delta, behavior });
      }
      return true;
    }

    correctConversationTargetPosition(target) {
      return this.scrollConversationTarget(target, 'auto');
    }

    activateOfficialConversationButton(logicalIndex) {
      const button = this.getOfficialNavButtons().find((candidate) => (
        Number.parseInt(candidate.dataset.tocItemIndex ?? '', 10) === logicalIndex
      ));
      if (!(button instanceof HTMLButtonElement) || button.disabled) return false;

      try {
        button.click();
        return true;
      } catch (error) {
        console.warn('[ChatGPT 双层目录] 官方问答跳转失败：', error);
        return false;
      }
    }

    requestOlderConversationHistory() {
      const target = this.currentScrollRoot instanceof HTMLElement
        ? this.currentScrollRoot
        : this.currentAnswer?.isConnected
          ? this.findScrollRoot(this.currentAnswer)
          : null;
      try {
        if (target instanceof HTMLElement) {
          target.scrollTo({ top: 0, behavior: 'auto' });
        } else {
          window.scrollTo({ top: 0, behavior: 'auto' });
        }
      } catch (_) {
        if (target instanceof HTMLElement) target.scrollTop = 0;
        else document.scrollingElement?.scrollTo?.(0, 0);
      }
      this.scheduleConversationRebuild(80);
      this.requestFrame(true);
    }

    jumpToConversation(index) {
      const item = this.conversationItems[index];
      if (!item) return;

      this.cancelConversationJump();
      globalThis.__cgptUnifiedRuntimeV1?.beginNavigationLease?.(3600);
      globalThis.__cgptUnifiedRuntimeV1?.lazy?.revealAllForNavigation?.();
      const token = this.conversationJumpToken;
      const logicalIndex = item.logicalIndex;
      this.pendingConversationLogicalIndex = logicalIndex;
      this.pendingConversationUntil = performance.now() + 2600;
      this.applyActiveConversationIndex(index, true);

      const initialTarget = this.resolveConversationTarget(logicalIndex);
      const canDirectlyScroll = this.isUsableConversationTarget(initialTarget);
      let jumpLifetime = 2250;

      if (canDirectlyScroll) {
        this.scrollConversationTarget(
          initialTarget,
          this.getConversationJumpBehavior(),
        );

        for (const delay of [460, 980, 1700]) {
          this.scheduleConversationJumpTask(() => {
            const liveTarget = this.resolveConversationTarget(logicalIndex) || initialTarget;
            this.correctConversationTargetPosition(liveTarget);
            this.requestFrame(true);
          }, delay, token);
        }
      } else {
        const activated = this.activateOfficialConversationButton(logicalIndex);
        const retryDelays = activated
          ? [100, 280, 620, 1150, 1950]
          : [0, 180, 420, 800, 1300, 2000, 2900, 4000, 5200];
        if (!activated) {
          jumpLifetime = 5900;
          globalThis.__cgptUnifiedRuntimeV1?.beginNavigationLease?.(6400);
        }

        for (const delay of retryDelays) {
          this.scheduleConversationJumpTask(() => {
            this.syncOfficialConversationNav();
            this.scheduleConversationRebuild(0);
            this.requestFrame(true);

            const liveTarget = this.resolveConversationTarget(logicalIndex);
            if (this.isUsableConversationTarget(liveTarget)) {
              this.correctConversationTargetPosition(liveTarget);
              return;
            }

            /* React 若替换了官方按钮，在中段再解析并补点一次。 */
            if (activated && delay === 620) {
              const activeLogicalIndex = this.getOfficialActiveLogicalIndex();
              if (activeLogicalIndex !== logicalIndex) {
                this.activateOfficialConversationButton(logicalIndex);
              }
            } else if (!activated) {
              const newlyAvailableButton = this.getOfficialNavButtons().find((candidate) =>
                Number.parseInt(candidate.dataset.tocItemIndex ?? '', 10) === logicalIndex);
              if (newlyAvailableButton instanceof HTMLButtonElement) {
                newlyAvailableButton.click();
              } else {
                this.requestOlderConversationHistory();
              }
            }
          }, delay, token);
        }
      }

      this.scheduleConversationJumpTask(() => {
        this.pendingConversationLogicalIndex = -1;
        this.pendingConversationUntil = 0;
        this.requestFrame(true);
        window.setTimeout(() => {
          if (token === this.conversationJumpToken) {
            this.clearConversationJumpReveal();
          }
        }, 240);
      }, jumpLifetime, token);
    }

    isViewportEligible() {
      return (
        this.config.answerTocMinViewportWidth <= 0 ||
        document.documentElement.clientWidth >= this.config.answerTocMinViewportWidth
      );
    }

    syncVisibility() {
      if (!this.host) return;

      const wasHidden = this.host.hidden;
      const hasAnyNavigation =
        this.conversationItems.length > 0 || this.headings.length > 0 || Boolean(this.promptLibrary);
      this.host.hidden = !this.isViewportEligible() || !hasAnyNavigation;

      if (this.host.hidden && this.transientHoverOpen) {
        this.transientHoverOpen = false;
        this.transientHoverOriginRect = null;
        this.clearTransientOriginClickSuppression();
        this.collapsed = true;
        this.applyCollapsedState();
      }

      if (!this.host.hidden) {
        this.applyActiveView();
        this.applyCollapsedState();
        this.updateViewMeta();

        if (wasHidden) {
          window.requestAnimationFrame(() => {
            this.ensurePanelSizeInViewport(false);
            this.ensureManualPositionInViewport(true);

            if (!this.collapsed) {
              const current = this.activeView === 'conversation'
                ? this.conversationItemButtons[this.activeConversationIndex]
                : this.itemButtons[this.activeIndex];
              const nav = this.activeView === 'conversation'
                ? this.conversationNav
                : this.tocNav;
              if (current) this.scrollItemIntoView(nav, current);
            }
          });
        }
      }
    }

    jumpToHeading(index) {
      const heading = this.headings[index];
      if (!heading?.element?.isConnected) return;

      const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      const behavior = this.config.answerTocSmoothScroll && !reduceMotion
        ? 'smooth'
        : 'auto';

      this.applyActiveIndex(index, true);
      globalThis.__cgptUnifiedRuntimeV1?.beginNavigationLease?.(1800);
      heading.element.scrollIntoView({
        behavior,
        block: 'start',
        inline: 'nearest',
      });
    }

    updateActiveHeading() {
      if (!this.headings.length || !this.currentAnswer?.isConnected) return;

      const lineY = this.getActiveLineViewportY();
      const currentScrollTop = this.getScrollTop();
      const viewportSpan = this.getScrollViewportSpan();
      const largeJump = Math.abs(currentScrollTop - this.lastScrollTop) > viewportSpan * 0.8;
      this.lastScrollTop = currentScrollTop;

      let index = this.activeIndex;
      if (index < 0 || index >= this.headings.length || largeJump) {
        index = this.findActiveIndexBinary(lineY);
      } else {
        while (
          index + 1 < this.headings.length &&
          this.headings[index + 1].element.getBoundingClientRect().top <= lineY
        ) {
          index += 1;
        }

        while (
          index > 0 &&
          this.headings[index].element.getBoundingClientRect().top > lineY
        ) {
          index -= 1;
        }
      }

      this.applyActiveIndex(index, false);
    }

    findActiveIndexBinary(lineY = this.getActiveLineViewportY()) {
      if (!this.headings.length) return -1;
      if (this.headings[0].element.getBoundingClientRect().top > lineY) return 0;

      let low = 0;
      let high = this.headings.length - 1;
      let best = 0;

      while (low <= high) {
        const middle = (low + high) >> 1;
        const top = this.headings[middle].element.getBoundingClientRect().top;

        if (top <= lineY) {
          best = middle;
          low = middle + 1;
        } else {
          high = middle - 1;
        }
      }

      return best;
    }

    applyActiveIndex(index, ensureVisible) {
      if (!Number.isInteger(index) || index < 0 || index >= this.itemButtons.length) {
        return;
      }
      if (this.activeIndex === index && !ensureVisible) return;

      const previous = this.itemButtons[this.activeIndex];
      if (previous) {
        previous.dataset.active = 'false';
        previous.removeAttribute('aria-current');
      }

      this.activeIndex = index;
      const current = this.itemButtons[index];
      if (!current) return;

      current.dataset.active = 'true';
      current.setAttribute('aria-current', 'location');
      if (ensureVisible || (!this.collapsed && this.activeView === 'headings')) {
        this.scrollItemIntoView(this.tocNav, current);
      }
    }

    scrollItemIntoView(nav, button) {
      if (!(nav instanceof HTMLElement) || !(button instanceof HTMLElement)) return;
      if (nav.hidden) return;

      const navRect = nav.getBoundingClientRect();
      const buttonRect = button.getBoundingClientRect();
      const padding = 5;

      if (buttonRect.top < navRect.top + padding) {
        nav.scrollTop += buttonRect.top - navRect.top - padding;
      } else if (buttonRect.bottom > navRect.bottom - padding) {
        nav.scrollTop += buttonRect.bottom - navRect.bottom + padding;
      }
    }

    getActiveLineViewportY() {
      const ratio = Math.min(0.9, Math.max(0.05, this.config.answerTocActiveLineRatio));

      if (this.currentScrollRoot instanceof HTMLElement) {
        const rect = this.currentScrollRoot.getBoundingClientRect();
        const top = Math.max(0, rect.top);
        const bottom = Math.min(window.innerHeight, rect.bottom);
        const height = Math.max(1, bottom - top);
        return top + height * ratio;
      }

      return window.innerHeight * ratio;
    }

    findScrollRoot(element) {
      for (let parent = element.parentElement; parent; parent = parent.parentElement) {
        if (parent === document.body || parent === document.documentElement) break;

        const style = getComputedStyle(parent);
        if (
          /^(auto|scroll|overlay)$/.test(style.overflowY) &&
          parent.scrollHeight > parent.clientHeight + 4
        ) {
          return parent;
        }
      }

      return null;
    }

    getScrollTop() {
      if (this.currentScrollRoot instanceof HTMLElement) {
        return this.currentScrollRoot.scrollTop;
      }
      return window.scrollY || document.documentElement.scrollTop || 0;
    }

    getScrollViewportSpan() {
      if (this.currentScrollRoot instanceof HTMLElement) {
        return Math.max(1, this.currentScrollRoot.clientHeight);
      }
      return Math.max(1, window.innerHeight);
    }

    getOfficialNavContainer() {
      if (this.officialNavContainer?.isConnected) return this.officialNavContainer;
      this.syncOfficialConversationNav();
      return this.officialNavContainer;
    }

    updateInlineEndOffset() {
      if (!this.host || this.positionMode === 'manual') return;

      this.host.dataset.dockSide = 'right';
      let offset = this.config.hideOfficialConversationToc
        ? Math.max(0, Number(this.config.answerTocStandaloneInlineEndPx) || 20)
        : Math.max(0, Number(this.config.answerTocFallbackInlineEndPx) || 68);

      if (!this.config.hideOfficialConversationToc) {
        const container = this.getOfficialNavContainer();
        if (container) {
          const rect = container.getBoundingClientRect();
          const direction = getComputedStyle(document.documentElement).direction;
          const occupiedFromInlineEnd = direction === 'rtl'
            ? rect.right
            : window.innerWidth - rect.left;

          offset = Math.max(
            offset,
            Math.ceil(
              occupiedFromInlineEnd +
              (Number(this.config.answerTocOfficialNavGapPx) || 12),
            ),
          );
        }
      }

      this.host.style.setProperty('--cgpt-answer-toc-inline-end', `${offset}px`);
    }
  }


  const startAnswerToc = () => {
    const controller = new AnswerTocController(CONFIG);
    controller.start();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startAnswerToc, { once: true });
  } else {
    startAnswerToc();
  }
})();


/* ===== Module 2: recoverable adaptive DOM parking (Lazy Chat++ V2) ===== */

/* SPDX-License-Identifier: GPL-3.0-or-later */
/*!
 * ChatGPT Lazy Chat++ — Userscript
 * Custom long-chat build: detach-only, UI-free, token-estimator-free, auto re-collapse.
 * Copyright (C) 2025 Alex S Hamilton
 */

(function () {
  'use strict';

  const TRANSLATE_PATH_RE = /^\/translate\/?$/i;
  const isTranslatePage = () =>
    location.hostname === 'chatgpt.com' && TRANSLATE_PATH_RE.test(location.pathname);

  if (isTranslatePage()) {
    bootTranslatePageTweaks();
    return;
  }

  bootNormalCopy();
  bootLazyChat();

  function bootNormalCopy() {
    const forceNormalCopy = (e) => {
      e.stopImmediatePropagation();
      return true;
    };

    ['copy', 'cut'].forEach((event) => {
      document.addEventListener(event, forceNormalCopy, true);
    });
  }

  function bootTranslatePageTweaks() {
    const STYLE_ID = 'cgpt-translate-layout-style';
    const ROOT_ATTR = 'data-cgpt-translate-page';
    const MARK_ATTRS = [
      'data-cgpt-translate-main',
      'data-cgpt-translate-heading',
      'data-cgpt-translate-content',
      'data-cgpt-translate-controls',
      'data-cgpt-translate-panels',
      'data-cgpt-translate-source-col',
      'data-cgpt-translate-target-col',
      'data-cgpt-translate-target-wrap',
      'data-cgpt-translate-source',
      'data-cgpt-translate-target',
      'data-cgpt-translate-actions'
    ];

    let observer = null;
    let markRaf = 0;

    function ensureStyle() {
      if (document.getElementById(STYLE_ID)) return;

      const s = document.createElement('style');
      s.id = STYLE_ID;
      s.textContent = `
        html[${ROOT_ATTR}="1"] {
          --cgpt-translate-desktop-height: clamp(420px, 80dvh, 960px);
          --cgpt-translate-mobile-top: 16.5dvh;
        }

        html[${ROOT_ATTR}="1"],
        html[${ROOT_ATTR}="1"] body {
          min-height: 100%;
        }

        html[${ROOT_ATTR}="1"] [data-cgpt-translate-main] {
          width: 100% !important;
          max-width: min(1600px, 96vw) !important;
          min-height: calc(100dvh - var(--mkt-header-height, 0px)) !important;
          padding-inline: clamp(16px, 2vw, 24px) !important;
          padding-top: clamp(10px, 1.5dvh, 18px) !important;
          padding-bottom: clamp(10px, 2dvh, 22px) !important;
          gap: clamp(10px, 1.5dvh, 18px) !important;
        }

        html[${ROOT_ATTR}="1"] [data-cgpt-translate-heading] {
          margin: 0 !important;
          padding-block: clamp(6px, 1.5dvh, 18px) !important;
          font-size: clamp(1.8rem, 3vw, 3rem) !important;
          line-height: 1.1 !important;
        }

        html[${ROOT_ATTR}="1"] [data-cgpt-translate-content] {
          display: flex !important;
          flex-direction: column !important;
          flex: 1 1 auto !important;
          min-height: 0 !important;
          gap: clamp(12px, 1.75dvh, 20px) !important;
        }

        html[${ROOT_ATTR}="1"] [data-cgpt-translate-controls] {
          flex: 0 0 auto !important;
          gap: clamp(8px, 1.2dvh, 14px) !important;
        }

        html[${ROOT_ATTR}="1"] [data-cgpt-translate-controls] select,
        html[${ROOT_ATTR}="1"] [data-cgpt-translate-controls] button {
          min-height: clamp(42px, 4.75dvh, 52px) !important;
        }

        html[${ROOT_ATTR}="1"] [data-cgpt-translate-panels] {
          display: flex !important;
          flex-direction: row !important;
          align-items: stretch !important;
          gap: clamp(12px, 2vw, 24px) !important;
          flex: 0 0 auto !important;
          height: var(--cgpt-translate-desktop-height) !important;
          min-height: var(--cgpt-translate-desktop-height) !important;
        }

        html[${ROOT_ATTR}="1"] [data-cgpt-translate-source-col],
        html[${ROOT_ATTR}="1"] [data-cgpt-translate-target-col] {
          display: flex !important;
          flex-direction: column !important;
          flex: 1 1 0 !important;
          min-height: 0 !important;
        }

        html[${ROOT_ATTR}="1"] [data-cgpt-translate-target-wrap] {
          position: relative !important;
          display: flex !important;
          flex: 1 1 auto !important;
          min-height: 0 !important;
        }

        html[${ROOT_ATTR}="1"] textarea[data-cgpt-translate-source],
        html[${ROOT_ATTR}="1"] textarea[data-cgpt-translate-target] {
          flex: 1 1 auto !important;
          width: 100% !important;
          min-height: 0 !important;
          height: 100% !important;
          max-height: none !important;
          overflow: auto !important;
          resize: none !important;
        }

        html[${ROOT_ATTR}="1"] [data-cgpt-translate-actions] {
          flex: 0 0 auto !important;
        }

        @media (max-width: 767.98px) {
          html[${ROOT_ATTR}="1"] [data-cgpt-translate-main] {
            max-width: 100vw !important;
            min-height: calc(100dvh - var(--mkt-header-height, 0px)) !important;
            padding-inline: 12px !important;
            padding-top: 8px !important;
            padding-bottom: 10px !important;
            gap: 8px !important;
          }

          html[${ROOT_ATTR}="1"] [data-cgpt-translate-heading] {
            padding-block: 2px !important;
            font-size: clamp(1rem, 5vw, 1.35rem) !important;
            line-height: 1.15 !important;
          }

          html[${ROOT_ATTR}="1"] [data-cgpt-translate-content] {
            gap: 8px !important;
          }

          html[${ROOT_ATTR}="1"] [data-cgpt-translate-controls] {
            gap: 6px !important;
          }

          html[${ROOT_ATTR}="1"] [data-cgpt-translate-controls] select,
          html[${ROOT_ATTR}="1"] [data-cgpt-translate-controls] button {
            min-height: 36px !important;
            height: 36px !important;
            font-size: 14px !important;
            padding-top: 6px !important;
            padding-bottom: 6px !important;
          }

          html[${ROOT_ATTR}="1"] [data-cgpt-translate-panels] {
            flex: 1 1 auto !important;
            flex-direction: column !important;
            height: calc(100dvh - var(--mkt-header-height, 0px) - var(--cgpt-translate-mobile-top) - 24px) !important;
            min-height: calc(100dvh - var(--mkt-header-height, 0px) - var(--cgpt-translate-mobile-top) - 24px) !important;
            gap: 8px !important;
          }

          html[${ROOT_ATTR}="1"] [data-cgpt-translate-actions] {
            display: none !important;
          }
        }
      `;

      document.head.appendChild(s);
    }

    function commonAncestor(a, b) {
      const seen = new Set();
      let cur = a;

      while (cur) {
        seen.add(cur);
        cur = cur.parentElement;
      }

      cur = b;
      while (cur) {
        if (seen.has(cur)) return cur;
        cur = cur.parentElement;
      }

      return null;
    }

    function childOfAncestor(node, ancestor) {
      let cur = node;
      let prev = node;

      while (cur && cur !== ancestor) {
        prev = cur;
        cur = cur.parentElement;
        if (cur === ancestor) return prev;
      }

      return null;
    }

    function clearMarks() {
      const selector = MARK_ATTRS.map((attr) => `[${attr}]`).join(',');
      document.querySelectorAll(selector).forEach((el) => {
        MARK_ATTRS.forEach((attr) => el.removeAttribute(attr));
      });
    }

    function mark(el, attr) {
      if (el) el.setAttribute(attr, '1');
    }

    function applyMarks() {
      if (!isTranslatePage()) {
        clearMarks();
        document.documentElement.removeAttribute(ROOT_ATTR);
        return;
      }

      document.documentElement.setAttribute(ROOT_ATTR, '1');

      const main = document.querySelector('main');
      if (!main) return;

      const heading = Array.from(main.querySelectorAll('h1')).find((el) =>
        /translate/i.test(el.textContent || '')
      );

      const textareas = Array.from(main.querySelectorAll('textarea'));
      const source = textareas.find((el) => !(el.readOnly || el.hasAttribute('readonly')));
      const target = textareas.find((el) => el.readOnly || el.hasAttribute('readonly'));

      const controls = Array.from(main.querySelectorAll('div')).find(
        (el) => el.querySelectorAll('select').length >= 2
      );

      const panels = source && target ? commonAncestor(source, target) : null;
      const content =
        controls && panels && controls.parentElement === panels.parentElement
          ? controls.parentElement
          : panels?.parentElement || controls?.parentElement || null;

      const sourceCol = panels && source ? childOfAncestor(source, panels) : null;
      const targetCol = panels && target ? childOfAncestor(target, panels) : null;
      const targetWrap = target && targetCol && target.parentElement !== targetCol ? target.parentElement : null;

      const actions =
        panels?.nextElementSibling?.tagName === 'SECTION'
          ? panels.nextElementSibling
          : Array.from(main.querySelectorAll('section')).find((el) => el.querySelectorAll('button').length >= 2) || null;

      if (!heading || !source || !target || !controls || !panels) return;

      clearMarks();
      mark(main, 'data-cgpt-translate-main');
      mark(heading, 'data-cgpt-translate-heading');
      mark(content, 'data-cgpt-translate-content');
      mark(controls, 'data-cgpt-translate-controls');
      mark(panels, 'data-cgpt-translate-panels');
      mark(sourceCol, 'data-cgpt-translate-source-col');
      mark(targetCol, 'data-cgpt-translate-target-col');
      mark(targetWrap, 'data-cgpt-translate-target-wrap');
      mark(source, 'data-cgpt-translate-source');
      mark(target, 'data-cgpt-translate-target');
      mark(actions, 'data-cgpt-translate-actions');
    }

    function scheduleApplyMarks() {
      cancelAnimationFrame(markRaf);
      markRaf = requestAnimationFrame(applyMarks);
    }

    function boot() {
      ensureStyle();
      scheduleApplyMarks();

      if (observer) observer.disconnect();
      observer = new MutationObserver(scheduleApplyMarks);
      observer.observe(document.documentElement, { childList: true, subtree: true });
    }

    if (document.readyState === 'complete' || document.readyState === 'interactive') boot();
    else window.addEventListener('DOMContentLoaded', boot, { once: true });
  }

  function bootLazyChat() {
    // ============================================================
    // ChatGPT Lazy Chat++ V2 — Adaptive Performance Engine
    //
    // Design goals:
    // 1) Actually detach old turns from the live DOM, but keep them restorable.
    // 2) Adapt the live-window size to turn count + browser pressure.
    // 3) Do zero non-essential DOM work while streaming / typing.
    // 4) Avoid fetch/API interception and avoid token/text scanning.
    // 5) Improve huge formula/code replies with conservative CSS containment.
    // 6) Stay invisible: no floating button / overlay.
    // ============================================================

    const VERSION = '2.0.0';
    const ROOT_FLAG = 'data-lcpp-v2';
    const ROOT_PRESSURE = 'data-lcpp-pressure';
    const ROOT_HOT = 'data-lcpp-hot';
    const ROOT_STREAMING = 'data-lcpp-streaming';

    // ---------- Adaptive window ----------
    const MIN_RETAIN = 8;
    const REVEAL_BATCH = 10;
    const MAX_DETACH_PER_IDLE = 18;
    const TOP_REVEAL_THRESHOLD = 150;       // px
    const BOTTOM_RECOLLAPSE_THRESHOLD = 850; // px
    const RECOLLAPSE_DELAY_MS = 850;

    // ---------- Scheduling ----------
    const OBS_DEBOUNCE_MS = 420;
    const STREAM_POLL_MS = 350;
    const STREAM_END_COOLDOWN_MS = 600;
    const PRESSURE_SCAN_MS = 6000;
    const ROUTE_POLL_MS = 1200;
    const INPUT_HOT_MS = 900;
    const ACTION_HOT_MS = 1400;

    // ---------- Pressure scan caps ----------
    const NODE_COUNT_CAP = 14000;
    const MATH_COUNT_CAP = 220;
    const CODE_COUNT_CAP = 60;
    const LONG_TASK_WINDOW_MS = 15000;

    // Prefer current ChatGPT turn hosts, then older/fallback selectors.
    const TURN_HOST_SELECTOR = [
      'section[data-testid^="conversation-turn-"]',
      'article[data-testid^="conversation-turn-"]'
    ].join(',');

    const TURN_FALLBACK_SELECTOR = [
      '[data-testid^="conversation-turn-"]',
      'article[data-turn-id]',
      'article[data-turn]',
      'div[data-testid^="conversation-turn"]',
      'li[data-testid^="conversation-turn"]'
    ].join(',');

    const STOP_BTN_SEL = [
      '#composer-submit-button[data-testid="stop-button"]',
      '[data-testid="stop-button"]',
      'button[aria-label*="stop streaming" i]',
      'button[aria-label*="stop generating" i]',
      'button[aria-label*="停止" i]'
    ].join(',');

    const COMPOSER_SEL = [
      '#prompt-textarea',
      'textarea[name="prompt-textarea"]',
      '.ProseMirror[contenteditable="true"]',
      'form[class*="composer"] textarea',
      'form[class*="composer"] [contenteditable="true"]'
    ].join(',');

    const MATH_SELECTOR = '.katex, .katex-display, mjx-container, math';
    const CODE_SELECTOR = 'pre, table, .cm-editor, [data-testid*="code" i]';

    // ---------- State ----------
    let hiddenStore = []; // [{ placeholder, node }]
    let revealExtra = 0;
    let pressureLevel = 0;
    let lastMetrics = null;

    let observer = null;
    let observerRoot = null;
    let scrollContainer = null;
    let scrollAttachedTarget = null;

    let isStreaming = false;
    let streamEndTimer = 0;
    let inputHotUntil = 0;
    let hotReleaseTimer = 0;
    let recollapseTimer = 0;

    let pendingApply = null;
    let applyIdleHandle = 0;
    let applyTimeoutHandle = 0;

    let pressureTimer = 0;
    let routeTimer = 0;
    let routeKey = location.href;

    let longTaskObserver = null;
    let longTasks = []; // [{at, duration}]

    // ============================================================
    // Utilities
    // ============================================================

    const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

    function setRootAttr(name, value) {
      try {
        const root = document.documentElement;
        if (!root) return;
        if (value === false || value === null || value === undefined) {
          root.removeAttribute(name);
        } else {
          root.setAttribute(name, String(value));
        }
      } catch {}
    }

    function now() {
      return Date.now();
    }

    function isInteractionHot() {
      return now() < inputHotUntil;
    }

    function hasStopButton() {
      try {
        return !!document.querySelector(STOP_BTN_SEL);
      } catch {
        return false;
      }
    }

    function isComposerTarget(target) {
      if (!(target instanceof Element)) return false;
      try {
        if (target.matches(COMPOSER_SEL)) return true;
        return !!target.closest(COMPOSER_SEL);
      } catch {
        return false;
      }
    }

    function isHeavyActionTarget(target) {
      if (!(target instanceof Element)) return false;
      const btn = target.closest('button');
      if (!btn || !btn.closest('main')) return false;
      const meta = [
        btn.getAttribute('aria-label') || '',
        btn.getAttribute('title') || '',
        btn.getAttribute('data-testid') || '',
        btn.textContent || ''
      ].join(' ').toLowerCase();

      return /edit|retry|regenerate|try again|stop|continue|pause|编辑|重试|重新生成|停止|继续/.test(meta);
    }

    function markInteractionHot(durationMs = INPUT_HOT_MS) {
      inputHotUntil = Math.max(inputHotUntil, now() + durationMs);
      setRootAttr(ROOT_HOT, '1');

      // Cancel optional background work, but never interrupt a detach already in-flight.
      if (hotReleaseTimer) clearTimeout(hotReleaseTimer);
      hotReleaseTimer = setTimeout(() => {
        hotReleaseTimer = 0;
        if (isInteractionHot()) {
          markInteractionHot(120);
          return;
        }
        setRootAttr(ROOT_HOT, '0');
        scheduleApply({ preserveAnchor: false, force: true });
        schedulePressureScan(450);
      }, durationMs + 40);
    }

    // ============================================================
    // Turn discovery
    // ============================================================

    function normalizeTurnCandidates(nodes) {
      const list = [];
      const seen = new Set();

      for (const el of nodes) {
        if (!(el instanceof HTMLElement)) continue;
        if (seen.has(el)) continue;

        // If a selected candidate sits inside another selected turn host,
        // keep only the outer host to avoid duplicate turns.
        let p = el.parentElement;
        let nested = false;
        while (p && p !== document.body) {
          if (seen.has(p)) {
            nested = true;
            break;
          }
          if (p.matches?.(TURN_HOST_SELECTOR)) {
            nested = true;
            break;
          }
          p = p.parentElement;
        }
        if (nested) continue;

        seen.add(el);
        list.push(el);
      }

      return list;
    }

    function getTurns() {
      try {
        const hosts = Array.from(document.querySelectorAll(TURN_HOST_SELECTOR));
        if (hosts.length) return normalizeTurnCandidates(hosts);

        const fallback = Array.from(document.querySelectorAll(TURN_FALLBACK_SELECTOR));
        return normalizeTurnCandidates(fallback);
      } catch {
        return [];
      }
    }

    function getTotalTurns() {
      return hiddenStore.length + getTurns().length;
    }

    function pickFeedRoot() {
      const turns = getTurns();
      if (turns.length >= 2 && turns[0].parentElement && turns[0].parentElement === turns[1].parentElement) {
        return turns[0].parentElement;
      }
      return (
        document.querySelector('[role="feed"]') ||
        document.querySelector('main [role="feed"]') ||
        document.querySelector('main') ||
        document.body ||
        document.documentElement
      );
    }

    // ============================================================
    // Adaptive retention
    // ============================================================

    function baseRetainForTotal(total) {
      if (total <= 16) return total;
      if (total <= 32) return 20;
      if (total <= 64) return 16;
      if (total <= 120) return 12;
      return 10;
    }

    function pressureRetain(level) {
      if (level >= 3) return 8;
      if (level >= 2) return 12;
      if (level >= 1) return 18;
      return 9999;
    }

    function currentRetain(total = getTotalTurns()) {
      if (total <= 0) return 0;
      const byTurns = baseRetainForTotal(total);
      const byPressure = pressureRetain(pressureLevel);
      return clamp(Math.min(byTurns, byPressure), Math.min(total, MIN_RETAIN), total);
    }

    function desiredVisibleCount(total = getTotalTurns()) {
      const base = currentRetain(total);
      return Math.min(total, base + revealExtra);
    }

    // ============================================================
    // Styling
    // ============================================================

    function ensureStyle() {
      if (document.getElementById('lcpp-v2-style')) return;
      const s = document.createElement('style');
      s.id = 'lcpp-v2-style';
      s.textContent = `
        html[${ROOT_FLAG}="1"] {
          --lcpp-turn-intrinsic: 640px;
        }

        /* Conservative turn containment for genuinely heavy pages. */
        html[${ROOT_FLAG}="1"][${ROOT_PRESSURE}="2"] main section[data-testid^="conversation-turn-"],
        html[${ROOT_FLAG}="1"][${ROOT_PRESSURE}="2"] main article[data-testid^="conversation-turn-"],
        html[${ROOT_FLAG}="1"][${ROOT_PRESSURE}="3"] main section[data-testid^="conversation-turn-"],
        html[${ROOT_FLAG}="1"][${ROOT_PRESSURE}="3"] main article[data-testid^="conversation-turn-"] {
          contain-intrinsic-size: auto var(--lcpp-turn-intrinsic);
        }

        /* Expensive code/table blocks: skip layout/paint when they are offscreen. */
        html[${ROOT_FLAG}="1"][${ROOT_PRESSURE}="2"] main pre,
        html[${ROOT_FLAG}="1"][${ROOT_PRESSURE}="2"] main table,
        html[${ROOT_FLAG}="1"][${ROOT_PRESSURE}="3"] main pre,
        html[${ROOT_FLAG}="1"][${ROOT_PRESSURE}="3"] main table {
          contain: layout paint;
          content-visibility: auto;
          contain-intrinsic-size: 1px 700px;
        }

        /* Math is kept visible for reliability; only isolate its paint/style cost. */
        html[${ROOT_FLAG}="1"][${ROOT_PRESSURE}="2"] main .katex-display,
        html[${ROOT_FLAG}="1"][${ROOT_PRESSURE}="2"] main mjx-container,
        html[${ROOT_FLAG}="1"][${ROOT_PRESSURE}="3"] main .katex-display,
        html[${ROOT_FLAG}="1"][${ROOT_PRESSURE}="3"] main mjx-container {
          contain: paint style;
        }

        html[${ROOT_FLAG}="1"] main .katex-display > .katex {
          overflow-x: auto;
          overflow-y: hidden;
        }

        /* During an interaction hot path, spend essentially nothing on animation. */
        html[${ROOT_FLAG}="1"][${ROOT_HOT}="1"] main *,
        html[${ROOT_FLAG}="1"][${ROOT_PRESSURE}="3"] main * {
          animation-duration: 0.001ms !important;
          transition-duration: 0.001ms !important;
          scroll-behavior: auto !important;
        }
      `;
      document.head.appendChild(s);
    }

    // ============================================================
    // Scroll handling
    // ============================================================

    function findScrollableAncestor(node) {
      let el = node?.parentElement || null;
      while (el && el !== document.documentElement) {
        try {
          const cs = getComputedStyle(el);
          const oy = cs.overflowY;
          if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 2) return el;
        } catch {}
        el = el.parentElement;
      }
      return null;
    }

    function resolveScrollContainer() {
      const turns = getTurns();
      const probe = turns.length ? turns[turns.length - 1] : document.body;
      const next = findScrollableAncestor(probe);

      if (next === scrollContainer) return;

      try {
        if (scrollAttachedTarget) scrollAttachedTarget.removeEventListener('scroll', onScroll);
      } catch {}
      try {
        window.removeEventListener('scroll', onScroll);
      } catch {}

      scrollContainer = next;
      const target = scrollContainer || window;
      target.addEventListener('scroll', onScroll, { passive: true });
      scrollAttachedTarget = target;
    }

    function getScrollTop() {
      return scrollContainer
        ? scrollContainer.scrollTop
        : (window.scrollY || document.documentElement.scrollTop || 0);
    }

    function setScrollTop(value) {
      const v = Math.max(0, value || 0);
      if (scrollContainer) scrollContainer.scrollTop = v;
      else window.scrollTo({ top: v, left: 0, behavior: 'auto' });
    }

    function getScrollHeight() {
      return scrollContainer
        ? scrollContainer.scrollHeight
        : (document.scrollingElement || document.documentElement || document.body).scrollHeight;
    }

    function getViewportHeight() {
      return scrollContainer ? scrollContainer.clientHeight : window.innerHeight;
    }

    function scrollToBottom() {
      setScrollTop(getScrollHeight());
    }

    function isNearBottom(threshold = BOTTOM_RECOLLAPSE_THRESHOLD) {
      const remaining = getScrollHeight() - (getScrollTop() + getViewportHeight());
      return remaining <= threshold;
    }

    function viewportTop() {
      return scrollContainer ? scrollContainer.getBoundingClientRect().top : 0;
    }

    function findAnchorElement() {
      const vt = viewportTop();
      for (const el of getTurns()) {
        try {
          const r = el.getBoundingClientRect();
          if (r.bottom > vt + 1 && r.height > 0) return el;
        } catch {}
      }
      return null;
    }

    function withAnchorCompensation(preserve, action) {
      if (!preserve) {
        action();
        return;
      }

      resolveScrollContainer();
      const anchor = findAnchorElement();
      const vt = viewportTop();
      let before = null;

      if (anchor) {
        try {
          before = anchor.getBoundingClientRect().top - vt;
        } catch {}
      }

      action();

      if (!anchor || !anchor.isConnected || before == null) return;

      try {
        const after = anchor.getBoundingClientRect().top - vt;
        const delta = after - before;
        if (Math.abs(delta) > 0.5) setScrollTop(getScrollTop() + delta);
      } catch {}
    }

    // ============================================================
    // Detach / restore
    // ============================================================

    function restoreSome(count) {
      if (!count || !hiddenStore.length) return 0;

      const start = Math.max(0, hiddenStore.length - count);
      const batch = hiddenStore.slice(start);
      hiddenStore.length = start;

      let restored = 0;
      for (const item of batch) {
        try {
          if (item.placeholder?.isConnected) {
            item.placeholder.replaceWith(item.node);
            restored += 1;
          }
        } catch {}
      }
      return restored;
    }

    function restoreAll() {
      return restoreSome(hiddenStore.length);
    }

    function getAllTurnNodes() {
      const nodes = [...hiddenStore.map((item) => item.node), ...getTurns()];
      const seen = new Set();
      return nodes.filter((node) => node instanceof HTMLElement && !seen.has(node) && seen.add(node));
    }

    function revealAllForNavigation() {
      const total = getTotalTurns();
      const base = currentRetain(total);
      revealExtra = Math.max(0, total - base);
      const restored = restoreAll();
      markInteractionHot(3200);
      resolveScrollContainer();
      publishDebugAttrs(total, total);
      requestAnimationFrame(() => {
        refreshObserverRoot();
        resolveScrollContainer();
      });
      return restored;
    }

    function exposeUnifiedBridge() {
      const runtime = globalThis.__cgptUnifiedRuntimeV1;
      if (!runtime) return;
      runtime.lazy = {
        getAllTurnNodes,
        revealAllForNavigation,
        getDebugState: () => ({
          totalTurns: getTotalTurns(),
          liveTurns: getTurns().length,
          parkedTurns: hiddenStore.length,
          pressureLevel,
          metrics: lastMetrics,
        }),
      };
    }

    function detachFirstN(turns, count) {
      const limit = Math.min(count, MAX_DETACH_PER_IDLE, turns.length);
      let detached = 0;

      for (let i = 0; i < limit; i += 1) {
        const el = turns[i];
        try {
          if (!(el instanceof HTMLElement) || !el.parentNode) continue;
          const placeholder = document.createComment('lcpp-v2-detached');
          el.parentNode.insertBefore(placeholder, el);
          el.remove();
          hiddenStore.push({ placeholder, node: el });
          detached += 1;
        } catch {}
      }

      return detached;
    }

    // ============================================================
    // Apply scheduler
    // ============================================================

    function mergePending(opts = {}) {
      if (!pendingApply) pendingApply = { preserveAnchor: false, force: false };
      pendingApply.preserveAnchor ||= !!opts.preserveAnchor;
      pendingApply.force ||= !!opts.force;
    }

    function scheduleApply(opts = {}) {
      mergePending(opts);

      if (isStreaming || isInteractionHot()) return;
      if (applyIdleHandle || applyTimeoutHandle) return;

      const run = () => {
        applyIdleHandle = 0;
        applyTimeoutHandle = 0;

        if (isStreaming || isInteractionHot()) return;

        const payload = pendingApply || {};
        pendingApply = null;
        apply(payload);
      };

      if ('requestIdleCallback' in window) {
        try {
          applyIdleHandle = requestIdleCallback(run, { timeout: 180 });
        } catch {
          applyTimeoutHandle = setTimeout(run, 60);
        }
      } else {
        applyTimeoutHandle = setTimeout(run, 60);
      }
    }

    function apply({ preserveAnchor = false, force = false } = {}) {
      if (isStreaming || isInteractionHot()) return;

      resolveScrollContainer();

      const turns = getTurns();
      const total = turns.length + hiddenStore.length;
      if (!total) return;

      const desired = desiredVisibleCount(total);
      const currentConnected = turns.length;
      const currentHidden = hiddenStore.length;
      const targetHidden = Math.max(0, total - desired);

      // Need more old turns visible.
      if (currentHidden > targetHidden) {
        const needRestore = currentHidden - targetHidden;
        withAnchorCompensation(preserveAnchor, () => restoreSome(needRestore));
      }

      // Need fewer connected turns.
      const afterRestore = getTurns();
      const needDetach = Math.max(0, afterRestore.length - desired);
      if (needDetach > 0) {
        const nearBottomBefore = isNearBottom();
        withAnchorCompensation(preserveAnchor && !nearBottomBefore, () => {
          detachFirstN(getTurns(), needDetach);
        });

        if (nearBottomBefore) requestAnimationFrame(scrollToBottom);

        // Chunk very large initial cleanups.
        if (needDetach > MAX_DETACH_PER_IDLE) {
          scheduleApply({ preserveAnchor: false, force: true });
        }
      }

      publishDebugAttrs(total, desired);

      if (force) {
        // Re-resolve because ChatGPT may replace its scroll/feed container after large changes.
        requestAnimationFrame(resolveScrollContainer);
      }
    }

    // ============================================================
    // Infinite upward reveal + auto recollapse
    // ============================================================

    function revealMoreUp() {
      if (isStreaming || isInteractionHot()) return;

      const total = getTotalTurns();
      const base = currentRetain(total);
      const maxExtra = Math.max(0, total - base);
      if (revealExtra >= maxExtra) return;

      revealExtra = Math.min(maxExtra, revealExtra + REVEAL_BATCH);
      scheduleApply({ preserveAnchor: true, force: true });
    }

    function cancelRecollapse() {
      if (recollapseTimer) clearTimeout(recollapseTimer);
      recollapseTimer = 0;
    }

    function scheduleRecollapse() {
      if (revealExtra <= 0) return;
      cancelRecollapse();

      recollapseTimer = setTimeout(() => {
        recollapseTimer = 0;
        if (isStreaming || isInteractionHot() || !isNearBottom()) return;
        revealExtra = 0;
        scheduleApply({ preserveAnchor: false, force: true });
      }, RECOLLAPSE_DELAY_MS);
    }

    let scrollDebounceTimer = 0;
    function onScroll() {
      if (scrollDebounceTimer) clearTimeout(scrollDebounceTimer);
      scrollDebounceTimer = setTimeout(() => {
        scrollDebounceTimer = 0;

        if (isStreaming || isInteractionHot()) return;

        if (getScrollTop() <= TOP_REVEAL_THRESHOLD) {
          cancelRecollapse();
          revealMoreUp();
          return;
        }

        if (revealExtra > 0 && isNearBottom()) scheduleRecollapse();
        else cancelRecollapse();
      }, 85);
    }

    // ============================================================
    // Streaming HARD PAUSE
    // ============================================================

    function recomputeStreamingState() {
      const next = hasStopButton();

      if (next) {
        if (!isStreaming) {
          isStreaming = true;
          setRootAttr(ROOT_STREAMING, '1');
        }
        if (streamEndTimer) clearTimeout(streamEndTimer);
        streamEndTimer = 0;
        return;
      }

      if (!isStreaming || streamEndTimer) return;

      streamEndTimer = setTimeout(() => {
        streamEndTimer = 0;
        isStreaming = false;
        setRootAttr(ROOT_STREAMING, '0');

        // Generation finished: if the user is at the bottom, immediately return
        // to the lean adaptive window.
        if (isNearBottom()) revealExtra = 0;
        scheduleApply({ preserveAnchor: false, force: true });
        schedulePressureScan(500);
      }, STREAM_END_COOLDOWN_MS);
    }

    // ============================================================
    // Pressure sensing
    // ============================================================

    function pruneLongTasks() {
      const cutoff = now() - LONG_TASK_WINDOW_MS;
      longTasks = longTasks.filter((x) => x.at >= cutoff);
      let max = 0;
      let total = 0;
      for (const x of longTasks) {
        max = Math.max(max, x.duration);
        total += x.duration;
      }
      return { count: longTasks.length, max, total };
    }

    function countElementNodesCapped(roots, cap = NODE_COUNT_CAP) {
      let count = 0;
      let capped = false;

      try {
        for (const root of roots) {
          if (!(root instanceof HTMLElement)) continue;
          count += 1;
          if (count >= cap) return { count, capped: true };

          const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
          while (walker.nextNode()) {
            count += 1;
            if (count >= cap) {
              capped = true;
              break;
            }
          }
          if (capped) break;
        }
      } catch {}

      return { count, capped };
    }

    function countSelectorCapped(roots, selector, cap) {
      let count = 0;
      const seen = new Set();

      try {
        for (const root of roots) {
          if (!(root instanceof HTMLElement)) continue;

          if (root.matches?.(selector) && !seen.has(root)) {
            seen.add(root);
            count += 1;
            if (count >= cap) return count;
          }

          const nodes = root.querySelectorAll(selector);
          for (const el of nodes) {
            if (seen.has(el)) continue;
            seen.add(el);
            count += 1;
            if (count >= cap) return count;
          }
        }
      } catch {}

      return count;
    }

    function classifyPressure(metrics) {
      let level = 0;

      if (
        metrics.totalTurns >= 90 ||
        metrics.nodeCount >= 12000 ||
        metrics.mathCount >= 160 ||
        metrics.longTaskMax >= 180
      ) {
        level = 3;
      } else if (
        metrics.totalTurns >= 45 ||
        metrics.nodeCount >= 7500 ||
        metrics.mathCount >= 80 ||
        metrics.codeCount >= 28 ||
        metrics.longTaskMax >= 100 ||
        metrics.longTaskCount >= 3
      ) {
        level = 2;
      } else if (
        metrics.totalTurns >= 20 ||
        metrics.nodeCount >= 3500 ||
        metrics.mathCount >= 30 ||
        metrics.codeCount >= 12 ||
        metrics.longTaskMax >= 50 ||
        metrics.longTaskCount >= 1
      ) {
        level = 1;
      }

      return level;
    }

    function publishDebugAttrs(total = getTotalTurns(), desired = desiredVisibleCount(total)) {
      setRootAttr(ROOT_FLAG, '1');
      setRootAttr(ROOT_PRESSURE, String(pressureLevel));
      setRootAttr(ROOT_HOT, isInteractionHot() ? '1' : '0');
      setRootAttr(ROOT_STREAMING, isStreaming ? '1' : '0');

      // Tiny diagnostic attributes only. No visible UI.
      setRootAttr('data-lcpp-total-turns', total);
      setRootAttr('data-lcpp-live-turns', getTurns().length);
      setRootAttr('data-lcpp-parked-turns', hiddenStore.length);
      setRootAttr('data-lcpp-target-turns', desired);
      setRootAttr('data-lcpp-version', VERSION);
    }

    function scanPressureNow() {
      if (document.hidden || isStreaming || isInteractionHot()) {
        schedulePressureScan(1400);
        return;
      }

      const roots = getTurns();
      const totalTurns = roots.length + hiddenStore.length;
      if (!totalTurns) {
        schedulePressureScan(PRESSURE_SCAN_MS);
        return;
      }

      // Only scan currently connected turns. Parked/detached turns no longer
      // participate in layout/paint and should not inflate the live pressure score.
      const nodeInfo = countElementNodesCapped(roots, NODE_COUNT_CAP);
      const mathCount = countSelectorCapped(roots, MATH_SELECTOR, MATH_COUNT_CAP);
      const codeCount = countSelectorCapped(roots, CODE_SELECTOR, CODE_COUNT_CAP);
      const lt = pruneLongTasks();

      const metrics = {
        at: now(),
        totalTurns,
        liveTurns: roots.length,
        parkedTurns: hiddenStore.length,
        nodeCount: nodeInfo.count,
        nodeCountCapped: nodeInfo.capped,
        mathCount,
        codeCount,
        longTaskCount: lt.count,
        longTaskMax: Math.round(lt.max),
        longTaskTotal: Math.round(lt.total)
      };

      const nextPressure = classifyPressure(metrics);
      const changed = nextPressure !== pressureLevel;
      pressureLevel = nextPressure;
      lastMetrics = metrics;

      publishDebugAttrs();

      // Only collapse harder automatically when at/near the bottom.
      // If the user is reading history, preserve the expanded window.
      if (changed && isNearBottom()) {
        revealExtra = 0;
        scheduleApply({ preserveAnchor: false, force: true });
      }

      schedulePressureScan(PRESSURE_SCAN_MS);
    }

    function schedulePressureScan(delay = PRESSURE_SCAN_MS) {
      if (pressureTimer) clearTimeout(pressureTimer);

      pressureTimer = setTimeout(() => {
        pressureTimer = 0;

        const run = () => scanPressureNow();
        if ('requestIdleCallback' in window && !isStreaming && !isInteractionHot()) {
          try {
            requestIdleCallback(run, { timeout: 900 });
          } catch {
            setTimeout(run, 0);
          }
        } else {
          setTimeout(run, 0);
        }
      }, Math.max(120, delay));
    }

    function startLongTaskObserver() {
      if (
        typeof PerformanceObserver !== 'function' ||
        !Array.isArray(PerformanceObserver.supportedEntryTypes) ||
        !PerformanceObserver.supportedEntryTypes.includes('longtask')
      ) return;

      try {
        longTaskObserver = new PerformanceObserver((list) => {
          const t = now();
          for (const entry of list.getEntries()) {
            const duration = Number(entry.duration || 0);
            if (duration >= 35) longTasks.push({ at: t, duration });
          }
          pruneLongTasks();

          // Don't scan immediately while the user is typing; just remember the signal.
          if (!isStreaming && !isInteractionHot()) schedulePressureScan(700);
        });
        longTaskObserver.observe({ type: 'longtask', buffered: false });
      } catch {
        longTaskObserver = null;
      }
    }

    // ============================================================
    // DOM observer
    // ============================================================

    let obsDebounceTimer = 0;

    function attachObserver(root) {
      try {
        observer?.disconnect();
      } catch {}
      observer = null;

      if (!(root instanceof Node)) root = document.documentElement;

      try {
        observer = new MutationObserver(() => {
          if (isStreaming || isInteractionHot()) return;

          if (obsDebounceTimer) clearTimeout(obsDebounceTimer);
          obsDebounceTimer = setTimeout(() => {
            obsDebounceTimer = 0;
            scheduleApply({ preserveAnchor: false, force: false });
          }, OBS_DEBOUNCE_MS);
        });

        // Child-list changes only. No characterData / attributes.
        // When possible, use the feed/list root so token-by-token streaming mutations
        // inside the last message do not trigger us.
        observer.observe(root, { childList: true, subtree: root === document.documentElement });
        observerRoot = root;
      } catch {
        observer = null;
        observerRoot = null;
      }
    }

    function refreshObserverRoot() {
      const root = pickFeedRoot();
      if (root && root !== observerRoot) attachObserver(root);
    }

    // ============================================================
    // Input/action hot-path listeners
    // ============================================================

    function installInteractionListeners() {
      window.addEventListener('pointerdown', (e) => {
        if (isComposerTarget(e.target)) {
          markInteractionHot(INPUT_HOT_MS);
          return;
        }
        if (isHeavyActionTarget(e.target)) markInteractionHot(ACTION_HOT_MS);
      }, true);

      document.addEventListener('input', (e) => {
        if (isComposerTarget(e.target)) markInteractionHot(INPUT_HOT_MS);
      }, true);

      document.addEventListener('keydown', (e) => {
        if (!isComposerTarget(e.target) && !isComposerTarget(document.activeElement)) return;
        markInteractionHot(e.key === 'Enter' ? ACTION_HOT_MS : INPUT_HOT_MS);
      }, true);

      document.addEventListener('focusin', (e) => {
        if (isComposerTarget(e.target)) markInteractionHot(700);
      }, true);

      document.addEventListener('focusout', (e) => {
        if (!isComposerTarget(e.target)) return;
        inputHotUntil = Math.min(inputHotUntil, now() + 180);
      }, true);
    }

    // ============================================================
    // SPA route handling
    // ============================================================

    function resetForRouteChange() {
      // The old page is being replaced by ChatGPT. Drop references to detached
      // nodes from the old route so the browser is free to collect them.
      hiddenStore.length = 0;
      revealExtra = 0;
      pressureLevel = 0;
      lastMetrics = null;
      cancelRecollapse();

      try {
        observer?.disconnect();
      } catch {}
      observer = null;
      observerRoot = null;

      setTimeout(() => {
        refreshObserverRoot();
        resolveScrollContainer();
        scheduleApply({ preserveAnchor: false, force: true });
        schedulePressureScan(900);
      }, 320);
    }

    function startRouteWatch() {
      routeTimer = setInterval(() => {
        const next = location.href;
        if (next !== routeKey) {
          routeKey = next;
          resetForRouteChange();
          return;
        }

        // ChatGPT sometimes replaces the feed without changing the URL.
        refreshObserverRoot();
      }, ROUTE_POLL_MS);
    }

    // Keep the original Lazy Chat++ safety behavior: clicking a conversation
    // in the sidebar performs a full navigation. This prevents a SPA route swap
    // from inheriting detached DOM state from another conversation.
    const SIDEBAR_SCOPE_SEL = 'nav[aria-label="Chat history"], #history, [class*="sidebar-width"]';

    function isInsideSidebar(node) {
      return !!(node && node.closest?.(SIDEBAR_SCOPE_SEL));
    }

    function isInternalHref(href) {
      if (!href || /^(mailto:|javascript:|data:)/i.test(href) || href.startsWith('#')) return false;
      if (href.startsWith('/')) return true;
      try {
        return new URL(href, location.origin).origin === location.origin;
      } catch {
        return false;
      }
    }

    function isInteractiveBeforeAnchor(target, anchor) {
      let el = target;
      while (el && el !== anchor) {
        try {
          if (el.matches('button, [role="button"], summary, input, select, textarea, label, [aria-expanded], [aria-haspopup], [data-trailing-button], [data-testid*="toggle"], [data-testid*="menu"]')) {
            return true;
          }
        } catch {}
        el = el.parentElement;
      }
      return false;
    }

    document.addEventListener('click', (ev) => {
      if (ev.defaultPrevented) return;
      if (ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;

      const target = ev.target;
      const link = target?.closest?.('a[href]');
      if (!link) return;
      if (!isInsideSidebar(target)) return;
      if (isInteractiveBeforeAnchor(target, link)) return;

      const href = link.getAttribute('href');
      if (!isInternalHref(href) || link.target === '_blank') return;

      ev.preventDefault();
      location.assign(href);
    }, true);

    // ============================================================
    // Boot
    // ============================================================

    function boot() {
      exposeUnifiedBridge();
      ensureStyle();
      setRootAttr(ROOT_FLAG, '1');
      setRootAttr(ROOT_PRESSURE, '0');
      setRootAttr(ROOT_HOT, '0');
      setRootAttr(ROOT_STREAMING, '0');

      installInteractionListeners();
      startLongTaskObserver();

      refreshObserverRoot();
      resolveScrollContainer();

      // First pass uses turn count immediately, without an expensive full scan.
      scheduleApply({ preserveAnchor: false, force: true });
      schedulePressureScan(1000);

      setInterval(recomputeStreamingState, STREAM_POLL_MS);
      startRouteWatch();

      // Hydration safety: locate the real feed as soon as it appears.
      let tries = 50;
      const hydrationPoll = setInterval(() => {
        refreshObserverRoot();
        resolveScrollContainer();

        if (!isStreaming && !isInteractionHot()) {
          scheduleApply({ preserveAnchor: false, force: false });
        }

        if (getTurns().length > 0 || --tries <= 0) clearInterval(hydrationPoll);
      }, 260);
    }

    if (document.readyState === 'complete' || document.readyState === 'interactive') {
      boot();
    } else {
      window.addEventListener('DOMContentLoaded', boot, { once: true });
    }
  }
})();


/* ===== Module 3: typography, renderer fixes, and cooperative scroll lock ===== */

(function () {
  'use strict';

  const STYLE_ID = 'cgfc-ophel-optimized-style';
  const TOGGLE_ID = 'cgfc-toggle';
  const PANEL_ID = 'cgfc-panel';
  const FONT_STATUS_ID = 'cgfc-font-scan-status';
  const HIDDEN_NOTICE_CLASS = 'ophel-clean-mode-version-notice-hidden';
  const CHATGPT_DISCLAIMER_TEXT = 'ChatGPT 也可能会犯错。请核查重要信息。';
  const CHATGPT_DISCLAIMER_KEY = CHATGPT_DISCLAIMER_TEXT.replace(/\s+/g, '');
  const HIDDEN_DISCLAIMER_CLASS = 'ophel-chatgpt-disclaimer-hidden';
  const CLEAN_MODE_STYLE_ID = 'gh-clean-mode-styles';
  const KATEX_STYLE_ID = 'cgfc-katex-resource-style';
  const RESIDUAL_WRAPPER_CLASS = 'cgfc-residual-latex';
  const RESIDUAL_ROOT_MARKER = 'data-cgfc-residual-root';
  const RESIDUAL_DEBOUNCE_MS = 180;
  const RESIDUAL_MAX_TEXT_NODES = 300;
  const STORAGE_KEY = 'chatgpt_font_customizer_settings_v2';
  const USER_SCROLL_GRACE_MS = 700;
  const SCROLL_EPSILON_PX = 8;
  const GENERATION_CHECK_MS = 1000;
  const API_GUARD_MS = 2000;
  const FONT_BRIDGE_SOURCE = 'cgfc-font-bridge-v1';
  const FONT_BRIDGE_REQUEST = 'getFontList';
  const FONT_BRIDGE_TIMEOUT_MS = 2500;
  const FONT_FACE_VERIFY_TIMEOUT_MS = 900;
  const FONT_FACE_VERIFY_CONCURRENCY = 14;

  const defaults = {
    latinFont: '"Times New Roman", "Noto Serif"',
    chineseFont: '"Noto Serif SC", "Source Han Serif SC", "Songti SC", serif',
    boldLatinFont: '"Times New Roman", "Noto Serif"',
    boldChineseFont: '"Noto Serif SC", "Source Han Serif SC", "Songti SC", serif',
    mathFont: '"Cambria Math", "STIX Two Math", "Latin Modern Math", serif',
    mathFontMode: 'native',
    codeFont: '"JetBrains Mono"',
    fontSize: 26,
    lineHeight: 1.9,
    codeFontSize: 18,
    codeLineHeight: 1.8,
    normalColor: '#ffffff',
    boldColor: '#e8e2d8',
    boldWeight: 750,
    fixOuterScroll: true,
    stopAutoScrollWhileGenerating: true,
    wrapCode: true,
    hideVersionNotice: true,
    enableFontSmoothing: true,
    fontSmoothingMode: 'antialiased',
    textRenderingMode: 'optimizeLegibility',
    enableResidualLatex: true,
    enableKatexLetterFont: true,
  };

  const settingTypes = {
    latinFont: 'text',
    chineseFont: 'text',
    boldLatinFont: 'text',
    boldChineseFont: 'text',
    mathFont: 'text',
    mathFontMode: 'select',
    codeFont: 'text',
    fontSize: 'number',
    lineHeight: 'number',
    codeFontSize: 'number',
    codeLineHeight: 'number',
    normalColor: 'color',
    boldColor: 'color',
    boldWeight: 'number',
    fixOuterScroll: 'boolean',
    stopAutoScrollWhileGenerating: 'boolean',
    wrapCode: 'boolean',
    hideVersionNotice: 'boolean',
    enableFontSmoothing: 'boolean',
    fontSmoothingMode: 'select',
    textRenderingMode: 'select',
    enableResidualLatex: 'boolean',
    enableKatexLetterFont: 'boolean',
  };

  const numberLimits = {
    fontSize: [10, 40],
    lineHeight: [1, 2.8],
    codeFontSize: [10, 32],
    codeLineHeight: [1, 2.8],
    boldWeight: [400, 1000],
  };

  const selectValues = {
    mathFontMode: ['native', 'off'],
    fontSmoothingMode: ['auto', 'antialiased', 'subpixel-antialiased'],
    textRenderingMode: ['auto', 'optimizeLegibility', 'geometricPrecision'],
  };

  const versionNoticeText = [
    '新的 GPT 版本现已推出',
    '继续聊天以使用旧版本',
    '开始新的聊天以使用最新版本',
    'A new version of GPT is available',
    'Continue chatting to use the old version',
    'Start a new chat to use the latest version',
  ];

  const FONT_SETTING_KEYS = new Set([
    'latinFont', 'chineseFont', 'boldLatinFont', 'boldChineseFont', 'mathFont', 'codeFont',
  ]);
  const LOCAL_FONT_RESCUE_GROUPS = [
    {
      label: 'Commit Mono',
      names: ['Commit Mono', 'CommitMono', 'CommitMonoV143', 'Commit Mono V143'],
    },
    {
      label: 'IBM Plex Mono',
      names: ['IBM Plex Mono'],
    },
    {
      label: 'Maple Mono',
      names: [
        'Maple Mono', 'Maple Mono NF', 'Maple Mono NF CN', 'Maple Mono CN',
        'Maple Mono NF Mono', 'Maple Mono Normal', 'Maple Mono Normal NF', 'Maple Mono Normal NF CN',
      ],
    },
  ];
  const LOCAL_FONT_RESCUE_CANDIDATE_NAMES = Array.from(new Set(
    LOCAL_FONT_RESCUE_GROUPS.flatMap((group) => group.names),
  ));

  const KNOWN_LOCAL_FONT_CANDIDATES = [
    'Arial', 'Bookerly', 'Calibri', 'Cambria', 'Cambria Math', 'Cascadia Code', 'Cascadia Mono',
    'Commit Mono', 'CommitMono', 'CommitMonoV143', 'IBM Plex Mono', 'Maple Mono', 'Maple Mono NF',
    'Maple Mono NF CN', 'Maple Mono CN',
    'Consolas', 'DengXian', 'FangSong', 'Georgia', 'JetBrains Mono', 'KaiTi', 'Latin Modern Math',
    'Microsoft JhengHei', 'Microsoft YaHei', 'Microsoft YaHei UI', 'Noto Sans CJK SC',
    'Noto Sans SC', 'Noto Serif CJK SC', 'Noto Serif SC', 'Palatino Linotype', 'Segoe UI',
    'SimHei', 'SimSun', 'Songti SC', 'Source Han Sans CN', 'Source Han Sans SC',
    'Source Han Serif CN', 'Source Han Serif SC', 'STIX Two Math', 'STSong', 'Times New Roman',
    // Exact CJK family names reported by Windows on this machine. These are
    // tested at runtime, not assumed to exist on other computers.
    '等线', '等线 Light', '方正屏显雅宋简体', '方正舒体', '方正宋圆 简', '方正新書宋',
    '方正姚体', '方正悠宋 简 508R', '仿宋', '黑体', '华文彩云', '华文仿宋', '华文琥珀',
    '华文楷体', '华文隶书', '华文宋体', '华文细黑', '华文新魏', '华文行楷', '华文中宋',
    '楷体', '隶书', '思源宋体 CN', '思源宋体 CN ExtraLight', '思源宋体 CN Heavy',
    '思源宋体 CN Light', '思源宋体 CN Medium', '思源宋体 CN SemiBold', '宋体', '微软雅黑',
    '微软雅黑 Light', '微軟正黑體', '微軟正黑體 Light', '細明體_HKSCS-ExtB',
    '細明體_MSCS-ExtB', '細明體-ExtB', '霞鹜新致宋', '霞鹜新致宋＋', '新宋体',
    '新細明體-ExtB', '幼圆', 'Microsoft JhengHei UI', 'Microsoft JhengHei UI Light',
    'Microsoft YaHei UI', 'Microsoft YaHei UI Light', 'Noto Sans SC Black',
    'Noto Sans SC DemiLight', 'Noto Sans SC Light', 'Noto Sans SC Medium', 'Noto Sans SC Thin',
    'Noto Serif SC Black', 'Noto Serif SC ExtraLight', 'Noto Serif SC Light',
    'Noto Serif SC Medium', 'Noto Serif SC SemiBold', 'SimSun-ExtB', 'SimSun-ExtG',
  ];

  // Generic fallback candidates only; no machine-specific font inventory is embedded.
  // The browser still verifies
  // each family at runtime, and API/extension results are merged without
  // deleting this fallback set.
  const WINDOWS_FONT_FAMILY_SNAPSHOT = KNOWN_LOCAL_FONT_CANDIDATES.slice();

  let settings = loadSettings();
  let saveTimer = 0;
  let noticeTimer = 0;
  let disclaimerTimer = 0;
  let shellGuardTimer = 0;
  let observersStarted = false;
  let residualLatexObserverStarted = false;
  let residualLatexTimer = 0;
  let detectedFontFamilies = [];
  const detectedFontAliases = new Map();
  const detectedFontLabels = new Map();
  const verifiedFontFamilies = new Set();
  const fallbackFontFamilies = new Set();
  let fontDetectionMode = 'candidate';
  let fontSearchQuery = '';
  let lastApiFontCount = 0;
  let lastApiFontFaceCount = 0;
  let lastFallbackVerifiedCount = 0;
  let lastRescueVerifiedCount = 0;
  let lastExtensionFontCount = 0;
  let lastExtensionStatus = 'not-detected';
  const residualLatexRoots = new Set();
  const residualRootWork = new WeakMap();
  const residualSelfMutationCounts = new WeakMap();
  let refreshAutoScrollLockState = () => {};

  function clamp(value, min, max, fallback) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.min(max, parsed));
  }

  function sanitizeFontStack(value, fallback) {
    const text = String(value || '')
      .replace(/[\u0000-\u001f\u007f<>\\{};]/g, '')
      .replace(/!\s*important/gi, '')
      .slice(0, 300)
      .trim();
    if (!text) return fallback;
    if (typeof CSS !== 'undefined' && CSS.supports && !CSS.supports('font-family', text)) return fallback;
    return text;
  }

  function stripGenericFontFallbacks(value, fallback) {
    const sanitized = sanitizeFontStack(value, fallback);
    const genericFamilies = new Set([
      'serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui',
      'ui-serif', 'ui-sans-serif', 'ui-monospace', 'emoji', 'math', 'fangsong',
    ]);
    const specificFamilies = sanitized
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part && !genericFamilies.has(part.toLowerCase()));
    return specificFamilies.length ? specificFamilies.join(', ') : fallback;
  }

  function sanitizeColor(value, fallback) {
    const text = String(value || '').trim();
    return /^#[0-9a-f]{6}$/i.test(text) ? text : fallback;
  }

  function readStore(key, fallback) {
    try {
      if (typeof GM_getValue === 'function') return GM_getValue(key, fallback);
    } catch (_) {
      // Fall through to localStorage.
    }

    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (_) {
      return fallback;
    }
  }

  function writeStore(key, value) {
    try {
      if (typeof GM_setValue === 'function') {
        GM_setValue(key, value);
        return;
      }
    } catch (_) {
      // Fall through to localStorage.
    }

    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (_) {
      // Ignore storage failures; the live UI still works for this page.
    }
  }

  function normalizeSetting(key, value) {
    const type = settingTypes[key];

    if (type === 'number') {
      const [min, max] = numberLimits[key];
      return clamp(value, min, max, defaults[key]);
    }

    if (type === 'boolean') {
      if (value === false || value === 0 || value === '0' || value === 'false') return false;
      if (value === true || value === 1 || value === '1' || value === 'true') return true;
      return defaults[key];
    }
    if (type === 'select') {
      return selectValues[key]?.includes(value) ? value : defaults[key];
    }
    if (type === 'color') return sanitizeColor(value, defaults[key]);
    if (['latinFont', 'chineseFont', 'boldLatinFont', 'boldChineseFont', 'mathFont', 'codeFont'].includes(key)) {
      return sanitizeFontStack(value, defaults[key]);
    }
    return String(value ?? defaults[key]);
  }

  function getMozFontSmoothing(mode) {
    return mode === 'antialiased' ? 'grayscale' : 'auto';
  }

  function loadSettings() {
    const stored = readStore(STORAGE_KEY, {});
    const saved = stored && typeof stored === 'object' ? { ...stored } : {};
    const next = { ...defaults };

    // v3 exposed KaTeX-wide font overrides. They could hide KaTeX private-use
    // glyphs (for example the slash used by \ne and \neq), so migrate both old
    // modes to the renderer-safe native MathML mode.
    if (saved?.mathFontMode === 'compatible' || saved?.mathFontMode === 'force') {
      saved.mathFontMode = 'native';
    }

    // v4.1 and earlier used one bodyFont setting. Preserve that choice as the
    // Chinese and bold-Chinese fallback while introducing independent Latin
    // and bold-Latin stacks.
    if (saved.bodyFont) {
      if (!saved.chineseFont) saved.chineseFont = saved.bodyFont;
      if (!saved.boldChineseFont) saved.boldChineseFont = saved.bodyFont;
    }

    Object.keys(defaults).forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(saved || {}, key)) {
        next[key] = normalizeSetting(key, saved[key]);
      }
    });

    return next;
  }

  function persistSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => writeStore(STORAGE_KEY, settings), 180);
  }

  function installStaticStyles() {
    let style = document.getElementById(STYLE_ID);
    if (!style) {
      style = document.createElement('style');
      style.id = STYLE_ID;
    }

    const parent = document.head || document.documentElement;
    if (!parent) return false;
    if (style.parentNode !== parent) parent.appendChild(style);
    if (style.textContent === STATIC_CSS) return true;

    style.textContent = STATIC_CSS;
    return true;
  }

  function hasInternalScrollContainer() {
    const candidates = document.querySelectorAll(
      'main, [role="main"], [data-scroll-root], [class*="overflow-y-auto"], [class*="overflow-auto"]'
    );
    for (const element of candidates) {
      const style = getComputedStyle(element);
      if (/(auto|scroll|overlay)/.test(`${style.overflowY} ${style.overflow}`) && element.clientHeight > 0) {
        return true;
      }
    }
    return false;
  }

  function applySettings() {
    const root = document.documentElement;
    if (!root) return false;
    installStaticStyles();

    root.style.setProperty('--cgfc-latin-font', stripGenericFontFallbacks(settings.latinFont, defaults.latinFont));
    root.style.setProperty('--cgfc-chinese-font', sanitizeFontStack(settings.chineseFont, defaults.chineseFont));
    root.style.setProperty('--cgfc-bold-latin-font', stripGenericFontFallbacks(settings.boldLatinFont, defaults.boldLatinFont));
    root.style.setProperty('--cgfc-bold-chinese-font', sanitizeFontStack(settings.boldChineseFont, defaults.boldChineseFont));
    root.style.setProperty('--cgfc-math-font', sanitizeFontStack(settings.mathFont, defaults.mathFont));
    root.style.setProperty('--cgfc-code-font', sanitizeFontStack(settings.codeFont, defaults.codeFont));
    root.style.setProperty('--cgfc-font-size', `${normalizeSetting('fontSize', settings.fontSize)}px`);
    root.style.setProperty('--cgfc-line-height', String(normalizeSetting('lineHeight', settings.lineHeight)));
    root.style.setProperty('--cgfc-code-font-size', `${normalizeSetting('codeFontSize', settings.codeFontSize)}px`);
    root.style.setProperty('--cgfc-code-line-height', String(normalizeSetting('codeLineHeight', settings.codeLineHeight)));
    root.style.setProperty('--cgfc-normal-color', normalizeSetting('normalColor', settings.normalColor));
    root.style.setProperty('--cgfc-bold-color', normalizeSetting('boldColor', settings.boldColor));
    root.style.setProperty('--cgfc-bold-weight', String(normalizeSetting('boldWeight', settings.boldWeight)));
    root.style.setProperty('--cgfc-font-smoothing', normalizeSetting('fontSmoothingMode', settings.fontSmoothingMode));
    root.style.setProperty('--cgfc-moz-font-smoothing', getMozFontSmoothing(settings.fontSmoothingMode));
    root.style.setProperty('--cgfc-text-rendering', normalizeSetting('textRenderingMode', settings.textRenderingMode));
    root.dataset.cgfcMathMode = normalizeSetting('mathFontMode', settings.mathFontMode);

    root.toggleAttribute('data-cgfc-scroll-fix', settings.fixOuterScroll && hasInternalScrollContainer());
    root.toggleAttribute('data-cgfc-wrap-code', settings.wrapCode);
    root.toggleAttribute('data-cgfc-font-smoothing', settings.enableFontSmoothing);
    root.toggleAttribute('data-cgfc-katex-letter-font', settings.enableKatexLetterFont);
    return true;
  }

  function getPageWindow() {
    try {
      if (typeof unsafeWindow !== 'undefined' && unsafeWindow) return unsafeWindow;
    } catch (_) {
      // Fall back to the userscript window.
    }
    return window;
  }

  function installAutoScrollLock() {
    const win = getPageWindow();
    if (win.__cgfcAutoScrollLockInstalledV400) return;
    win.__cgfcAutoScrollLockInstalledV400 = true;

    const ElementCtor = win.Element || Element;
    const HTMLElementCtor = win.HTMLElement || HTMLElement;
    const elementProto = ElementCtor.prototype;
    const state = {
      generating: false,
      lastUserScrollAt: 0,
      windowY: 0,
      elements: new WeakMap(),
      settleTimer: 0,
      restoring: false,
    };

    function isUnifiedNavigationActive() {
      return document.documentElement?.hasAttribute('data-cgpt-unified-navigation-active') === true;
    }

    function isLockEnabled() {
      return Boolean(settings.stopAutoScrollWhileGenerating);
    }

    function snapshotPositions() {
      state.windowY = win.scrollY || document.documentElement.scrollTop || 0;
      collectScrollableElements().forEach((el) => {
        state.elements.set(el, el.scrollTop || 0);
      });
    }

    function isTypingTarget(target) {
      return Boolean(target?.closest?.('input, textarea, select, [contenteditable="true"]'));
    }

    function markUserScroll(event) {
      if (event?.type === 'keydown') {
        const scrollKeys = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ']);
        if (!scrollKeys.has(event.key) || (event.key === ' ' && isTypingTarget(event.target))) return;
      }

      state.lastUserScrollAt = Date.now();
      snapshotPositions();
      win.clearTimeout(state.settleTimer);
      state.settleTimer = win.setTimeout(snapshotPositions, 360);
    }

    function isUserScrollWindowOpen() {
      return Date.now() - state.lastUserScrollAt < USER_SCROLL_GRACE_MS;
    }

    function getTopArg(first, second, currentTop) {
      if (typeof first === 'object' && first !== null && typeof first.top === 'number') return first.top;
      if (typeof second === 'number') return second;
      if (typeof first === 'number') return first;
      return currentTop;
    }

    function getDeltaArg(first, second) {
      if (typeof first === 'object' && first !== null && typeof first.top === 'number') return first.top;
      if (typeof second === 'number') return second;
      return 0;
    }

    function shouldBlockWindowTop(nextTop) {
      if (!isLockEnabled() || !state.generating || isUserScrollWindowOpen() || isUnifiedNavigationActive()) return false;
      return typeof nextTop === 'number' && nextTop > state.windowY + SCROLL_EPSILON_PX;
    }

    function shouldBlockElementTop(el, nextTop) {
      if (!isLockEnabled() || !state.generating || isUserScrollWindowOpen() || isUnifiedNavigationActive()) return false;
      const lockedTop = state.elements.get(el);
      const baseline = typeof lockedTop === 'number' ? lockedTop : el.scrollTop || 0;
      return typeof nextTop === 'number' && nextTop > baseline + SCROLL_EPSILON_PX;
    }

    function handleScroll(event) {
      if (!isLockEnabled() || !state.generating || state.restoring || isUnifiedNavigationActive()) return;

      const target = event.target;
      const isWindowScroll = target === document || target === document.documentElement || target === document.body;
      const currentTop = isWindowScroll ? win.scrollY || document.documentElement.scrollTop || 0 : target?.scrollTop;

      if (typeof currentTop !== 'number') return;
      if (isUserScrollWindowOpen()) {
        if (isWindowScroll) state.windowY = currentTop;
        else if (target instanceof HTMLElementCtor) state.elements.set(target, currentTop);
        return;
      }

      const baseline = isWindowScroll ? state.windowY : state.elements.get(target);
      if (typeof baseline !== 'number' || currentTop <= baseline + SCROLL_EPSILON_PX) return;

      state.restoring = true;
      win.requestAnimationFrame(() => {
        if (isWindowScroll) win.scrollTo({ top: baseline, behavior: 'auto' });
        else if (target instanceof HTMLElementCtor && target.isConnected) target.scrollTop = baseline;
        win.requestAnimationFrame(() => {
          state.restoring = false;
        });
      });
    }

    function isScrollableElement(el) {
      if (!(el instanceof HTMLElementCtor) || !el.isConnected) return false;
      const style = win.getComputedStyle(el);
      if (!/(auto|scroll|overlay)/.test(`${style.overflowY} ${style.overflow}`)) return false;
      return el.scrollHeight > el.clientHeight + 24;
    }

    function collectScrollableElements() {
      const root = document.body || document.documentElement;
      if (!root) return [];
      const elements = [];
      const candidates = root.querySelectorAll(
        'main, [role="main"], [data-scroll-root], [class*="overflow-y-auto"], [class*="overflow-auto"]'
      );
      for (const el of candidates) {
        if (isScrollableElement(el)) elements.push(el);
      }
      return elements;
    }

    function markScrollbarDrag(event) {
      if (event.button !== 0 && event.button !== 1) return;
      const target = event.composedPath?.().find((node) => node instanceof HTMLElementCtor && isScrollableElement(node));
      if (!target) return;

      const rect = target.getBoundingClientRect();
      const nearVerticalScrollbar = event.clientX >= rect.right - 22;
      if (event.button === 1 || nearVerticalScrollbar) markUserScroll(event);
    }

    function isVisible(el) {
      if (!(el instanceof HTMLElementCtor) || !el.isConnected) return false;
      const rect = el.getBoundingClientRect();
      const style = win.getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    }

    function isGenerating() {
      const directStop = document.querySelector(
        '[data-testid="stop-button"], [data-testid="composer-stop-button"], [data-testid*="stop-generating"]'
      );
      if (directStop && isVisible(directStop)) return true;

      const composer = document.querySelector('form, [data-testid*="composer"], [class*="composer"]');
      if (!composer) return false;
      const buttons = composer.querySelectorAll('button, [role="button"]');
      for (const button of buttons) {
        if (!isVisible(button)) continue;
        const label = [
          button.getAttribute('aria-label') || '',
          button.getAttribute('title') || '',
          button.getAttribute('data-testid') || '',
          button.textContent || '',
        ].join(' ');

        if (/\b(?:stop (?:generating|streaming|response)|generating)\b|停止(?:生成|回答)|中止生成|生成中/i.test(label)) {
          return true;
        }
      }
      return false;
    }

    function refreshGenerationState() {
      const nextGenerating = isGenerating();
      if (nextGenerating && !state.generating) snapshotPositions();
      if (!nextGenerating && state.generating) state.elements = new WeakMap();
      state.generating = nextGenerating;
    }

    function tagWrapper(fn) {
      try {
        Object.defineProperty(fn, '__cgfcAutoScrollLockWrapper', { value: true });
      } catch (_) {
        fn.__cgfcAutoScrollLockWrapper = true;
      }
      return fn;
    }

    function isWrapped(fn) {
      return Boolean(fn && fn.__cgfcAutoScrollLockWrapper);
    }

    function installWrapper(target, key, createWrapper) {
      try {
        const current = target?.[key];
        if (typeof current !== 'function' || isWrapped(current)) return;
        target[key] = tagWrapper(createWrapper(current));
      } catch (_) {
        // Some page realms expose non-writable host methods. Scroll-event
        // recovery still works even when a particular API cannot be wrapped.
      }
    }

    function wrapScrollApis() {
      installWrapper(win, 'scrollTo', (original) => function (first, second) {
        const nextTop = getTopArg(first, second, win.scrollY || 0);
        if (shouldBlockWindowTop(nextTop)) return original.call(win, 0, state.windowY);
        return original.apply(win, arguments);
      });

      installWrapper(win, 'scroll', (original) => function (first, second) {
        const nextTop = getTopArg(first, second, win.scrollY || 0);
        if (shouldBlockWindowTop(nextTop)) return original.call(win, 0, state.windowY);
        return original.apply(win, arguments);
      });

      installWrapper(win, 'scrollBy', (original) => function (first, second) {
        const delta = getDeltaArg(first, second);
        if (shouldBlockWindowTop((win.scrollY || 0) + delta)) return original.call(win, 0, 0);
        return original.apply(win, arguments);
      });

      installWrapper(elementProto, 'scrollTo', (original) => function (first, second) {
        const nextTop = getTopArg(first, second, this.scrollTop || 0);
        if (shouldBlockElementTop(this, nextTop)) return;
        return original.apply(this, arguments);
      });

      installWrapper(elementProto, 'scroll', (original) => function (first, second) {
        const nextTop = getTopArg(first, second, this.scrollTop || 0);
        if (shouldBlockElementTop(this, nextTop)) return;
        return original.apply(this, arguments);
      });

      installWrapper(elementProto, 'scrollBy', (original) => function (first, second) {
        const delta = getDeltaArg(first, second);
        if (shouldBlockElementTop(this, (this.scrollTop || 0) + delta)) return;
        return original.apply(this, arguments);
      });

      installWrapper(elementProto, 'scrollIntoView', (original) => function (options) {
        if (!isLockEnabled() || !state.generating || isUserScrollWindowOpen() || isUnifiedNavigationActive()) {
          return original.call(this, options);
        }

        const rect = this.getBoundingClientRect();
        if (rect.top >= 0 && rect.bottom <= win.innerHeight) {
          return original.call(this, options);
        }
      });
    }

    ['wheel', 'touchstart', 'touchmove', 'keydown'].forEach((eventName) => {
      win.addEventListener(eventName, markUserScroll, { capture: true, passive: true });
    });
    win.addEventListener('pointerdown', markScrollbarDrag, { capture: true, passive: true });
    document.addEventListener('scroll', handleScroll, { capture: true, passive: true });

    wrapScrollApis();
    refreshAutoScrollLockState = refreshGenerationState;

    let generationRefreshTimer = 0;
    const queueGenerationRefresh = () => {
      win.clearTimeout(generationRefreshTimer);
      generationRefreshTimer = win.setTimeout(refreshGenerationState, 60);
    };
    const observer = new MutationObserver(queueGenerationRefresh);
    const start = () => {
      refreshGenerationState();
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['aria-label', 'data-testid', 'disabled'],
      });
      win.setInterval(refreshGenerationState, GENERATION_CHECK_MS);
      win.setInterval(wrapScrollApis, API_GUARD_MS);
    };

    onReady(start);
  }

  function updateSetting(key, value) {
    settings = { ...settings, [key]: normalizeSetting(key, value) };
    applySettings();
    persistSoon();

    if (key === 'hideVersionNotice') queueNoticeScan();
    if (key === 'stopAutoScrollWhileGenerating') refreshAutoScrollLockState();
    if (key === 'enableResidualLatex' && settings.enableResidualLatex) {
      installKatexCss();
      scanAssistantRoots();
    }
  }

  function quoteFontFamily(family) {
    const safe = String(family || '').replace(/["\\<>\u0000-\u001f\u007f]/g, '').trim();
    return safe ? `"${safe}"` : '';
  }

  function primaryFontFamily(value) {
    return String(value || '').split(',')[0].trim().replace(/^["']|["']$/g, '');
  }

  function fontAppearsAvailable(family) {
    try {
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      if (!context) return false;
      const probe = 'mmmmmmmmmmlliWW00汉字α∑∫';
      const fallbacks = ['monospace', 'serif', 'sans-serif'];
      return fallbacks.some((fallback) => {
        context.font = `72px ${fallback}`;
        const baseline = context.measureText(probe).width;
        context.font = `72px ${quoteFontFamily(family)}, ${fallback}`;
        return Math.abs(context.measureText(probe).width - baseline) > 0.1;
      });
    } catch (_) {
      return false;
    }
  }

  function sanitizeFontFamilyName(value) {
    if (typeof value !== 'string') return '';
    const text = value
      .normalize?.('NFKC')
      .replace(/[\u0000-\u001f\u007f<>"\\;]/g, '')
      .split('{').join('')
      .split('}').join('')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 220);
    if (!text || text === 'undefined' || text === 'null') return '';
    return text;
  }

  function normalizeFontSearchText(value) {
    const text = sanitizeFontFamilyName(value)
      .toLocaleLowerCase('zh-Hans')
      .replace(/[‐‑‒–—―−]/g, '-')
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return text;
  }

  function fontSearchVariants(value) {
    const normalized = normalizeFontSearchText(value);
    if (!normalized) return [];
    const variants = new Set([normalized, normalized.replace(/\s+/g, '')]);
    // Windows CJK families can report either traditional 書 or simplified 书.
    // This conservative pair is enough to bridge localized labels without
    // inventing unrelated transliterations.
    variants.add(normalized.replace(/書/g, '书'));
    variants.add(normalized.replace(/书/g, '書'));
    variants.add(normalized.replace(/書/g, '书').replace(/\s+/g, ''));
    variants.add(normalized.replace(/书/g, '書').replace(/\s+/g, ''));
    return Array.from(variants).filter(Boolean);
  }

  function isVerifiedFontSource(source) {
    return source === 'local-font-access' || source === 'extension' || source === 'local-face';
  }

  function addDetectedFontCandidate(candidate, aliases = [], source = 'candidate') {
    const object = candidate && typeof candidate === 'object' ? candidate : { family: candidate };
    const canonical = sanitizeFontFamilyName(object.family || object.canonical || object.fontId || object.displayName);
    if (!canonical) return false;

    if (!detectedFontAliases.has(canonical)) detectedFontAliases.set(canonical, new Set());
    const aliasSet = detectedFontAliases.get(canonical);
    [
      canonical,
      object.displayName,
      object.fullName,
      object.postscriptName,
      object.localizedName,
      object.style,
      object.fontId,
      ...(Array.isArray(aliases) ? aliases : []),
      ...(Array.isArray(object.aliases) ? object.aliases : []),
    ]
      .map(sanitizeFontFamilyName)
      .filter(Boolean)
      .forEach((alias) => aliasSet.add(alias));

    const displayLabel = sanitizeFontFamilyName(
      object.displayName || object.localizedName || object.fullName || canonical,
    );
    const previousLabel = detectedFontLabels.get(canonical);
    if (displayLabel && (!previousLabel || isVerifiedFontSource(source))) {
      detectedFontLabels.set(canonical, displayLabel);
    } else if (!previousLabel) {
      detectedFontLabels.set(canonical, canonical);
    }

    if (isVerifiedFontSource(source)) verifiedFontFamilies.add(canonical);
    else fallbackFontFamilies.add(canonical);
    return true;
  }

  function mergeDetectedFontFamilies(families, source = 'candidate') {
    const configured = Array.from(FONT_SETTING_KEYS, (key) => primaryFontFamily(settings[key])).filter(Boolean);
    configured.forEach((candidate) => addDetectedFontCandidate(candidate, [], 'configured'));
    (Array.isArray(families) ? families : []).forEach((candidate) => addDetectedFontCandidate(candidate, [], source));
    detectedFontFamilies = Array.from(detectedFontAliases.keys())
      .sort((left, right) => left.localeCompare(right, ['zh-Hans', 'en'], { sensitivity: 'base', numeric: true }));
  }

  function getSelectableFontFamilies() {
    // Once a real browser/extension/local() scan succeeds, only show verified
    // installed families. The historical Windows snapshot remains in memory as
    // a fallback, but can no longer pollute an authoritative result.
    if ((fontDetectionMode === 'full-api' || fontDetectionMode === 'verified-fallback') && verifiedFontFamilies.size) {
      return Array.from(verifiedFontFamilies)
        .sort((left, right) => left.localeCompare(right, ['zh-Hans', 'en'], { sensitivity: 'base', numeric: true }));
    }
    return detectedFontFamilies;
  }

  function fontOptionLabel(family) {
    const display = detectedFontLabels.get(family) || family;
    if (!display || normalizeFontSearchText(display) === normalizeFontSearchText(family)) return family;
    return `${display}（${family}）`;
  }

  function detectKnownLocalFonts() {
    mergeDetectedFontFamilies(
      KNOWN_LOCAL_FONT_CANDIDATES.filter(fontAppearsAvailable),
      'canvas-candidate',
    );
    // Keep the generated snapshot as a no-permission safety net. It is never
    // treated as authoritative and disappears from the picker after a verified
    // scan succeeds.
    mergeDetectedFontFamilies(WINDOWS_FONT_FAMILY_SNAPSHOT, 'windows-snapshot');
    if (fontDetectionMode !== 'full-api' && fontDetectionMode !== 'verified-fallback') {
      fontDetectionMode = 'candidate';
    }
    return detectedFontFamilies;
  }

  function escapeCssLocalName(value) {
    return String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  async function fontFaceLocalAppearsAvailable(family) {
    if (typeof FontFace !== 'function') return null;
    const safeFamily = sanitizeFontFamilyName(family);
    if (!safeFamily) return false;
    const probeFamily = `cgfc-probe-${createBridgeToken('font').replace(/[^a-z0-9-]/gi, '')}`;
    let timer = 0;
    try {
      const face = new FontFace(probeFamily, `local("${escapeCssLocalName(safeFamily)}")`);
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('font probe timeout')), FONT_FACE_VERIFY_TIMEOUT_MS);
      });
      await Promise.race([face.load(), timeout]);
      return face.status === 'loaded';
    } catch (_) {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  async function verifyKnownFontCandidatesWithLocalFace() {
    const candidates = Array.from(new Set([
      ...Array.from(FONT_SETTING_KEYS, (key) => primaryFontFamily(settings[key])).filter(Boolean),
      ...KNOWN_LOCAL_FONT_CANDIDATES,
      ...LOCAL_FONT_RESCUE_CANDIDATE_NAMES,
      ...WINDOWS_FONT_FAMILY_SNAPSHOT,
    ].map(sanitizeFontFamilyName).filter(Boolean)));

    if (typeof FontFace !== 'function' || !candidates.length) return { supported: false, records: [] };

    const records = [];
    let index = 0;
    const worker = async () => {
      while (index < candidates.length) {
        const currentIndex = index++;
        const family = candidates[currentIndex];
        const available = await fontFaceLocalAppearsAvailable(family);
        if (available) records.push({ family, displayName: family });
      }
    };
    await Promise.all(Array.from(
      { length: Math.min(FONT_FACE_VERIFY_CONCURRENCY, candidates.length) },
      () => worker(),
    ));
    return { supported: true, records };
  }

  function verifiedFontSearchKeys() {
    const keys = new Set();
    for (const family of verifiedFontFamilies) {
      fontSearchVariants(family).forEach((variant) => keys.add(variant));
      const aliases = detectedFontAliases.get(family) || new Set();
      for (const alias of aliases) fontSearchVariants(alias).forEach((variant) => keys.add(variant));
    }
    return keys;
  }

  async function verifyRescueFontCandidates() {
    if (typeof FontFace !== 'function') return { supported: false, records: [] };
    const knownKeys = verifiedFontSearchKeys();
    const records = [];

    const groupAlreadyKnown = (group) => group.names.some((name) =>
      fontSearchVariants(name).some((variant) => knownKeys.has(variant)),
    );

    let groupIndex = 0;
    const worker = async () => {
      while (groupIndex < LOCAL_FONT_RESCUE_GROUPS.length) {
        const currentIndex = groupIndex++;
        const group = LOCAL_FONT_RESCUE_GROUPS[currentIndex];
        if (groupAlreadyKnown(group)) continue;

        for (const rawName of group.names) {
          const family = sanitizeFontFamilyName(rawName);
          if (!family) continue;
          const available = await fontFaceLocalAppearsAvailable(family);
          if (!available) continue;
          records.push({
            family,
            displayName: group.label,
            aliases: group.names,
          });
          fontSearchVariants(family).forEach((variant) => knownKeys.add(variant));
          group.names.flatMap(fontSearchVariants).forEach((variant) => knownKeys.add(variant));
          break;
        }
      }
    };

    await Promise.all(Array.from(
      { length: Math.min(3, LOCAL_FONT_RESCUE_GROUPS.length) },
      () => worker(),
    ));
    return { supported: true, records };
  }

  function populateFontSelect(select) {
    if (!(select instanceof HTMLSelectElement)) return;
    const key = select.dataset.key;
    const current = settings[key];
    select.replaceChildren();

    const values = new Set();
    const appendOption = (value, label, family) => {
      if (!value || values.has(value)) return;
      values.add(value);
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      if (family) option.style.fontFamily = quoteFontFamily(family);
      select.appendChild(option);
    };

    appendOption(current, `当前：${primaryFontFamily(current) || current}`, primaryFontFamily(current));
    const normalizedQuery = fontSearchVariants(fontSearchQuery);
    getSelectableFontFamilies()
      .filter((family) => {
        if (!normalizedQuery.length) return true;
        const aliases = detectedFontAliases.get(family) || new Set([family]);
        const searchable = Array.from(aliases).flatMap(fontSearchVariants);
        return normalizedQuery.some((query) => searchable.some((alias) => alias.includes(query)));
      })
      // Values always remain CSS family names. Full names, PostScript names and
      // style/localized names are display/search aliases only.
      .forEach((family) => appendOption(family, fontOptionLabel(family), family));
    select.value = current;
  }

  function refreshFontSelects() {
    document.querySelectorAll(`#${PANEL_ID} select[data-font-picker="true"]`).forEach(populateFontSelect);
  }

  function setFontScanStatus(message, isError = false) {
    const status = document.getElementById(FONT_STATUS_ID);
    if (!status) return;
    status.textContent = message;
    status.toggleAttribute('data-error', isError);
  }

  function fontDetectionStatusText() {
    const selectable = getSelectableFontFamilies();
    if (fontSearchQuery) {
      const queryVariants = fontSearchVariants(fontSearchQuery);
      const count = selectable.filter((family) => {
        const aliases = detectedFontAliases.get(family) || new Set([family]);
        const searchable = Array.from(aliases).flatMap(fontSearchVariants);
        return queryVariants.some((query) => searchable.some((alias) => alias.includes(query)));
      }).length;
      const extensionText = lastExtensionStatus === 'ok'
        ? `扩展 ${lastExtensionFontCount} 个家族`
        : '扩展未检测到';
      return `搜索“${fontSearchQuery}”：匹配 ${count} / ${selectable.length} 个可选字体家族；浏览器 API ${lastApiFontCount} 个家族；${extensionText}。`;
    }
    if (fontDetectionMode === 'full-api') {
      const extensionText = lastExtensionStatus === 'ok'
        ? `；扩展补充 ${lastExtensionFontCount} 个家族`
        : '';
      const rescueText = lastRescueVerifiedCount
        ? `；local() 补探测 ${lastRescueVerifiedCount} 个`
        : '';
      const faceText = lastApiFontFaceCount > lastApiFontCount
        ? `（${lastApiFontFaceCount} 个字体文件/字重）`
        : '';
      return `精确扫描成功：浏览器读取 ${lastApiFontCount} 个本机字体家族${faceText}${rescueText}${extensionText}；当前仅显示已验证字体，共 ${selectable.length} 个。`;
    }
    if (fontDetectionMode === 'verified-fallback') {
      const rescueText = lastRescueVerifiedCount ? `；额外补探测 ${lastRescueVerifiedCount} 个` : '';
      return `浏览器 Local Font Access 未成功，已用 CSS local() 逐个验证 ${lastFallbackVerifiedCount} 个真实可用字体${rescueText}；当前仅显示验证通过的 ${selectable.length} 个。`;
    }
    return `已载入 Windows 字体候选快照 ${WINDOWS_FONT_FAMILY_SNAPSHOT.length} 个；当前列表共 ${detectedFontFamilies.length} 个候选家族。点击“扫描全部本机字体”后会优先改为真实本机字体列表。`;
  }

  function applyFontSearch(value) {
    fontSearchQuery = String(value || '').trim();
    refreshFontSelects();
    setFontScanStatus(fontDetectionStatusText());
  }

  function createBridgeToken(prefix) {
    const randomPart = (() => {
      try {
        const bytes = new Uint32Array(2);
        if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') crypto.getRandomValues(bytes);
        return Array.from(bytes).map((value) => value.toString(36)).join('');
      } catch (_) {
        return Math.random().toString(36).slice(2);
      }
    })();
    return `${prefix}-${Date.now().toString(36)}-${randomPart}`.slice(0, 180);
  }

  function sanitizeExtensionFontRecords(payload) {
    const raw = Array.isArray(payload) ? payload : payload?.fonts;
    if (!Array.isArray(raw)) return [];
    const records = [];
    for (const item of raw.slice(0, 5000)) {
      if (!item || typeof item !== 'object') continue;
      const displayName = sanitizeFontFamilyName(item.displayName || item.localizedName || item.fullName);
      const fontId = sanitizeFontFamilyName(item.fontId || item.family);
      if (!displayName && !fontId) continue;
      // chrome.fontSettings.displayName is the human-facing label while fontId
      // is the CSS family identifier. Keep fullName/PostScript/style searchable.
      records.push({
        family: fontId || displayName,
        displayName: displayName || fontId,
        aliases: [fontId, item.localizedName, item.style, item.fullName, item.postscriptName],
      });
    }
    return records;
  }

  function requestExtensionFonts() {
    return new Promise((resolve) => {
      const pageWindow = getPageWindow();
      if (!pageWindow || typeof pageWindow.postMessage !== 'function' || typeof pageWindow.addEventListener !== 'function') {
        resolve({ ok: false, status: 'not-detected', records: [], reason: 'page messaging unavailable' });
        return;
      }
      const requestId = createBridgeToken('request');
      const nonce = createBridgeToken('nonce');
      const origin = String(location.origin || '');
      let settled = false;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        pageWindow.removeEventListener('message', onMessage, false);
        resolve(result);
      };
      const onMessage = (event) => {
        if (event.source !== pageWindow || event.origin !== origin) return;
        const data = event.data;
        if (!data || data.source !== FONT_BRIDGE_SOURCE || data.type !== 'response' || data.requestId !== requestId || data.nonce !== nonce) return;
        if (data.action !== FONT_BRIDGE_REQUEST) return;
        if (data.ok !== true) {
          finish({ ok: false, status: 'error', records: [], reason: String(data.error || 'extension request failed').slice(0, 240) });
          return;
        }
        const records = sanitizeExtensionFontRecords(data.fonts);
        finish({ ok: true, status: 'ok', records, reason: '' });
      };
      const timer = setTimeout(() => finish({ ok: false, status: 'not-detected', records: [], reason: 'extension timeout' }), FONT_BRIDGE_TIMEOUT_MS);
      pageWindow.addEventListener('message', onMessage, false);
      pageWindow.postMessage({
        source: FONT_BRIDGE_SOURCE,
        type: 'request',
        action: FONT_BRIDGE_REQUEST,
        requestId,
        nonce,
      }, origin);
    });
  }

  function getLocalFontProviders() {
    const providers = [];
    const seen = [];
    const addProvider = (owner, label) => {
      try {
        const method = owner?.queryLocalFonts;
        if (typeof method !== 'function' || seen.some((entry) => entry.owner === owner && entry.method === method)) return;
        seen.push({ owner, method });
        providers.push({ owner, method, label });
      } catch (_) {
        // Ignore inaccessible realms and continue to the next provider.
      }
    };

    let pageWindow = null;
    try {
      pageWindow = getPageWindow();
    } catch (_) {
      // Fall through to the userscript realm.
    }
    // Match the extension's successful strategy: prefer the page API itself,
    // and invoke it directly from the originating click without any prior await.
    addProvider(pageWindow, 'page/unsafeWindow');
    addProvider(window, 'userscript sandbox window');
    if (typeof globalThis !== 'undefined') addProvider(globalThis, 'userscript globalThis');
    addProvider(document.defaultView, 'document.defaultView');
    return providers;
  }

  function describeFontScanError(error) {
    const name = typeof error?.name === 'string' ? error.name.trim() : '';
    const message = typeof error?.message === 'string' ? error.message.trim() : String(error || '');
    if (name && message && !message.toLowerCase().startsWith(name.toLowerCase())) return `${name}: ${message}`;
    return message || name || 'unknown error';
  }

  async function scanAllLocalFonts(button) {
    const providers = getLocalFontProviders();
    // Every explicit scan is fresh. Old verified results must not survive a
    // later uninstall/font change and masquerade as current machine state.
    verifiedFontFamilies.clear();
    lastApiFontCount = 0;
    lastApiFontFaceCount = 0;
    lastFallbackVerifiedCount = 0;
    lastRescueVerifiedCount = 0;
    lastExtensionFontCount = 0;
    lastExtensionStatus = 'not-detected';
    button.disabled = true;
    setFontScanStatus('正在请求浏览器 Local Font Access，本次调用会保持在按钮点击的原始用户手势中……');

    const failures = [];
    let launchedQuery = null;
    // Crucial detail copied from the extension approach: call queryLocalFonts()
    // synchronously first. Do not await permission checks or other providers
    // before starting it, otherwise Chromium may consume user activation.
    for (const provider of providers) {
      try {
        const queryResult = Reflect.apply(provider.method, provider.owner, []);
        launchedQuery = { provider, queryResult };
        break;
      } catch (error) {
        failures.push(`${provider.label}: ${describeFontScanError(error)}`);
      }
    }

    let records = null;
    if (launchedQuery) {
      try {
        records = await launchedQuery.queryResult;
      } catch (error) {
        failures.push(`${launchedQuery.provider.label}: ${describeFontScanError(error)}`);
      }
    } else if (!providers.length) {
      failures.push('当前页面未暴露 queryLocalFonts()');
    }

    if (Array.isArray(records) && records.length) {
      const apiRecords = Array.from(records)
        .filter((record) => record && typeof record === 'object')
        .map((record) => ({
          family: record.family,
          displayName: record.fullName || record.family,
          fullName: record.fullName,
          postscriptName: record.postscriptName,
          style: record.style,
          localizedName: record.localizedName,
          aliases: [record.fullName, record.postscriptName, record.style, record.localizedName],
        }))
        .filter((record) => sanitizeFontFamilyName(record.family));
      const apiFamilies = Array.from(new Set(
        apiRecords.map((record) => sanitizeFontFamilyName(record.family)).filter(Boolean),
      ));
      mergeDetectedFontFamilies(apiRecords, 'local-font-access');
      fontDetectionMode = 'full-api';
      lastApiFontCount = apiFamilies.length;
      lastApiFontFaceCount = apiRecords.length;
      lastFallbackVerifiedCount = 0;
    } else {
      lastApiFontCount = 0;
      lastApiFontFaceCount = 0;
      setFontScanStatus('Local Font Access 未返回字体，正在用 CSS local() 对候选字体逐个做本机验证……');
      const localFaceResult = await verifyKnownFontCandidatesWithLocalFace();
      if (localFaceResult.supported && localFaceResult.records.length) {
        mergeDetectedFontFamilies(localFaceResult.records, 'local-face');
        lastFallbackVerifiedCount = localFaceResult.records.length;
        fontDetectionMode = 'verified-fallback';
      } else {
        lastFallbackVerifiedCount = 0;
        detectKnownLocalFonts();
      }
    }

    // Local Font Access can occasionally expose a usable but incomplete or
    // version-renamed set. Probe a tiny alias-aware rescue list even after an
    // API success. This is intentionally small, so normal scans stay fast.
    setFontScanStatus('正在补探测 Commit Mono / IBM Plex Mono / Maple Mono 的本机内部名称……');
    const rescueResult = await verifyRescueFontCandidates();
    if (rescueResult.supported && rescueResult.records.length) {
      lastRescueVerifiedCount = rescueResult.records.length;
      mergeDetectedFontFamilies(rescueResult.records, 'local-face');
      if (fontDetectionMode === 'candidate') fontDetectionMode = 'verified-fallback';
    } else {
      lastRescueVerifiedCount = 0;
    }

    // Optional MV3 bridge remains additive. It is useful when the page's
    // Permissions-Policy blocks Local Font Access but a companion extension is
    // installed. It never deletes browser/local() results.
    setFontScanStatus('正在请求字体扩展补充列表……');
    const extensionResult = await requestExtensionFonts();
    lastExtensionStatus = extensionResult.status;
    if (extensionResult.ok && extensionResult.records.length) {
      const extensionFamilies = Array.from(new Set(
        extensionResult.records.map((record) => sanitizeFontFamilyName(record.family)).filter(Boolean),
      ));
      lastExtensionFontCount = extensionFamilies.length;
      mergeDetectedFontFamilies(extensionResult.records, 'extension');
      fontDetectionMode = 'full-api';
    } else {
      lastExtensionFontCount = 0;
    }

    refreshFontSelects();
    if (fontDetectionMode === 'full-api' || fontDetectionMode === 'verified-fallback') {
      const detail = failures.length ? `；Local Font Access 备注：${failures.join('；')}` : '';
      setFontScanStatus(`${fontDetectionStatusText()}${detail}`, false);
    } else {
      const apiFailure = failures.length ? failures.join('；') : '浏览器 API 不可用或未授权';
      setFontScanStatus(
        `${apiFailure}；CSS local() 也未能建立可靠验证列表；已保留 Windows 候选快照 ${WINDOWS_FONT_FAMILY_SNAPSHOT.length} 个，不影响其他功能。`,
        true,
      );
    }
    button.disabled = false;
  }

  function appendControl(parent, options) {
    const label = document.createElement('label');
    label.className = options.type === 'checkbox' ? 'cgfc-check' : '';

    const caption = document.createElement('span');
    caption.textContent = options.label;

    const input = ['select', 'font-select'].includes(options.type) ? document.createElement('select') : document.createElement('input');
    input.dataset.key = options.key;

    if (options.type === 'checkbox') {
      input.type = 'checkbox';
      input.checked = Boolean(settings[options.key]);
      input.addEventListener('change', () => updateSetting(options.key, input.checked));
      label.append(input, caption);
    } else if (options.type === 'select') {
      options.choices.forEach((choice) => {
        const option = document.createElement('option');
        option.value = choice.value;
        option.textContent = choice.label;
        input.appendChild(option);
      });
      input.value = settings[options.key];
      input.addEventListener('change', () => updateSetting(options.key, input.value));
      label.append(caption, input);
    } else if (options.type === 'font-select') {
      input.dataset.fontPicker = 'true';
      populateFontSelect(input);
      input.addEventListener('change', () => updateSetting(options.key, input.value));
      label.append(caption, input);
    } else {
      input.type = options.type;
      input.value = settings[options.key];
      if (options.min !== undefined) input.min = options.min;
      if (options.max !== undefined) input.max = options.max;
      if (options.step !== undefined) input.step = options.step;
      input.addEventListener('input', () => updateSetting(options.key, input.value));
      label.append(caption, input);
    }

    parent.appendChild(label);
    return input;
  }

  function createRow(parent) {
    const row = document.createElement('div');
    row.className = 'cgfc-row';
    parent.appendChild(row);
    return row;
  }

  function syncPanelInputs(panel) {
    panel.querySelectorAll('input[data-key], select[data-key]').forEach((input) => {
      const key = input.dataset.key;
      if (!key) return;

      if (input.type === 'checkbox') {
        input.checked = Boolean(settings[key]);
      } else {
        input.value = settings[key];
      }
    });
  }

  function createPanel() {
    if (!document.body) return;

    const existingToggle = document.getElementById(TOGGLE_ID);
    const existingPanel = document.getElementById(PANEL_ID);
    if (existingToggle instanceof HTMLElement && existingPanel instanceof HTMLElement) return;

    existingToggle?.remove();
    existingPanel?.remove();

    const toggle = document.createElement('button');
    toggle.id = TOGGLE_ID;
    toggle.type = 'button';
    toggle.title = 'ChatGPT 字体与颜色设置';
    toggle.setAttribute('aria-label', '打开 ChatGPT 字体与颜色设置');
    toggle.setAttribute('aria-controls', PANEL_ID);
    toggle.setAttribute('aria-expanded', 'false');
    toggle.textContent = 'Aa';

    const panel = document.createElement('section');
    panel.id = PANEL_ID;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'false');
    panel.hidden = true;

    const title = document.createElement('h2');
    title.id = `${PANEL_ID}-title`;
    title.textContent = 'ChatGPT 字体与颜色设置';
    panel.setAttribute('aria-labelledby', title.id);
    panel.appendChild(title);

    detectKnownLocalFonts();

    const fontScanRow = document.createElement('div');
    fontScanRow.className = 'cgfc-font-scan';
    const fontScanButton = document.createElement('button');
    fontScanButton.type = 'button';
    fontScanButton.textContent = '扫描全部本机字体';
    fontScanButton.addEventListener('click', () => scanAllLocalFonts(fontScanButton));
    const fontSearchInput = document.createElement('input');
    fontSearchInput.type = 'search';
    fontSearchInput.placeholder = '搜索字体（中文 / English）';
    fontSearchInput.setAttribute('aria-label', '搜索本机字体');
    fontSearchInput.value = fontSearchQuery;
    fontSearchInput.addEventListener('input', () => applyFontSearch(fontSearchInput.value));
    const fontScanStatus = document.createElement('p');
    fontScanStatus.id = FONT_STATUS_ID;
    fontScanStatus.className = 'cgfc-hint';
    fontScanStatus.textContent = fontDetectionStatusText();
    fontScanRow.append(fontScanButton, fontSearchInput, fontScanStatus);
    panel.appendChild(fontScanRow);

    appendControl(panel, { label: '英文字体（Latin / 数字优先）', key: 'latinFont', type: 'font-select' });
    appendControl(panel, { label: '中文字体（中文字形回退）', key: 'chineseFont', type: 'font-select' });
    appendControl(panel, { label: '英文加粗字体', key: 'boldLatinFont', type: 'font-select' });
    appendControl(panel, { label: '中文加粗字体', key: 'boldChineseFont', type: 'font-select' });

    const fontHint = document.createElement('p');
    fontHint.className = 'cgfc-hint';
    fontHint.textContent = '浏览器先尝试英文字体，再把缺少的中文字形回退到中文字体；若英文字体本身包含完整中文字符，它可能不会触发中文回退。';
    panel.appendChild(fontHint);

    appendControl(panel, { label: '公式字母字体（MathML / KaTeX 普通字母）', key: 'mathFont', type: 'font-select' });
    appendControl(panel, {
      label: '公式字体策略',
      key: 'mathFontMode',
      type: 'select',
      choices: [
        { label: '仅原生 MathML（推荐）', value: 'native' },
        { label: '不覆盖公式字体', value: 'off' },
      ],
    });

    const mathHint = document.createElement('p');
    mathHint.className = 'cgfc-hint';
    mathHint.textContent = 'ChatGPT 通常使用 KaTeX，因此仅修改原生 MathML 往往看不出变化。下面的兼容选项只修改 KaTeX 普通字母，不触碰 ≠、∉、根号、运算符和伸缩符号。';
    panel.appendChild(mathHint);

    appendControl(panel, { label: '将所选公式字体用于 KaTeX 普通字母', key: 'enableKatexLetterFont', type: 'checkbox' });

    appendControl(panel, { label: '修复助手消息中未解析的 $...$ 公式', key: 'enableResidualLatex', type: 'checkbox' });
    const residualHint = document.createElement('p');
    residualHint.className = 'cgfc-hint';
    residualHint.textContent = '仅处理助手消息里仍显示为纯文本的 $...$、\\(...\\)、$$...$$、\\[...\\]；不会扫描你的提问或输入框。';
    panel.appendChild(residualHint);

    appendControl(panel, { label: '代码字体', key: 'codeFont', type: 'font-select' });

    let row = createRow(panel);
    appendControl(row, { label: '正文字号 px', key: 'fontSize', type: 'number', min: 10, max: 40, step: 1 });
    appendControl(row, { label: '正文行高', key: 'lineHeight', type: 'number', min: 1, max: 2.8, step: 0.05 });

    row = createRow(panel);
    appendControl(row, { label: '代码字号 px', key: 'codeFontSize', type: 'number', min: 10, max: 32, step: 1 });
    appendControl(row, { label: '代码行高', key: 'codeLineHeight', type: 'number', min: 1, max: 2.8, step: 0.05 });

    row = createRow(panel);
    appendControl(row, { label: '普通文字颜色', key: 'normalColor', type: 'color' });
    appendControl(row, { label: '加粗文字颜色', key: 'boldColor', type: 'color' });

    appendControl(panel, { label: '加粗粗细', key: 'boldWeight', type: 'number', min: 400, max: 1000, step: 50 });
    appendControl(panel, { label: '启用字体平滑 Anti-aliasing', key: 'enableFontSmoothing', type: 'checkbox' });

    row = createRow(panel);
    appendControl(row, {
      label: '平滑模式',
      key: 'fontSmoothingMode',
      type: 'select',
      choices: [
        { label: '更顺滑 antialiased', value: 'antialiased' },
        { label: '系统默认 auto', value: 'auto' },
        { label: '子像素 subpixel', value: 'subpixel-antialiased' },
      ],
    });
    appendControl(row, {
      label: '文本渲染',
      key: 'textRenderingMode',
      type: 'select',
      choices: [
        { label: '阅读优化', value: 'optimizeLegibility' },
        { label: '系统默认', value: 'auto' },
        { label: '几何精度', value: 'geometricPrecision' },
      ],
    });

    appendControl(panel, { label: '修复外层滚动', key: 'fixOuterScroll', type: 'checkbox' });
    appendControl(panel, { label: '防止自动滚动', key: 'stopAutoScrollWhileGenerating', type: 'checkbox' });
    appendControl(panel, { label: '代码自动换行', key: 'wrapCode', type: 'checkbox' });
    appendControl(panel, { label: '隐藏 Ophel 版本提示', key: 'hideVersionNotice', type: 'checkbox' });

    const actions = document.createElement('div');
    actions.className = 'cgfc-actions';

    const resetButton = document.createElement('button');
    resetButton.type = 'button';
    resetButton.textContent = '恢复默认';
    resetButton.addEventListener('click', () => {
      settings = { ...defaults };
      writeStore(STORAGE_KEY, settings);
      applySettings();
      detectKnownLocalFonts();
      refreshFontSelects();
      syncPanelInputs(panel);
      queueNoticeScan();
    });

    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.textContent = '关闭';

    actions.append(resetButton, closeButton);
    panel.appendChild(actions);

    function setPanelOpen(open, restoreFocus = false) {
      panel.hidden = !open;
      toggle.setAttribute('aria-expanded', String(open));
      if (open) panel.querySelector('input, select, button')?.focus();
      else if (restoreFocus) toggle.focus();
    }

    closeButton.addEventListener('click', () => setPanelOpen(false, true));
    toggle.addEventListener('click', () => {
      setPanelOpen(panel.hidden);
    });
    panel.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setPanelOpen(false, true);
    });

    document.body.append(toggle, panel);
  }

  function ensureShell() {
    applySettings();
    createPanel();

    const toggle = document.getElementById(TOGGLE_ID);
    const panel = document.getElementById(PANEL_ID);
    if (toggle instanceof HTMLElement && toggle.parentNode !== document.body) {
      document.body?.appendChild(toggle);
    }
    if (panel instanceof HTMLElement && panel.parentNode !== document.body) {
      document.body?.appendChild(panel);
    }
  }

  function queueShellGuard() {
    clearTimeout(shellGuardTimer);
    shellGuardTimer = setTimeout(ensureShell, 120);
  }

  function observeContainer(container) {
    if (!container) return;

    const observer = new MutationObserver(queueShellGuard);
    observer.observe(container, { childList: true });
  }

  function startShellGuard() {
    observeContainer(document.documentElement);
    observeContainer(document.head);
    observeContainer(document.body);
  }

  function normalizeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function normalizeDisclaimerText(value) {
    return normalizeText(value).replace(/\s+/g, '');
  }

  function isChatGPTDisclaimerText(value) {
    return normalizeDisclaimerText(value).includes(CHATGPT_DISCLAIMER_KEY);
  }

  function findDisclaimerElement(start) {
    let current = start instanceof HTMLElement ? start : start?.parentElement;
    let best = null;

    for (let depth = 0; current && depth < 6; depth += 1) {
      const text = normalizeDisclaimerText(current.textContent);
      if (text === CHATGPT_DISCLAIMER_KEY) {
        best = current;
        current = current.parentElement;
        continue;
      }
      break;
    }

    return best;
  }

  function clearStaleHiddenDisclaimers() {
    document.querySelectorAll(`.${HIDDEN_DISCLAIMER_CLASS}`).forEach((element) => {
      if (!isChatGPTDisclaimerText(element.textContent)) element.classList.remove(HIDDEN_DISCLAIMER_CLASS);
    });
  }

  function scanChatGPTDisclaimers(root) {
    const scanRoot = root instanceof Element ? root : document.body || document.documentElement;
    if (!scanRoot || !isChatGPTDisclaimerText(scanRoot.textContent)) return;

    const walker = document.createTreeWalker(scanRoot, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (!isChatGPTDisclaimerText(node.nodeValue)) continue;
      findDisclaimerElement(node.parentElement)?.classList.add(HIDDEN_DISCLAIMER_CLASS);
    }

    // Also cover a renderer that splits the sentence across multiple text nodes.
    scanRoot.querySelectorAll?.('span, p, div, button, a').forEach((element) => {
      if (normalizeDisclaimerText(element.textContent) === CHATGPT_DISCLAIMER_KEY) {
        element.classList.add(HIDDEN_DISCLAIMER_CLASS);
      }
    });
  }

  function queueDisclaimerScan(root) {
    clearTimeout(disclaimerTimer);
    disclaimerTimer = setTimeout(() => {
      clearStaleHiddenDisclaimers();
      scanChatGPTDisclaimers(root);
    }, 100);
  }

  function startDisclaimerObserver() {
    queueDisclaimerScan();

    const observer = new MutationObserver((mutations) => {
      let rootToScan = null;

      for (const mutation of mutations) {
        const target = mutation.target instanceof Element ? mutation.target : mutation.target?.parentElement;
        if (target?.closest(`#${PANEL_ID}, #${TOGGLE_ID}`)) continue;

        if (mutation.type === 'characterData' && isChatGPTDisclaimerText(mutation.target?.nodeValue)) {
          rootToScan = target;
          break;
        }

        for (const node of mutation.addedNodes) {
          const text = node.nodeType === Node.TEXT_NODE ? node.nodeValue : node.textContent;
          if (!isChatGPTDisclaimerText(text)) continue;
          rootToScan = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
          break;
        }

        if (rootToScan) break;
      }

      if (rootToScan) queueDisclaimerScan(rootToScan);
    });

    observer.observe(document.documentElement, { childList: true, characterData: true, subtree: true });
  }

  function isVersionNoticeText(value) {
    const text = normalizeText(value);
    return text.length > 0 && versionNoticeText.some((part) => text.includes(part));
  }

  function cleanModeIsActive() {
    return Boolean(document.getElementById(CLEAN_MODE_STYLE_ID));
  }

  function clearHiddenNotices() {
    document.querySelectorAll(`.${HIDDEN_NOTICE_CLASS}`).forEach((element) => {
      element.classList.remove(HIDDEN_NOTICE_CLASS);
    });
  }

  function findNoticeContainer(start) {
    let current = start instanceof HTMLElement ? start : start?.parentElement;
    let best = current;

    for (let depth = 0; current && depth < 7; depth += 1) {
      if (current.matches('main, #thread, body, html')) break;

      const text = normalizeText(current.textContent);
      const rect = current.getBoundingClientRect();
      if (isVersionNoticeText(text) && rect.height > 0 && rect.height <= 150 && text.length <= 260) {
        best = current;
        current = current.parentElement;
        continue;
      }

      break;
    }

    return best;
  }

  function scanNotices(root) {
    if (!settings.hideVersionNotice || !cleanModeIsActive()) {
      clearHiddenNotices();
      return;
    }

    const scanRoot = root instanceof Element ? root : document.querySelector('main') || document.body;
    if (!scanRoot || !isVersionNoticeText(scanRoot.textContent)) return;

    const walker = document.createTreeWalker(scanRoot, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (!isVersionNoticeText(node.nodeValue)) continue;
      findNoticeContainer(node.parentElement)?.classList.add(HIDDEN_NOTICE_CLASS);
    }
  }

  function queueNoticeScan(root) {
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => scanNotices(root), 100);
  }

  function startNoticeObserver() {
    queueNoticeScan();

    const observer = new MutationObserver((mutations) => {
      let rootToScan = null;
      let shouldClear = false;

      for (const mutation of mutations) {
        if (mutation.target instanceof Element && mutation.target.closest(`#${PANEL_ID}, #${TOGGLE_ID}`)) {
          continue;
        }

        for (const node of mutation.addedNodes) {
          if (!(node instanceof Element)) continue;

          if (node.id === CLEAN_MODE_STYLE_ID || node.querySelector?.(`#${CLEAN_MODE_STYLE_ID}`)) {
            rootToScan = document.querySelector('main') || document.body;
            break;
          }

          if (isVersionNoticeText(node.textContent)) {
            rootToScan = node;
            break;
          }
        }

        for (const node of mutation.removedNodes) {
          if (node instanceof Element && (node.id === CLEAN_MODE_STYLE_ID || node.querySelector?.(`#${CLEAN_MODE_STYLE_ID}`))) {
            shouldClear = true;
            break;
          }
        }

        if (rootToScan || shouldClear) break;
      }

      if (rootToScan) queueNoticeScan(rootToScan);
      if (shouldClear || !cleanModeIsActive()) queueNoticeScan();
    });

    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  // These tokenizer helpers deliberately operate on strings only. Keeping the
  // parser independent from DOM code makes delimiter recovery predictable while
  // a streamed assistant response is still being assembled.
  function isEscapedDelimiter(text, index) {
    let slashCount = 0;
    for (let cursor = index - 1; cursor >= 0 && text[cursor] === '\\'; cursor -= 1) slashCount += 1;
    return slashCount % 2 === 1;
  }

  function findResidualClosing(text, start, close, allowNewline) {
    for (let cursor = start; cursor <= text.length - close.length; cursor += 1) {
      if (!allowNewline && text[cursor] === '\n') return -1;
      if (!text.startsWith(close, cursor) || isEscapedDelimiter(text, cursor)) continue;
      return cursor;
    }
    return -1;
  }

  function isCurrencyLikeInlineLatex(value) {
    const trimmed = String(value || '').trim();
    if (!trimmed) return true;
    if (/^[+-]?\d+(?:[.,]\d+)?$/.test(trimmed)) return true;
    if (/^[+-]?\d+(?:[.,]\d+)?\s*[-–—]?$/.test(trimmed)) return true;
    if (/^[+-]?\d+(?:[.,]\d+)?\s*[-–—]\s*[+-]?\d+(?:[.,]\d+)?$/.test(trimmed)) return true;
    if (/^[+-]?\d/.test(trimmed) && !/[\\^_{}]/.test(trimmed)) return true;
    return false;
  }

  function tokenizeResidualLatex(input) {
    const text = String(input ?? '');
    const tokens = [];
    let plainStart = 0;
    let cursor = 0;

    const flushPlain = (end) => {
      if (end > plainStart) tokens.push({ type: 'text', raw: text.slice(plainStart, end) });
    };

    while (cursor < text.length) {
      if (isEscapedDelimiter(text, cursor)) {
        cursor += 1;
        continue;
      }

      let open = '';
      let close = '';
      let display = false;
      let allowNewline = false;
      if (text.startsWith('$$', cursor)) {
        open = '$$';
        close = '$$';
        display = true;
        allowNewline = true;
      } else if (text.startsWith('\\[', cursor)) {
        open = '\\[';
        close = '\\]';
        display = true;
        allowNewline = true;
      } else if (text.startsWith('\\(', cursor)) {
        open = '\\(';
        close = '\\)';
      } else if (text[cursor] === '$') {
        open = '$';
        close = '$';
      }

      if (!open) {
        cursor += 1;
        continue;
      }

      const end = findResidualClosing(text, cursor + open.length, close, allowNewline);
      if (end < 0) {
        cursor += open.length;
        continue;
      }

      const content = text.slice(cursor + open.length, end);
      if (!content.trim() || (!display && open === '$' && (content.includes('\n') || isCurrencyLikeInlineLatex(content)))) {
        cursor += open.length;
        continue;
      }

      flushPlain(cursor);
      tokens.push({
        type: 'math',
        raw: text.slice(cursor, end + close.length),
        content,
        display,
      });
      cursor = end + close.length;
      plainStart = cursor;
    }

    flushPlain(text.length);
    return tokens;
  }

  function getKatexRenderer() {
    try {
      if (typeof katex !== 'undefined' && katex && typeof katex.render === 'function') return katex;
    } catch (_) {
      // A missing @require should degrade to the original literal text.
    }
    try {
      if (window.katex && typeof window.katex.render === 'function') return window.katex;
    } catch (_) {
      // Ignore page-realm access failures.
    }
    return null;
  }

  function installKatexCss() {
    try {
      if (typeof GM_getResourceText !== 'function') return false;
      const resource = GM_getResourceText('ophelKatexCss');
      if (!resource) return false;
      const base = 'https://cdn.jsdelivr.net/npm/katex@0.16.44/dist/';
      const css = String(resource).replace(/url\(\s*(["']?)(fonts\/[^"')\s]+)\1\s*\)/g, (_match, quote, path) => `url("${base}${path}")`);
      let style = document.getElementById(KATEX_STYLE_ID);
      if (!style) style = document.createElement('style');
      style.id = KATEX_STYLE_ID;
      style.textContent = css;
      const parent = document.head || document.documentElement;
      if (parent && style.parentNode !== parent) parent.appendChild(style);
      return true;
    } catch (_) {
      // Resource APIs can be unavailable in some userscript managers. Existing
      // page styles and the @require renderer may still be usable.
      return false;
    }
  }

  function residualExcludedElement(element) {
    if (!(element instanceof Element)) return true;
    return Boolean(element.closest([
      'pre', 'code', 'textarea', 'input', 'select', 'option', 'script', 'style', 'noscript',
      '[contenteditable="true"]', '.katex', '.MathJax', 'mjx-container', 'math', 'annotation',
      '[data-latex]', `.${RESIDUAL_WRAPPER_CLASS}`, `#${PANEL_ID}`, `#${TOGGLE_ID}`, '[aria-hidden="true"]',
    ].join(',')));
  }

  function assistantRoleFor(element) {
    if (!(element instanceof Element)) return null;
    return element.closest('[data-message-author-role="assistant"], [role="assistant"]');
  }

  function assistantContentRoot(element) {
    const role = assistantRoleFor(element);
    if (!role || residualExcludedElement(role)) return null;
    const content = element.closest('.markdown, .prose');
    if (content && assistantRoleFor(content) === role && !residualExcludedElement(content)) return content;
    return role.querySelector?.('.markdown, .prose') || role;
  }

  function collectAssistantRoots(scanRoot) {
    const roots = new Set();
    const root = scanRoot instanceof Element ? scanRoot : document.body || document.documentElement;
    if (!root) return roots;
    if (root.matches?.('[data-message-author-role="assistant"], [role="assistant"], .markdown, .prose')) {
      const own = assistantContentRoot(root);
      if (own) roots.add(own);
    }
    root.querySelectorAll?.('[data-message-author-role="assistant"], [role="assistant"]').forEach((role) => {
      if (residualExcludedElement(role)) return;
      const content = role.querySelector('.markdown, .prose');
      roots.add(content || role);
    });
    return roots;
  }

  function renderResidualMath(token) {
    const renderer = getKatexRenderer();
    if (!renderer) return null;
    try {
      const holder = document.createElement('span');
      holder.className = RESIDUAL_WRAPPER_CLASS;
      holder.dataset.cgfcResidualLatex = 'true';
      holder.dataset.cgfcResidualDisplay = token.display ? 'true' : 'false';
      holder.setAttribute('aria-label', token.raw);
      holder.title = token.raw;
      renderer.render(token.content, holder, {
        displayMode: Boolean(token.display),
        trust: false,
        throwOnError: true,
        strict: 'warn',
      });
      return holder;
    } catch (_) {
      return null;
    }
  }

  function nextResidualBatch(state, batchSize) {
    const start = state.index;
    const end = Math.min(state.nodes.length, start + batchSize);
    state.index = end;
    return state.nodes.slice(start, end);
  }

  function scanAssistantRoot(root) {
    if (!settings.enableResidualLatex || !(root instanceof Element) || !root.isConnected) return false;
    root.setAttribute(RESIDUAL_ROOT_MARKER, 'true');
    let state = residualRootWork.get(root);
    if (!state) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          return residualExcludedElement(node.parentElement) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
        },
      });
      const nodes = [];
      let node;
      while ((node = walker.nextNode())) nodes.push(node);
      state = { nodes, index: 0 };
      residualRootWork.set(root, state);
    }
    const pending = nextResidualBatch(state, RESIDUAL_MAX_TEXT_NODES);
    pending.forEach((textNode) => {
      if (!textNode.isConnected || residualExcludedElement(textNode.parentElement)) return;
      const tokens = tokenizeResidualLatex(textNode.nodeValue || '');
      if (!tokens.some((token) => token.type === 'math')) return;
      const fragment = document.createDocumentFragment();
      let rendered = true;
      tokens.forEach((token) => {
        if (!rendered) return;
        if (token.type === 'text') fragment.appendChild(document.createTextNode(token.raw));
        else {
          const holder = renderResidualMath(token);
          if (!holder) rendered = false;
          else fragment.appendChild(holder);
        }
      });
      if (rendered) {
        const parent = textNode.parentNode;
        if (parent instanceof Element) {
          residualSelfMutationCounts.set(parent, (residualSelfMutationCounts.get(parent) || 0) + 1);
          parent.replaceChild(fragment, textNode);
        }
      }
    });
    const remaining = state.index < state.nodes.length;
    if (!remaining) residualRootWork.delete(root);
    return remaining;
  }

  function queueResidualRoot(root, invalidate = false) {
    if (!settings.enableResidualLatex || !(root instanceof Element) || residualExcludedElement(root)) return;
    if (invalidate) residualRootWork.delete(root);
    residualLatexRoots.add(root);
    clearTimeout(residualLatexTimer);
    residualLatexTimer = setTimeout(() => {
      residualLatexTimer = 0;
      const roots = Array.from(residualLatexRoots);
      residualLatexRoots.clear();
      roots.forEach((candidate) => {
        if (scanAssistantRoot(candidate)) queueResidualRoot(candidate);
      });
    }, RESIDUAL_DEBOUNCE_MS);
  }

  function scanAssistantRoots(scanRoot) {
    if (!settings.enableResidualLatex) return;
    collectAssistantRoots(scanRoot).forEach((root) => queueResidualRoot(root, true));
  }

  function startResidualLatexObserver() {
    if (residualLatexObserverStarted) return;
    residualLatexObserverStarted = true;
    onReady(() => {
      installKatexCss();
      scanAssistantRoots();
      const observer = new MutationObserver((mutations) => {
        if (!settings.enableResidualLatex) return;
        for (const mutation of mutations) {
          const target = mutation.target instanceof Element ? mutation.target : mutation.target?.parentElement;
          if (target && (residualExcludedElement(target) || target.closest?.(`.${RESIDUAL_WRAPPER_CLASS}`))) continue;
          const selfMutationCount = target && residualSelfMutationCounts.get(target);
          if (selfMutationCount) {
            if (selfMutationCount <= 1) residualSelfMutationCounts.delete(target);
            else residualSelfMutationCounts.set(target, selfMutationCount - 1);
            continue;
          }
          let externalNode = false;
          mutation.addedNodes?.forEach((node) => {
            if (node.nodeType === Node.ELEMENT_NODE && node.closest?.(`.${RESIDUAL_WRAPPER_CLASS}`)) return;
            externalNode = true;
            if (node.nodeType === Node.ELEMENT_NODE) collectAssistantRoots(node).forEach((root) => queueResidualRoot(root, true));
            else if (node.nodeType === Node.TEXT_NODE) {
              const root = assistantContentRoot(node.parentElement);
              if (root) queueResidualRoot(root, true);
            }
          });
          if (externalNode && target) {
            const root = assistantContentRoot(target);
            if (root) queueResidualRoot(root, true);
          }
          if (mutation.type === 'characterData' && target) {
            const root = assistantContentRoot(target);
            if (root) queueResidualRoot(root, true);
          }
        }
      });
      observer.observe(document.documentElement, { childList: true, characterData: true, subtree: true });
    });
  }

  function onReady(callback) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', callback, { once: true });
    } else {
      callback();
    }
  }

  const STATIC_CSS = `
    :root {
      --cgfc-latin-font: ${defaults.latinFont};
      --cgfc-chinese-font: ${defaults.chineseFont};
      --cgfc-bold-latin-font: ${defaults.boldLatinFont};
      --cgfc-bold-chinese-font: ${defaults.boldChineseFont};
      --cgfc-math-font: ${defaults.mathFont};
      --cgfc-code-font: ${defaults.codeFont};
      --cgfc-font-size: ${defaults.fontSize}px;
      --cgfc-line-height: ${defaults.lineHeight};
      --cgfc-code-font-size: ${defaults.codeFontSize}px;
      --cgfc-code-line-height: ${defaults.codeLineHeight};
      --cgfc-normal-color: ${defaults.normalColor};
      --cgfc-bold-color: ${defaults.boldColor};
      --cgfc-bold-weight: ${defaults.boldWeight};
      --cgfc-font-smoothing: ${defaults.fontSmoothingMode};
      --cgfc-moz-font-smoothing: grayscale;
      --cgfc-text-rendering: ${defaults.textRenderingMode};
    }

    html[data-cgfc-scroll-fix],
    html[data-cgfc-scroll-fix] body {
      height: 100% !important;
      overflow: hidden !important;
      overflow-x: hidden !important;
      overflow-y: hidden !important;
    }

    body,
    main [data-message-author-role],
    main .markdown,
    main .prose,
    textarea,
    [contenteditable="true"] {
      font-family: var(--cgfc-latin-font), var(--cgfc-chinese-font), serif !important;
    }

    html[data-cgfc-font-smoothing] body,
    html[data-cgfc-font-smoothing] main [data-message-author-role],
    html[data-cgfc-font-smoothing] main .markdown,
    html[data-cgfc-font-smoothing] main .prose,
    html[data-cgfc-font-smoothing] textarea,
    html[data-cgfc-font-smoothing] [contenteditable="true"] {
      -webkit-font-smoothing: var(--cgfc-font-smoothing) !important;
      -moz-osx-font-smoothing: var(--cgfc-moz-font-smoothing) !important;
      text-rendering: var(--cgfc-text-rendering) !important;
    }

    main [data-message-author-role],
    main .markdown,
    main .prose {
      color: var(--cgfc-normal-color) !important;
      font-size: var(--cgfc-font-size) !important;
      line-height: var(--cgfc-line-height) !important;
    }

    main .markdown :is(p, li, td, th, blockquote, details, summary),
    main .prose :is(p, li, td, th, blockquote, details, summary) {
      color: inherit !important;
      line-height: inherit !important;
    }

    main .markdown :is(h1, h2, h3, h4),
    main .prose :is(h1, h2, h3, h4) {
      line-height: 1.35 !important;
    }

    main .markdown :is(pre, code),
    main .prose :is(pre, code),
    [data-message-author-role] :is(pre, code) {
      font-family: var(--cgfc-code-font) !important;
      font-size: var(--cgfc-code-font-size) !important;
      line-height: var(--cgfc-code-line-height) !important;
    }

    html[data-cgfc-wrap-code] main .markdown pre,
    html[data-cgfc-wrap-code] main .prose pre,
    html[data-cgfc-wrap-code] [data-message-author-role] pre {
      white-space: pre-wrap !important;
      overflow-wrap: anywhere !important;
    }

    main .markdown :is(strong, b),
    main .prose :is(strong, b),
    [data-message-author-role] :is(strong, b) {
      font-family: var(--cgfc-bold-latin-font), var(--cgfc-bold-chinese-font), serif !important;
      color: var(--cgfc-bold-color) !important;
      font-weight: var(--cgfc-bold-weight) !important;
    }

    /*
      Renderer-safe boundary:
      - Native MathML may use an installed OpenType math font.
      - KaTeX and MathJax retain their own webfonts and metrics. In particular,
        KaTeX negated relations can use private-use overlay glyphs that disappear
        when a system font is forced onto internal relation spans.
    */
    html[data-cgfc-math-mode="native"] math,
    html[data-cgfc-math-mode="native"] math * {
      font-family: var(--cgfc-math-font) !important;
    }

    /* KaTeX renders visible HTML rather than native MathML. This opt-in bridge
       only changes ordinary letter atoms; relations, operators, radicals,
       delimiters, size glyphs, and layout metrics keep KaTeX's own fonts. */
    html[data-cgfc-katex-letter-font] .katex :is(
      .mord.mathnormal,
      .mord.mathit,
      .mord.mathbf,
      .mord.mathrm,
      .mord.boldsymbol,
      .mord.textnormal
    ) {
      font-family: var(--cgfc-math-font) !important;
    }

    /* Minimal layout boundary for recovered formulas. KaTeX internals retain
       the renderer's own font stack and metrics. */
    .${RESIDUAL_WRAPPER_CLASS} {
      display: inline-block;
      vertical-align: baseline;
    }

    .${RESIDUAL_WRAPPER_CLASS}[data-cgfc-residual-display="true"] {
      display: block;
      margin: .35em 0;
      text-align: center;
    }

    .${HIDDEN_NOTICE_CLASS} {
      display: none !important;
    }

    .${HIDDEN_DISCLAIMER_CLASS} {
      display: none !important;
    }

    #${TOGGLE_ID} {
      position: fixed;
      right: 14px;
      bottom: 18px;
      z-index: 2147483647;
      width: 38px;
      height: 38px;
      border: 1px solid rgba(255, 255, 255, .22);
      border-radius: 8px;
      background: rgba(20, 20, 20, .88);
      color: #fff;
      font: 700 16px/1 system-ui, "Microsoft YaHei", sans-serif;
      cursor: pointer;
      box-shadow: 0 8px 24px rgba(0, 0, 0, .28);
    }

    #${PANEL_ID} {
      position: fixed;
      right: 14px;
      top: 14px;
      z-index: 2147483647;
      width: min(360px, calc(100vw - 28px));
      max-height: calc(100vh - 92px);
      box-sizing: border-box;
      padding: 14px;
      border: 1px solid rgba(255, 255, 255, .2);
      border-radius: 8px;
      background: rgba(22, 22, 24, .96);
      color: #f4f4f4;
      box-shadow: 0 14px 36px rgba(0, 0, 0, .36);
      font-family: system-ui, "Microsoft YaHei", sans-serif !important;
      font-size: 13px !important;
      line-height: 1.35 !important;
      overflow-y: auto;
      overscroll-behavior: contain;
    }

    #${PANEL_ID}[hidden] {
      display: none !important;
    }

    #${PANEL_ID} h2 {
      margin: 0 0 10px;
      color: #fff;
      font-size: 14px;
      line-height: 1.3;
    }

    #${PANEL_ID} .cgfc-hint {
      margin: -2px 0 8px;
      color: rgba(255, 255, 255, .68);
      font-size: 12px;
      line-height: 1.5;
    }

    #${PANEL_ID} .cgfc-font-scan {
      display: grid;
      gap: 6px;
      margin-bottom: 10px;
    }

    #${PANEL_ID} .cgfc-font-scan .cgfc-hint {
      margin: 0;
    }

    #${FONT_STATUS_ID}[data-error] {
      color: #f4bd72;
    }

    #${PANEL_ID} label {
      display: grid;
      gap: 5px;
      margin: 9px 0;
    }

    #${PANEL_ID} .cgfc-check {
      grid-template-columns: 16px 1fr;
      align-items: center;
      gap: 8px;
    }

    #${PANEL_ID} input,
    #${PANEL_ID} select {
      width: 100%;
      box-sizing: border-box;
      border: 1px solid rgba(255, 255, 255, .22);
      border-radius: 6px;
      padding: 7px 8px;
      background: #101012;
      color: #fff;
      font: 13px/1.35 system-ui, "Microsoft YaHei", sans-serif;
    }

    #${PANEL_ID} input[type="checkbox"] {
      width: 16px;
      height: 16px;
      padding: 0;
      border-radius: 5px;
      appearance: none;
      -webkit-appearance: none;
      display: grid;
      place-items: center;
      background: #101012;
      cursor: pointer;
    }

    #${PANEL_ID} input[type="checkbox"]:checked {
      border-color: #10a37f;
      background: #10a37f;
    }

    #${PANEL_ID} input[type="checkbox"]:checked::after {
      content: "";
      width: 5px;
      height: 9px;
      margin-top: -1px;
      border: solid #fff;
      border-width: 0 2px 2px 0;
      transform: rotate(45deg);
    }

    #${PANEL_ID} input[type="checkbox"]:focus-visible {
      outline: 2px solid rgba(78, 156, 255, .95);
      outline-offset: 2px;
    }

    #${PANEL_ID} input[type="color"] {
      height: 34px;
      padding: 3px;
    }

    #${PANEL_ID} .cgfc-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
    }

    #${PANEL_ID} .cgfc-actions {
      position: sticky;
      bottom: -14px;
      display: flex;
      gap: 8px;
      margin: 12px -14px -14px;
      padding: 10px 14px 14px;
      border-top: 1px solid rgba(255, 255, 255, .12);
      background: rgba(22, 22, 24, .98);
    }

    #${PANEL_ID} button {
      flex: 1;
      border: 1px solid rgba(255, 255, 255, .22);
      border-radius: 6px;
      padding: 8px;
      background: #2a2a2e;
      color: #fff;
      cursor: pointer;
      font: 13px/1 system-ui, "Microsoft YaHei", sans-serif;
    }

    #${PANEL_ID} button:hover,
    #${TOGGLE_ID}:hover {
      background: #38383d;
    }

    @media (max-width: 520px) {
      #${PANEL_ID} {
        left: 14px;
        right: 14px;
        width: auto;
      }

      #${PANEL_ID} .cgfc-row {
        grid-template-columns: 1fr;
        gap: 0;
      }
    }
  `;

  installAutoScrollLock();
  applySettings();
  startResidualLatexObserver();
  onReady(() => {
    ensureShell();

    if (!observersStarted) {
      observersStarted = true;
      startShellGuard();
      startNoticeObserver();
      startDisclaimerObserver();
    }
  });
})();
