// ==UserScript==
// @name         ChatGPT 长对话统一工具箱（性能·导航·提示词·导出·排版）
// @namespace    local.codex.chatgpt.unified
// @version      1.5.1
// @description  ChatGPT 长对话性能、导航、提示词、导出与排版工具箱；v1.5.1 新增可见文本 Token 估算，并让主要插件界面自动跟随 ChatGPT 浅色/深色主题。
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

  runtime.version = '1.5.1';
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
    constructor() {
      this.apiFailureLoggedFor = '';
      // 完整会话树只保存在内存中，不落盘，也不保存 accessToken。
      // 导出与完整问答目录共用这一份缓存，避免重复请求同一会话。
      this.apiTreeCache = {
        conversationId: '',
        tree: null,
        fetchedAt: 0,
        promise: null,
      };
      this.apiOutlineCache = {
        conversationId: '',
        currentNode: '',
        items: [],
      };
      this.apiTreeDefaultMaxAgeMs = 8000;
    }

    getConversationId() {
      const match = location.pathname.match(/\/c\/([0-9a-f-]{20,})/i);
      return match?.[1] || '';
    }

    getPageFetch() {
      try {
        if (typeof unsafeWindow !== 'undefined' && typeof unsafeWindow.fetch === 'function') {
          return unsafeWindow.fetch.bind(unsafeWindow);
        }
      } catch {}
      return window.fetch.bind(window);
    }

    getDomTitle() {
      return normalizeText(document.title.replace(/\s*[|·-]\s*ChatGPT.*$/i, '')) || 'ChatGPT 会话';
    }

    normalizeMessageBody(value) {
      return String(value ?? '')
        .replace(/\r\n?/g, '\n')
        .replace(/[ \t]+$/gm, '')
        .trim();
    }

    getTurnOrder(turn, fallbackIndex = 0) {
      const testId = turn?.getAttribute?.('data-testid') || '';
      const match = /conversation-turn-(\d+)/i.exec(testId);
      if (match) return Number.parseInt(match[1], 10);
      const dataTurn = turn?.getAttribute?.('data-turn') || turn?.getAttribute?.('data-turn-id') || '';
      const numeric = Number.parseInt(dataTurn, 10);
      return Number.isFinite(numeric) ? numeric : 1_000_000_000 + fallbackIndex;
    }

    getTurnNodes() {
      const bridged = runtime.lazy?.getAllTurnNodes?.();
      const turns = Array.isArray(bridged) && bridged.length
        ? bridged
        : Array.from(document.querySelectorAll('main [data-testid^="conversation-turn-"]'));
      const seen = new Set();
      return turns
        .filter((turn) => turn instanceof Element && !seen.has(turn) && seen.add(turn))
        .map((turn, index) => ({ turn, order: this.getTurnOrder(turn, index), index }))
        .sort((a, b) => a.order - b.order || a.index - b.index)
        .map((entry) => entry.turn);
    }

    extractContent(roleNode) {
      const source = roleNode.querySelector('.markdown, [data-message-content], .whitespace-pre-wrap') || roleNode;
      const markdown = normalizeText(nodeToMarkdown(source));
      return markdown || normalizeText(source.textContent);
    }

    collectDom() {
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
      return {
        schema: 'cgpt-unified-session-export/v1',
        source: 'dom',
        title: this.getDomTitle(),
        url: location.href,
        exportedAt: new Date().toISOString(),
        messages,
      };
    }

    getAttachmentNames(message) {
      const metadata = message?.metadata || {};
      const candidates = [
        ...(Array.isArray(metadata.attachments) ? metadata.attachments : []),
        ...(Array.isArray(metadata.files) ? metadata.files : []),
      ];
      const names = [];
      const seen = new Set();
      for (const item of candidates) {
        const name = String(
          item?.name || item?.file_name || item?.filename || item?.title || ''
        ).trim();
        if (!name || seen.has(name)) continue;
        seen.add(name);
        names.push(name);
      }
      return names;
    }

    extractApiPart(part) {
      if (typeof part === 'string') return part;
      if (!part || typeof part !== 'object') return '';

      const kind = String(part.content_type || part.type || '').toLowerCase();
      if (/image|audio|video|asset_pointer|file/.test(kind) || part.asset_pointer) return '';
      if (typeof part.text === 'string') return part.text;
      if (typeof part.content === 'string') return part.content;
      if (typeof part.caption === 'string') return part.caption;
      if (Array.isArray(part.parts)) return part.parts.map((item) => this.extractApiPart(item)).filter(Boolean).join('\n');
      return '';
    }

    extractApiContent(message) {
      const content = message?.content || {};
      const type = String(content.content_type || '').toLowerCase();
      const hiddenTypes = new Set([
        'thoughts',
        'reasoning',
        'reasoning_recap',
        'model_editable_context',
        'user_editable_context',
        'system_content',
      ]);
      if (hiddenTypes.has(type)) return '';

      let body = '';
      if (Array.isArray(content.parts)) {
        body = content.parts.map((part) => this.extractApiPart(part)).filter(Boolean).join('\n\n');
      } else if (typeof content.text === 'string') {
        body = content.text;
      } else if (typeof content.result === 'string') {
        body = content.result;
      }

      if (type === 'code' && body.trim()) {
        const language = String(content.language || message?.metadata?.language || '').trim();
        body = `\`\`\`${language}\n${body.replace(/\n+$/, '')}\n\`\`\``;
      }

      const attachments = this.getAttachmentNames(message);
      if (attachments.length) {
        const marker = `> [附件：${attachments.join('、')}]`;
        body = body.trim() ? `${marker}\n\n${body}` : marker;
      }

      return this.normalizeMessageBody(body);
    }

    isApiMessageVisible(message) {
      if (!message || typeof message !== 'object') return false;
      const role = message.author?.role;
      if (role !== 'user' && role !== 'assistant') return false;

      const metadata = message.metadata || {};
      if (
        metadata.is_visually_hidden_from_conversation === true
        || metadata.is_hidden === true
        || metadata.hidden === true
        || String(metadata.channel || '').toLowerCase() === 'analysis'
      ) return false;

      const recipient = String(message.recipient || 'all');
      if (role === 'assistant' && recipient && !['all', 'assistant'].includes(recipient)) return false;
      return true;
    }

    linearizeActiveBranch(tree) {
      const mapping = tree?.mapping;
      let currentId = tree?.current_node;
      if (!mapping || typeof mapping !== 'object' || !currentId || !mapping[currentId]) return [];

      const chain = [];
      const seen = new Set();
      while (currentId && mapping[currentId] && !seen.has(currentId)) {
        seen.add(currentId);
        const node = mapping[currentId];
        chain.push(node);
        currentId = node?.parent || '';
      }
      chain.reverse();
      return chain;
    }

    messagesFromApiTree(tree) {
      const messages = [];
      for (const node of this.linearizeActiveBranch(tree)) {
        const message = node?.message;
        if (!this.isApiMessageVisible(message)) continue;
        const content = this.extractApiContent(message);
        if (!content) continue;
        const role = message.author.role;
        const id = String(message.id || node.id || `api-${messages.length}`);

        // Tool-assisted answers can contain several adjacent visible assistant
        // fragments. Merge them so the export matches the single response shown
        // in the UI instead of creating artificial extra turns.
        const previous = messages[messages.length - 1];
        if (previous?.role === role && role === 'assistant') {
          previous.content = this.normalizeMessageBody(`${previous.content}\n\n${content}`);
          previous.sourceIds = [...(previous.sourceIds || [previous.id]), id];
          continue;
        }

        messages.push({
          index: messages.length,
          id,
          role,
          content,
          ...(Number.isFinite(Number(message.create_time)) ? { createTime: Number(message.create_time) } : {}),
        });
      }
      messages.forEach((message, index) => { message.index = index; });
      return messages;
    }

    invalidateApiTreeCache(conversationId = '') {
      const currentId = this.getConversationId();
      if (conversationId && currentId && conversationId !== currentId) return;
      this.apiTreeCache = { conversationId: currentId, tree: null, fetchedAt: 0, promise: null };
      this.apiOutlineCache = { conversationId: currentId, currentNode: '', items: [] };
    }

    buildConversationOutline(tree) {
      const items = [];
      for (const node of this.linearizeActiveBranch(tree)) {
        const message = node?.message;
        if (!this.isApiMessageVisible(message) || message.author?.role !== 'user') continue;
        const fullLabel = this.extractApiContent(message);
        if (!fullLabel) continue;
        const messageId = String(message.id || node.id || `api-user-${items.length}`);
        items.push({
          logicalIndex: items.length,
          messageId,
          nodeId: String(node.id || ''),
          fullLabel,
          ...(Number.isFinite(Number(message.create_time)) ? { createTime: Number(message.create_time) } : {}),
        });
      }
      return items;
    }

    getCachedConversationOutlineSync() {
      const conversationId = this.getConversationId();
      const cache = this.apiTreeCache;
      if (!conversationId || cache.conversationId !== conversationId || !cache.tree) return null;
      const currentNode = String(cache.tree.current_node || '');
      if (
        this.apiOutlineCache.conversationId !== conversationId
        || this.apiOutlineCache.currentNode !== currentNode
      ) {
        this.apiOutlineCache = {
          conversationId,
          currentNode,
          items: this.buildConversationOutline(cache.tree),
        };
      }
      return {
        conversationId,
        currentNode,
        title: this.normalizeMessageBody(cache.tree.title) || this.getDomTitle(),
        items: this.apiOutlineCache.items,
        fetchedAt: cache.fetchedAt,
      };
    }

    async fetchConversationTree(options = {}) {
      const conversationId = this.getConversationId();
      if (!conversationId) return null;

      const force = Boolean(options.force);
      const maxAgeMs = Math.max(0, Number(options.maxAgeMs ?? this.apiTreeDefaultMaxAgeMs) || 0);
      const cache = this.apiTreeCache;
      if (
        !force
        && cache.conversationId === conversationId
        && cache.tree
        && Date.now() - cache.fetchedAt <= maxAgeMs
      ) {
        return { conversationId, tree: cache.tree, cached: true };
      }
      if (cache.conversationId === conversationId && cache.promise) return cache.promise;

      const request = (async () => {
        const pageFetch = this.getPageFetch();
        const sessionResponse = await pageFetch('/api/auth/session', {
          credentials: 'include',
          cache: 'no-store',
          headers: { Accept: 'application/json' },
        });
        if (!sessionResponse.ok) throw new Error(`读取登录会话失败（HTTP ${sessionResponse.status}）`);

        const authSession = await sessionResponse.json();
        const accessToken = authSession?.accessToken;
        if (!accessToken) throw new Error('当前登录会话没有可用 accessToken');

        const response = await pageFetch(`/backend-api/conversation/${encodeURIComponent(conversationId)}`, {
          method: 'GET',
          credentials: 'include',
          cache: 'no-store',
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
        });
        if (!response.ok) throw new Error(`读取完整会话失败（HTTP ${response.status}）`);

        const tree = await response.json();
        if (!tree?.mapping || !tree?.current_node) throw new Error('完整会话接口返回的数据结构不完整');

        if (this.getConversationId() === conversationId) {
          this.apiTreeCache = { conversationId, tree, fetchedAt: Date.now(), promise: null };
          this.apiOutlineCache = { conversationId, currentNode: '', items: [] };
        }
        return { conversationId, tree, cached: false };
      })();

      this.apiTreeCache = {
        conversationId,
        tree: cache.conversationId === conversationId ? cache.tree : null,
        fetchedAt: cache.conversationId === conversationId ? cache.fetchedAt : 0,
        promise: request,
      };
      try {
        return await request;
      } finally {
        if (this.apiTreeCache.conversationId === conversationId && this.apiTreeCache.promise === request) {
          this.apiTreeCache.promise = null;
        }
      }
    }

    async getConversationOutline(options = {}) {
      const payload = await this.fetchConversationTree(options);
      if (!payload) return null;
      const { conversationId, tree } = payload;
      const items = this.buildConversationOutline(tree);
      if (this.getConversationId() === conversationId) {
        this.apiOutlineCache = {
          conversationId,
          currentNode: String(tree.current_node || ''),
          items,
        };
      }
      return {
        conversationId,
        currentNode: String(tree.current_node || ''),
        title: this.normalizeMessageBody(tree.title) || this.getDomTitle(),
        items,
        fetchedAt: this.apiTreeCache.fetchedAt,
      };
    }

    getCachedActiveMessagesSync() {
      const conversationId = this.getConversationId();
      const cache = this.apiTreeCache;
      if (!conversationId || cache.conversationId !== conversationId || !cache.tree) return null;
      return {
        conversationId,
        currentNode: String(cache.tree.current_node || ''),
        fetchedAt: cache.fetchedAt,
        messages: this.messagesFromApiTree(cache.tree),
      };
    }

    async getActiveMessages(options = {}) {
      const payload = await this.fetchConversationTree(options);
      if (!payload) return null;
      const { conversationId, tree } = payload;
      return {
        conversationId,
        currentNode: String(tree.current_node || ''),
        fetchedAt: this.apiTreeCache.fetchedAt,
        messages: this.messagesFromApiTree(tree),
      };
    }

    async collectApi() {
      // 用户主动导出时优先保证“此刻完整”，不能因为目录缓存而漏掉刚发送的消息。
      const payload = await this.fetchConversationTree({ force: true, maxAgeMs: 0 });
      if (!payload) return null;
      const { conversationId, tree } = payload;
      const messages = this.messagesFromApiTree(tree);
      if (!messages.length) throw new Error('完整会话接口没有解析出可见的用户/助手消息');

      return {
        schema: 'cgpt-unified-session-export/v1',
        source: 'api',
        conversationId,
        title: this.normalizeMessageBody(tree.title) || this.getDomTitle(),
        url: location.href,
        exportedAt: new Date().toISOString(),
        messages,
      };
    }

    async collect() {
      const conversationId = this.getConversationId();
      if (conversationId) {
        try {
          const apiSession = await this.collectApi();
          if (apiSession?.messages?.length) return apiSession;
        } catch (error) {
          const key = `${conversationId}:${error?.message || error}`;
          if (this.apiFailureLoggedFor !== key) {
            this.apiFailureLoggedFor = key;
            console.warn('[ChatGPT 会话导出] API 完整导出失败，回退到 DOM 快照：', error);
          }
        }
      }
      return this.collectDom();
    }

    toMarkdown(session) {
      const lines = [
        `# ${session.title}`,
        '',
        `- 导出时间：${session.exportedAt}`,
        `- 来源：${session.url}`,
        `- 消息数：${session.messages.length}`,
        `- 数据源：${session.source === 'api' ? 'ChatGPT 完整会话接口（当前分支）' : '页面 DOM 快照（回退模式）'}`,
        '',
        '---',
        '',
      ];
      session.messages.forEach((message, index) => {
        lines.push(`## ${message.role === 'user' ? '用户' : 'ChatGPT'} · ${index + 1}`, '', message.content, '', '---', '');
      });
      return lines.join('\n');
    }

    toText(session) {
      return session.messages.map((message, index) =>
        `[${index + 1}] ${message.role === 'user' ? '用户' : 'ChatGPT'}\n${message.content}`
      ).join('\n\n' + '-'.repeat(72) + '\n\n');
    }

    serialize(format, session) {
      if (format === 'json') return JSON.stringify(session, null, 2);
      if (format === 'txt') return this.toText(session);
      return this.toMarkdown(session);
    }

    async download(format = 'markdown') {
      let session;
      try {
        session = await this.collect();
      } catch (error) {
        console.error('[ChatGPT 会话导出] 导出失败：', error);
        window.alert(`导出失败：${error?.message || error}`);
        return false;
      }
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
      let session;
      try {
        session = await this.collect();
      } catch (error) {
        console.error('[ChatGPT 会话导出] 复制失败：', error);
        return false;
      }
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

  class TokenStatsController {
    constructor(exporter) {
      this.exporter = exporter;
      this.rootId = 'cgpt-unified-token-stats';
      this.chipAttr = 'data-cgpt-token-chip';
      this.enabledAttr = 'data-cgpt-token-stats-enabled';
      this.messageChipsAttr = 'data-cgpt-token-message-chips-enabled';
      this.summaryAttr = 'data-cgpt-token-summary-enabled';
      this.summaryPositionAttr = 'data-cgpt-token-summary-position';
      this.summaryOffsetXAttr = 'data-cgpt-token-summary-offset-x';
      this.summaryOffsetYAttr = 'data-cgpt-token-summary-offset-y';
      this.summaryCompactAttr = 'data-cgpt-token-summary-compact-narrow';
      this.summaryCompactAlwaysAttr = 'data-cgpt-token-summary-compact-always';
      this.summaryAvoidQueueAttr = 'data-cgpt-token-summary-avoid-queue';
      this.apiMaxAgeMs = 60000;
      this.domDebounceMs = 240;
      this.active = false;
      this.href = location.href;
      this.observer = null;
      this.observationRoot = null;
      this.refreshTimer = 0;
      this.mutationTimer = 0;
      this.positionRaf = 0;
      this.lastGenerating = false;
      this.apiFailureKey = '';
      this.onSettingsChange = () => {
        this.syncEnabledState();
        if (this.active) {
          this.syncSubfeatureVisibility();
          this.schedulePosition();
        }
      };
      this.onViewportChange = () => this.schedulePosition();
    }

    init() {
      if (this.initialized) return;
      this.initialized = true;
      document.addEventListener('cgpt-unified-ui-settings-change', this.onSettingsChange);
      this.syncEnabledState();
    }

    destroy() {
      if (!this.initialized) return;
      document.removeEventListener('cgpt-unified-ui-settings-change', this.onSettingsChange);
      this.initialized = false;
      this.stop();
    }

    isEnabled() {
      return document.documentElement?.hasAttribute(this.enabledAttr) === true;
    }

    isSubfeatureEnabled(attr) {
      return document.documentElement?.hasAttribute(attr) === true;
    }

    showMessageChips() {
      return this.isSubfeatureEnabled(this.messageChipsAttr, true);
    }

    showSummary() {
      return this.isSubfeatureEnabled(this.summaryAttr, true);
    }

    compactOnNarrow() {
      return this.isSubfeatureEnabled(this.summaryCompactAttr, true);
    }

    compactAlways() {
      return this.isSubfeatureEnabled(this.summaryCompactAlwaysAttr, false);
    }

    avoidQueue() {
      return this.isSubfeatureEnabled(this.summaryAvoidQueueAttr, true);
    }

    summaryPosition() {
      return document.documentElement?.getAttribute(this.summaryPositionAttr) || 'auto';
    }

    summaryOffset(attr) {
      const value = Number.parseFloat(document.documentElement?.getAttribute(attr) || '0');
      return Number.isFinite(value) ? value : 0;
    }

    syncSubfeatureVisibility() {
      if (!this.showMessageChips()) this.removeMessageChips();
      if (!this.showSummary()) this.removeSummary();
      else this.scheduleRefresh(false);
    }

    syncEnabledState() {
      if (this.isEnabled()) this.start();
      else this.stop();
    }

    start() {
      if (this.active) {
        this.bindObserver();
        this.syncSubfeatureVisibility();
        this.scheduleRefresh(false);
        this.schedulePosition();
        return;
      }
      this.active = true;
      this.href = location.href;
      this.bindObserver();
      window.addEventListener('resize', this.onViewportChange, { passive: true });
      window.addEventListener('scroll', this.onViewportChange, { capture: true, passive: true });
      window.visualViewport?.addEventListener('resize', this.onViewportChange, { passive: true });
      window.visualViewport?.addEventListener('scroll', this.onViewportChange, { passive: true });
      this.scheduleRefresh(true);
      this.refreshTimer = window.setInterval(() => {
        if (!this.active) return;
        this.bindObserver();
        const routeChanged = location.href !== this.href;
        if (routeChanged) {
          this.href = location.href;
          this.exporter.invalidateApiTreeCache();
          this.scheduleRefresh(true);
          return;
        }
        this.scheduleRefresh(false);
        this.schedulePosition();
      }, 4000);
    }

    stop() {
      this.active = false;
      clearInterval(this.refreshTimer);
      clearTimeout(this.mutationTimer);
      if (this.positionRaf) cancelAnimationFrame(this.positionRaf);
      this.refreshTimer = 0;
      this.mutationTimer = 0;
      this.positionRaf = 0;
      window.removeEventListener('resize', this.onViewportChange);
      window.removeEventListener('scroll', this.onViewportChange, true);
      window.visualViewport?.removeEventListener('resize', this.onViewportChange);
      window.visualViewport?.removeEventListener('scroll', this.onViewportChange);
      this.observer?.disconnect();
      this.observer = null;
      this.observationRoot = null;
      this.removeUi();
    }

    removeSummary() {
      document.getElementById(this.rootId)?.remove();
    }

    removeMessageChips() {
      document.querySelectorAll(`[${this.chipAttr}]`).forEach((node) => node.remove());
    }

    removeUi() {
      this.removeSummary();
      this.removeMessageChips();
    }

    bindObserver() {
      if (!this.active) return;
      const target = document.querySelector('main') || document.body;
      if (!target || target === this.observationRoot) return;
      this.observer?.disconnect();
      this.observationRoot = target;
      this.observer = new MutationObserver((records) => {
        const externalChange = records.some((record) => !this.isOwnMutation(record));
        if (!externalChange) return;
        const generating = this.isGenerating();
        const justFinished = this.lastGenerating && !generating;
        this.lastGenerating = generating;
        this.scheduleRefresh(justFinished);
      });
      this.observer.observe(target, { childList: true, subtree: true, characterData: true });
    }

    isOwnMutation(record) {
      const target = record.target?.nodeType === Node.ELEMENT_NODE
        ? record.target
        : record.target?.parentElement;
      if (target instanceof Element && target.closest(`#${this.rootId}, [${this.chipAttr}]`)) return true;
      const changed = [...(record.addedNodes || []), ...(record.removedNodes || [])];
      return changed.length > 0 && changed.every((node) => {
        if (!(node instanceof Element)) return false;
        return node.matches(`[${this.chipAttr}]`) || Boolean(node.closest(`[${this.chipAttr}]`));
      });
    }

    formatCount(value) {
      const n = Math.max(0, Math.round(Number(value) || 0));
      if (n < 1000) return String(n);
      if (n < 10000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
      return `${Math.round(n / 1000)}k`;
    }

    estimateTokens(input) {
      const text = normalizeText(input);
      if (!text) return 0;
      let score = 0;
      let asciiRun = '';
      const flushAscii = () => {
        if (!asciiRun) return;
        score += Math.max(1, asciiRun.length / 4.05);
        asciiRun = '';
      };

      for (const ch of text) {
        const cp = ch.codePointAt(0);
        if (cp <= 0x7f && /[A-Za-z0-9_]/.test(ch)) {
          asciiRun += ch;
          continue;
        }
        flushAscii();
        if (/\s/.test(ch)) score += 0.06;
        else if (
          (cp >= 0x3400 && cp <= 0x4dbf)
          || (cp >= 0x4e00 && cp <= 0x9fff)
          || (cp >= 0xf900 && cp <= 0xfaff)
        ) score += 0.72;
        else if (
          (cp >= 0x3040 && cp <= 0x30ff)
          || (cp >= 0xac00 && cp <= 0xd7af)
        ) score += 0.78;
        else if (cp <= 0x7f) score += /[.,;:!?()[\]{}'"`~@#$%^&*+=<>/\\|-]/.test(ch) ? 0.55 : 0.35;
        else if (cp >= 0x1f000) score += 1.65;
        else score += 0.95;
      }
      flushAscii();
      return Math.max(1, Math.round(score));
    }

    withTokenCounts(messages) {
      return (Array.isArray(messages) ? messages : []).map((message) => ({
        ...message,
        tokens: this.estimateTokens(message.content),
      }));
    }

    getAttachedRoleNodes() {
      return Array.from(document.querySelectorAll('main [data-message-author-role]')).filter((node) => {
        const role = node.getAttribute('data-message-author-role');
        return (role === 'user' || role === 'assistant') && !node.parentElement?.closest('[data-message-author-role]');
      });
    }

    extractAttachedContent(roleNode) {
      const source = roleNode.querySelector('.markdown, [data-message-content], .whitespace-pre-wrap') || roleNode;
      const clone = source.cloneNode(true);
      clone.querySelectorAll?.(`[${this.chipAttr}]`).forEach((node) => node.remove());
      return normalizeText(clone.innerText || clone.textContent || '');
    }

    collectAttachedMessages() {
      return this.getAttachedRoleNodes().map((node, index) => {
        const role = node.getAttribute('data-message-author-role');
        const id = node.getAttribute('data-message-id')
          || node.closest('[data-message-id]')?.getAttribute('data-message-id')
          || `dom-${index}`;
        const content = this.extractAttachedContent(node);
        return { id, role, content, tokens: this.estimateTokens(content) };
      }).filter((message) => message.content);
    }

    latestRound(messages) {
      let userIndex = -1;
      for (let index = messages.length - 1; index >= 0; index -= 1) {
        if (messages[index].role === 'user') {
          userIndex = index;
          break;
        }
      }
      if (userIndex < 0) return { input: 0, output: 0 };
      let output = 0;
      for (let index = userIndex + 1; index < messages.length; index += 1) {
        if (messages[index].role === 'user') break;
        if (messages[index].role === 'assistant') output += messages[index].tokens || 0;
      }
      return { input: messages[userIndex].tokens || 0, output };
    }

    mergeStreamingTail(apiMessages, domMessages) {
      if (!apiMessages.length) return domMessages;
      if (!domMessages.length) return apiMessages;
      let apiUser = -1;
      let domUser = -1;
      for (let index = apiMessages.length - 1; index >= 0; index -= 1) {
        if (apiMessages[index].role === 'user') { apiUser = index; break; }
      }
      for (let index = domMessages.length - 1; index >= 0; index -= 1) {
        if (domMessages[index].role === 'user') { domUser = index; break; }
      }
      if (apiUser < 0 || domUser < 0) return apiMessages;
      return [...apiMessages.slice(0, apiUser), ...domMessages.slice(domUser)];
    }

    ensureStyles() {
      const styleId = `${this.rootId}-style`;
      if (document.getElementById(styleId)) return;
      const style = document.createElement('style');
      style.id = styleId;
      style.textContent = `
        #${this.rootId} {
          position: fixed; left: 10px; top: 10px;
          z-index: 2147482400; color: var(--cgfc-token-summary-text-color, var(--cgfc-theme-text-primary, var(--text-primary, #161616)));
          font: 12px/1.35 ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          pointer-events: none;
        }
        #${this.rootId} .cgpt-token-pill {
          display: flex; align-items: center; gap: 7px; padding: 7px 10px;
          border: 1px solid var(--cgfc-token-summary-border-color, var(--cgfc-theme-border, color-mix(in srgb, currentColor 16%, transparent))); border-radius: 999px;
          background: var(--cgfc-token-summary-background-color, color-mix(in srgb, var(--cgfc-theme-surface-primary, var(--main-surface-primary, var(--bg-primary, #fff))) 92%, transparent)); box-shadow: var(--cgfc-theme-shadow-soft, 0 4px 16px rgba(0,0,0,.10));
          backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
          cursor: default; user-select: none; white-space: nowrap; pointer-events: auto;
        }
        #${this.rootId} .cgpt-token-muted { opacity: .58; }
        #${this.rootId} .cgpt-token-sep { opacity: .22; }
        #${this.rootId} .cgpt-token-compact { display: none; font-variant-numeric: tabular-nums; letter-spacing: .01em; }
        #${this.rootId}[data-compact="true"] .cgpt-token-full { display: none; }
        #${this.rootId}[data-compact="true"] .cgpt-token-compact { display: inline; }
        [${this.chipAttr}] {
          display: inline-flex; align-items: center; margin-inline-start: 6px; padding: 1px 5px;
          border: 1px solid color-mix(in srgb, currentColor 13%, transparent); border-radius: 999px;
          font: 10px/1.35 ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          opacity: .52; vertical-align: middle; white-space: nowrap; user-select: none;
        }
        @media (max-width: 640px) {
          #${this.rootId} { font-size: 11px; }
          #${this.rootId} .cgpt-token-pill { gap: 5px; padding: 6px 8px; }
        }
      `;
      (document.head || document.documentElement)?.appendChild(style);
    }

    ensureSummary() {
      if (!this.showSummary() || !document.body || !this.exporter.getConversationId()) return null;
      this.ensureStyles();
      let root = document.getElementById(this.rootId);
      if (root) return root;
      root = document.createElement('div');
      root.id = this.rootId;
      root.innerHTML = '<div class="cgpt-token-pill"><span class="cgpt-token-full"><span data-slot="input">输入 ≈0 tok</span><span class="cgpt-token-sep"> · </span><span data-slot="output">输出 ≈0 tok</span><span class="cgpt-token-sep"> · </span><span class="cgpt-token-muted" data-slot="context">可见上下文 ≈0 tok</span></span><span class="cgpt-token-compact" data-slot="compact">0/0/0</span></div>';
      document.body.appendChild(root);
      return root;
    }

    renderSummary(messages) {
      if (!this.showSummary()) {
        this.removeSummary();
        return;
      }
      const root = this.ensureSummary();
      if (!root) return;
      const round = this.latestRound(messages);
      const total = messages.reduce((sum, message) => sum + (message.tokens || 0), 0);
      const input = this.formatCount(round.input);
      const output = this.formatCount(round.output);
      const context = this.formatCount(total);
      root.querySelector('[data-slot="input"]').textContent = `输入 ≈${input} tok`;
      root.querySelector('[data-slot="output"]').textContent = `输出 ≈${output} tok`;
      root.querySelector('[data-slot="context"]').textContent = `可见上下文 ≈${context} tok`;
      root.querySelector('[data-slot="compact"]').textContent = `${input}/${output}/${context}`;
      const pill = root.querySelector('.cgpt-token-pill');
      const title = `可见文本 Token 估算：输入 ≈${input}，输出 ≈${output}，可见上下文 ≈${context}。不包含系统指令、记忆、工具定义、隐藏推理等服务端上下文，因此不是官方 usage。`;
      pill?.setAttribute('title', title);
      pill?.setAttribute('aria-label', title);
      const compact = this.compactAlways()
        || (this.compactOnNarrow() && (window.visualViewport?.width || window.innerWidth || 0) <= 640);
      root.dataset.compact = String(compact);
      this.schedulePosition();
    }

    renderMessageChips() {
      if (!this.showMessageChips()) {
        this.removeMessageChips();
        return;
      }
      for (const roleNode of this.getAttachedRoleNodes()) {
        const content = this.extractAttachedContent(roleNode);
        if (!content) continue;
        const value = `≈${this.formatCount(this.estimateTokens(content))} tok`;
        let chip = roleNode.querySelector(`:scope > [${this.chipAttr}]`);
        if (!chip) {
          chip = document.createElement('span');
          chip.setAttribute(this.chipAttr, '1');
          chip.title = '可见文本 Token 估算值，不是官方 usage';
          roleNode.appendChild(chip);
        }
        if (chip.textContent !== value) chip.textContent = value;
      }
    }

    findComposerForSummary() {
      const fromRuntime = runtime.promptLibrary?.findComposer?.();
      if (fromRuntime instanceof Element) return fromRuntime;
      return document.querySelector([
        '#prompt-textarea',
        '.ProseMirror[contenteditable="true"]',
        '[contenteditable="true"][role="textbox"]',
        'textarea[name="prompt-textarea"]',
      ].join(', '));
    }

    resolveComposerShellForSummary(composer) {
      if (!(composer instanceof Element)) return null;
      const fromQueue = runtime.composerQueueDock?.resolveComposerShell?.(composer);
      if (fromQueue instanceof Element) return fromQueue;
      return composer.closest('form[data-type*="composer" i], form[class*="composer" i], [data-testid*="composer" i], form')
        || composer.parentElement
        || composer;
    }

    getVisibleQueueRects() {
      return Array.from(document.querySelectorAll('.cgpt-queue-capsule, .cgpt-queue-panel'))
        .filter((node) => {
          if (!(node instanceof HTMLElement) || node.hidden || !node.isConnected) return false;
          const style = getComputedStyle(node);
          if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity || 1) <= 0) return false;
          const rect = node.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        })
        .map((node) => node.getBoundingClientRect());
    }

    rectsOverlap(a, b, padding = 6) {
      return a.left < b.right + padding
        && a.right > b.left - padding
        && a.top < b.bottom + padding
        && a.bottom > b.top - padding;
    }

    schedulePosition() {
      if (!this.active || !this.showSummary() || this.positionRaf) return;
      this.positionRaf = window.requestAnimationFrame(() => {
        this.positionRaf = 0;
        this.refreshPosition();
      });
    }

    refreshPosition() {
      const root = document.getElementById(this.rootId);
      if (!(root instanceof HTMLElement) || !this.showSummary()) return;

      const visualViewport = window.visualViewport;
      const viewportLeft = Math.max(0, visualViewport?.offsetLeft || 0);
      const viewportTop = Math.max(0, visualViewport?.offsetTop || 0);
      const viewportWidth = Math.max(240, visualViewport?.width || document.documentElement.clientWidth || window.innerWidth || 320);
      const viewportHeight = Math.max(240, visualViewport?.height || document.documentElement.clientHeight || window.innerHeight || 320);
      const viewportRight = viewportLeft + viewportWidth;
      const viewportBottom = viewportTop + viewportHeight;
      const edge = 10;

      const compact = this.compactAlways() || (this.compactOnNarrow() && viewportWidth <= 640);
      root.dataset.compact = String(compact);
      const measured = root.getBoundingClientRect();
      const width = Math.max(1, measured.width);
      const height = Math.max(1, measured.height);

      const composer = this.findComposerForSummary();
      const shell = this.resolveComposerShellForSummary(composer);
      const composerRect = shell instanceof Element ? shell.getBoundingClientRect() : null;
      const offsetX = this.summaryOffset(this.summaryOffsetXAttr);
      const offsetY = this.summaryOffset(this.summaryOffsetYAttr);

      const clampPoint = (point) => ({
        left: Math.min(viewportRight - edge - width, Math.max(viewportLeft + edge, point.left + offsetX)),
        top: Math.min(viewportBottom - edge - height, Math.max(viewportTop + edge, point.top + offsetY)),
      });
      const makeRect = (point) => ({
        left: point.left,
        top: point.top,
        right: point.left + width,
        bottom: point.top + height,
      });
      const candidate = (position) => {
        if (position === 'viewport-bottom-left') return clampPoint({ left: viewportLeft + edge, top: viewportBottom - edge - height });
        if (position === 'viewport-bottom-right') return clampPoint({ left: viewportRight - edge - width, top: viewportBottom - edge - height });
        if (!composerRect || composerRect.width <= 0 || composerRect.height <= 0) {
          return clampPoint({ left: viewportRight - edge - width, top: viewportBottom - edge - height - 70 });
        }
        const top = composerRect.top - height - 8;
        if (position === 'composer-top-left') return clampPoint({ left: composerRect.left + 8, top });
        if (position === 'composer-top-right') return clampPoint({ left: composerRect.right - width - 8, top });
        return clampPoint({ left: composerRect.left + (composerRect.width - width) / 2, top });
      };

      const requested = this.summaryPosition();
      const queueRects = this.avoidQueue() ? this.getVisibleQueueRects() : [];
      const collides = (point) => queueRects.some((queueRect) => this.rectsOverlap(makeRect(point), queueRect));
      let point;

      if (requested === 'auto') {
        const order = [
          'composer-top-center',
          'composer-top-left',
          'composer-top-right',
          'viewport-bottom-left',
          'viewport-bottom-right',
        ];
        point = order.map(candidate).find((item) => !collides(item)) || candidate('composer-top-center');
      } else {
        point = candidate(requested);
        if (queueRects.length && collides(point)) {
          const overlapping = queueRects.find((queueRect) => this.rectsOverlap(makeRect(point), queueRect));
          if (overlapping) {
            const nudged = clampPoint({ left: point.left - offsetX, top: overlapping.top - height - 8 - offsetY });
            if (!collides(nudged)) point = nudged;
          }
        }
      }

      root.style.left = `${Math.round(point.left)}px`;
      root.style.top = `${Math.round(point.top)}px`;
      root.style.removeProperty('right');
      root.style.removeProperty('bottom');
    }

    isGenerating() {
      return Boolean(document.querySelector('[data-testid="stop-button"], button[aria-label*="Stop" i], button[aria-label*="停止"]'));
    }

    async refresh({ forceApi = false } = {}) {
      if (!this.active || !this.isEnabled()) return;
      if (!this.exporter.getConversationId()) {
        this.removeUi();
        return;
      }
      const showChips = this.showMessageChips();
      const showSummary = this.showSummary();
      if (!showChips && !showSummary) {
        this.removeUi();
        return;
      }
      if (showChips) this.renderMessageChips();
      else this.removeMessageChips();
      if (!showSummary) {
        this.removeSummary();
        return;
      }
      const domMessages = this.collectAttachedMessages();
      let apiMessages = [];
      try {
        let result = this.exporter.getCachedActiveMessagesSync?.() || null;
        if (forceApi || !result) {
          result = await this.exporter.getActiveMessages({ force: forceApi, maxAgeMs: this.apiMaxAgeMs });
        }
        apiMessages = this.withTokenCounts(result?.messages || []);
        this.apiFailureKey = '';
      } catch (error) {
        const key = String(error?.message || error);
        if (key !== this.apiFailureKey) {
          this.apiFailureKey = key;
          console.debug('[Token Stats] 完整会话缓存暂不可用，回退到当前 DOM：', error);
        }
      }
      const generating = this.isGenerating();
      this.lastGenerating = generating;
      const messages = generating
        ? this.mergeStreamingTail(apiMessages, domMessages)
        : (apiMessages.length ? apiMessages : domMessages);
      this.renderSummary(messages);
    }

    scheduleRefresh(forceApi = false) {
      if (!this.active) return;
      clearTimeout(this.mutationTimer);
      this.mutationTimer = window.setTimeout(() => {
        this.refresh({ forceApi }).catch((error) => console.debug('[Token Stats] refresh failed:', error));
      }, this.domDebounceMs);
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
        .prompt-toolbar, .session-export-toolbar { display: flex; flex: none; gap: 4px; padding: 4px 5px; border-bottom: 1px solid var(--cgfc-theme-border, var(--border-light, rgba(0,0,0,.1))); }
        .prompt-toolbar input, .prompt-toolbar select, .prompt-editor input, .prompt-editor textarea { min-width: 0; border: 1px solid var(--cgfc-theme-border, var(--border-light, rgba(0,0,0,.16))); border-radius: 7px; background: var(--cgfc-theme-surface-primary, var(--main-surface-primary, var(--bg-primary, #fff))); color: var(--cgfc-theme-text-primary, var(--text-primary, #161616)); font: inherit; color-scheme: var(--cgfc-color-scheme, light); }
        .prompt-toolbar input { flex: 1; padding: 4px 6px; }
        .prompt-toolbar select { max-width: 84px; padding: 3px 4px; }
        .prompt-mini-btn { flex: none; min-height: 27px; padding: 3px 6px; border: 0; border-radius: 7px; background: var(--cgfc-theme-surface-secondary, var(--main-surface-secondary, var(--bg-secondary, #eee))); color: var(--cgfc-theme-text-primary, var(--text-primary, #161616)); font: inherit; cursor: pointer; white-space: nowrap; }
        .prompt-mini-btn:hover { background: color-mix(in srgb, var(--cgfc-theme-text-primary, currentColor) 8%, var(--cgfc-theme-surface-secondary, transparent)); }
        .prompt-mini-btn[hidden] { display: none !important; }
        .prompt-mini-btn.danger { margin-right: auto; background: color-mix(in srgb, #dc2626 14%, var(--cgfc-theme-surface-secondary, var(--main-surface-secondary, var(--bg-secondary, #eee)))); color: #dc2626; }
        .session-export-toolbar { align-items: center; color: var(--cgfc-theme-text-tertiary, var(--text-tertiary, #777)); font-size: 11px; }
        .session-export-toolbar > span:first-child { flex: none; white-space: nowrap; }
        .session-export-toolbar .prompt-mini-btn { min-height: 24px; padding: 2px 5px; font-size: 11px; }
        .prompt-list { min-height: 0; flex: 1; overflow-y: auto; padding: 6px; scrollbar-width: thin; }
        .prompt-card { position: relative; margin-bottom: 5px; padding: 8px; border: 1px solid transparent; border-radius: 9px; background: color-mix(in srgb, var(--cgfc-theme-surface-secondary, var(--main-surface-secondary, #eee)) 58%, transparent); cursor: grab; transition: border-color 120ms ease, opacity 120ms ease, transform 120ms ease; }
        .prompt-card[data-pinned="true"] { border-color: color-mix(in srgb, #d99b18 45%, transparent); }
        .prompt-card.dragging { opacity: .42; cursor: grabbing; }
        .prompt-card.drop-before::before, .prompt-card.drop-after::after { position: absolute; right: 5px; left: 5px; z-index: 2; height: 2px; border-radius: 99px; background: #6d5dfc; content: ''; pointer-events: none; }
        .prompt-card.drop-before::before { top: -4px; }
        .prompt-card.drop-after::after { bottom: -4px; }
        .prompt-card-main { width: 100%; min-width: 0; padding: 0 94px 5px 0; border: 0; background: transparent; color: inherit; text-align: start; cursor: pointer; }
        .prompt-card-title { display: flex; min-width: 0; gap: 6px; align-items: center; font-weight: 600; }
        .prompt-card-title-text { display: block; min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .prompt-card-category { flex: none; max-width: 42%; padding: 1px 5px; overflow: hidden; border-radius: 99px; background: color-mix(in srgb, currentColor 9%, transparent); color: var(--cgfc-theme-text-tertiary, var(--text-tertiary, #777)); font-size: 10px; font-weight: 400; text-overflow: ellipsis; white-space: nowrap; }
        .prompt-card-preview { display: -webkit-box; margin-top: 4px; overflow: hidden; -webkit-box-orient: vertical; -webkit-line-clamp: 2; color: var(--cgfc-theme-text-secondary, var(--text-secondary, #555)); font-size: 11.5px; white-space: pre-wrap; }
        .prompt-card-actions { position: absolute; top: 6px; right: 6px; display: flex; gap: 2px; opacity: 0; visibility: hidden; pointer-events: none; transform: translateY(-2px); transition: opacity 120ms ease, transform 120ms ease, visibility 120ms; }
        .prompt-card:hover .prompt-card-actions, .prompt-card:focus-within .prompt-card-actions { opacity: 1; visibility: visible; pointer-events: auto; transform: translateY(0); }
        .prompt-action-btn { display: grid; width: 28px; height: 28px; padding: 0; place-items: center; border: 0; border-radius: 7px; background: color-mix(in srgb, var(--cgfc-theme-surface-primary, var(--main-surface-primary, #fff)) 72%, transparent); color: var(--cgfc-theme-text-secondary, var(--text-secondary, #666)); cursor: pointer; }
        .prompt-action-btn:hover, .prompt-action-btn:focus-visible { background: var(--cgfc-theme-surface-primary, var(--main-surface-primary, var(--bg-primary, #fff))); color: var(--cgfc-theme-text-primary, var(--text-primary, #161616)); outline: none; }
        .prompt-action-btn.active { background: #6d5dfc; color: #fff; }
        .prompt-action-icon { display: block; width: 17px; height: 17px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
        .prompt-empty { padding: 24px 12px; color: var(--cgfc-theme-text-tertiary, var(--text-tertiary, #777)); text-align: center; font-size: 12px; }
        .toc-item[data-unloaded="true"] { color: var(--cgfc-theme-text-tertiary, var(--text-tertiary, #777)); font-style: italic; }
        .prompt-editor { width: min(520px, calc(100vw - 32px)); max-height: calc(100vh - 32px); padding: 0; overflow: hidden; border: 1px solid var(--cgfc-theme-border, var(--border-light, rgba(0,0,0,.18))); border-radius: 12px; background: var(--cgfc-theme-surface-primary, var(--main-surface-primary, var(--bg-primary, #fff))); color: var(--cgfc-theme-text-primary, var(--text-primary, #161616)); pointer-events: auto !important; color-scheme: var(--cgfc-color-scheme, light); }
        .prompt-editor::backdrop { background: var(--cgfc-theme-overlay, rgba(0,0,0,.45)); pointer-events: auto !important; }
        .prompt-editor-form { display: flex; flex-direction: column; gap: 9px; max-height: calc(100vh - 32px); padding: 16px; overflow-y: auto; overscroll-behavior: contain; }
        .prompt-editor h3 { margin: 0 0 3px; font-size: 16px; }
        .prompt-editor label { display: grid; gap: 4px; color: var(--cgfc-theme-text-secondary, var(--text-secondary, #555)); font-size: 12px; }
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
      actions.append(
        pin,
        this.makeIconButton('edit', '编辑', () => this.openEditor(item)),
      );
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
      ].join(', ')))].filter((element) => {
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
      });
      if (!candidates.length) return null;

      const viewportBottom = window.visualViewport
        ? window.visualViewport.offsetTop + window.visualViewport.height
        : (document.documentElement.clientHeight || window.innerHeight || 0);
      const score = (element) => {
        const rect = element.getBoundingClientRect();
        let value = 0;
        if (element.id === 'prompt-textarea') value += 120;
        if (element.matches('textarea[name="prompt-textarea"]')) value += 80;
        if (element.closest('form[data-type*="composer" i], form[class*="composer" i], [data-testid*="composer" i]')) value += 70;
        if (element.closest('[data-message-author-role], article, dialog, [role="dialog"]')) value -= 140;
        value += Math.max(0, 70 - Math.max(0, viewportBottom - rect.bottom) / 4);
        return value;
      };
      return candidates.sort((a, b) => score(b) - score(a))[0] || null;
    }

    insertIntoComposer(text, options = {}) {
      const composer = this.findComposer();
      if (!composer || typeof composer.focus !== 'function') {
        if (!options.silent) window.alert('没有找到 ChatGPT 输入框。请先打开一个可输入的会话。');
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

    queuePrompt(item) {
      const resolved = this.resolveVariables(item.content);
      if (resolved == null) return;
      const queued = runtime.messageQueue?.enqueue?.(resolved, { source: 'prompt', promptId: item.id });
      if (!queued) return;
      item.useCount += 1;
      item.lastUsedAt = new Date().toISOString();
      this.persist();
      this.render();
      this.renderQueue();
    }

    enqueueQueueInput() {
      const content = String(this.queueInput?.value || '').trim();
      if (!content) return;
      const queued = runtime.messageQueue?.enqueue?.(content, { source: 'manual' });
      if (!queued) return;
      this.queueInput.value = '';
      this.queueInput.focus({ preventScroll: true });
      this.renderQueue();
    }

    renderQueue() {
      if (!this.queueList) return;
      const queue = runtime.messageQueue;
      const snapshot = queue?.snapshot?.() || { items: [], isPaused: false };
      const items = snapshot.items || [];
      if (this.queueCount) this.queueCount.textContent = `发送队列 · ${items.length}`;
      if (this.queuePauseButton) {
        this.queuePauseButton.textContent = snapshot.isPaused ? '继续' : '暂停';
        this.queuePauseButton.title = snapshot.isPaused ? '继续自动发送队列' : '暂停自动发送队列';
      }

      const fragment = document.createDocumentFragment();
      if (!items.length) {
        const empty = document.createElement('div');
        empty.className = 'queue-empty';
        empty.textContent = snapshot.isPaused ? '队列为空 · 已暂停' : '队列为空';
        fragment.appendChild(empty);
      }
      const statusText = { pending: '等待', sending: '发送中', failed: '失败' };
      for (const item of items) {
        const row = document.createElement('div');
        row.className = 'queue-item';
        row.dataset.status = item.status;
        const text = document.createElement('div');
        text.className = 'queue-item-text';
        text.textContent = item.content.replace(/\s+/g, ' ').trim();
        text.title = item.content;
        const status = document.createElement('div');
        status.className = 'queue-item-status';
        status.textContent = item.status === 'pending' && queue?.isItemOnCurrentConversation?.(item) === false
          ? '等待原会话'
          : statusText[item.status] || item.status;
        const actions = document.createElement('div');
        actions.className = 'queue-item-actions';
        if (item.status === 'failed') {
          const retry = document.createElement('button');
          retry.type = 'button';
          retry.textContent = '↻';
          retry.title = '重试';
          retry.addEventListener('click', () => queue?.retry?.(item.id));
          actions.appendChild(retry);
        }
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.textContent = '×';
        remove.title = '移出队列';
        remove.addEventListener('click', () => queue?.remove?.(item.id));
        actions.appendChild(remove);
        row.append(text, status, actions);
        fragment.appendChild(row);
      }
      this.queueList.replaceChildren(fragment);
    }

    getComposerText(composer = this.findComposer()) {
      if (!composer) return '';
      const view = composer.ownerDocument?.defaultView || window;
      const TextareaCtor = view.HTMLTextAreaElement;
      const InputCtor = view.HTMLInputElement;
      if ((TextareaCtor && composer instanceof TextareaCtor) || (InputCtor && composer instanceof InputCtor)) {
        return String(composer.value || '');
      }
      return String(composer.innerText || composer.textContent || '');
    }

    hasComposerContent() {
      return this.getComposerText().replace(/[\u200B\u200C\u200D\uFEFF]/g, '').trim().length > 0;
    }

    composerContains(content) {
      const normalize = (value) => String(value || '')
        .replace(/[\u200B\u200C\u200D\uFEFF]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      const editor = normalize(this.getComposerText());
      const wanted = normalize(content);
      return Boolean(editor && wanted && (editor === wanted || editor.includes(wanted) || wanted.includes(editor)));
    }

    findSendButton(composer = this.findComposer()) {
      const selectors = [
        '#composer-submit-button:not([data-testid="stop-button"])',
        'button[data-testid="send-button"]',
        'button[data-testid="composer-send-button"]',
        'button[aria-label*="send" i]',
        'button[aria-label*="发送" i]',
      ].join(',');
      const candidates = Array.from(document.querySelectorAll(selectors));
      return candidates.find((button) => {
        if (!(button instanceof HTMLElement) || !button.isConnected) return false;
        if (button.disabled || button.hasAttribute('disabled') || button.getAttribute('aria-disabled') === 'true') return false;
        const style = getComputedStyle(button);
        const rect = button.getBoundingClientRect();
        if (style.display === 'none' || style.visibility === 'hidden' || rect.width <= 0 || rect.height <= 0) return false;
        if (!composer) return true;
        const form = button.closest('form');
        if (form?.contains(composer)) return true;
        const shell = button.closest('[data-testid*="composer"], [class*="composer"]');
        return Boolean(shell?.contains(composer));
      }) || null;
    }

    async submitComposer() {
      const composer = this.findComposer();
      if (!composer || !this.getComposerText(composer).trim()) return false;
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      let button = null;
      for (let attempt = 0; attempt < 24; attempt += 1) {
        button = this.findSendButton(composer);
        if (button) break;
        if (runtime.isGenerating?.()) return false;
        await wait(100);
      }

      runtime.armSendGuard?.();
      let dispatched = false;
      if (button) {
        button.click();
        dispatched = true;
      } else {
        const form = composer.closest('form');
        if (form && typeof form.requestSubmit === 'function') {
          try {
            form.requestSubmit();
            dispatched = true;
          } catch {}
        }
      }
      if (!dispatched) return false;

      for (let attempt = 0; attempt < 30; attempt += 1) {
        await wait(100);
        if (runtime.isGenerating?.()) return true;
        if (!this.getComposerText(this.findComposer()).replace(/[\u200B\u200C\u200D\uFEFF]/g, '').trim()) return true;
      }
      return false;
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

  class MessageQueue {
    constructor(runtimeRef) {
      this.runtime = runtimeRef;
      this.items = [];
      this.isPaused = false;
      this.listeners = new Set();
      this.timer = 0;
      this.idleCount = 0;
      this.isDispatching = false;
      this.awaitingResponse = null;
      this.POLL_INTERVAL = 1000;
      this.IDLE_THRESHOLD = 2;
      this.POST_SUBMIT_MIN_WAIT_MS = 2500;
      this.POST_SUBMIT_QUIET_MS = 2500;
      this.GENERATION_START_GRACE_MS = 8000;
      this.POST_SUBMIT_MAX_WAIT_MS = 600000;
    }

    snapshot() {
      return {
        items: this.items.map((item) => ({ ...item, metadata: item.metadata ? { ...item.metadata } : undefined })),
        isPaused: this.isPaused,
        isProcessing: this.items.some((item) => item.status === 'sending'),
        awaitingResponse: Boolean(this.awaitingResponse),
      };
    }

    subscribe(listener) {
      if (typeof listener !== 'function') return () => {};
      this.listeners.add(listener);
      try { listener(this.snapshot()); } catch {}
      return () => this.listeners.delete(listener);
    }

    emit() {
      const state = this.snapshot();
      this.listeners.forEach((listener) => {
        try { listener(state); } catch (error) { console.warn('[发送队列] UI 更新失败：', error); }
      });
    }

    enqueue(content, metadata = undefined) {
      const text = String(content || '').trim();
      if (!text) return null;
      const item = {
        id: `queue-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        content: text,
        createdAt: Date.now(),
        status: 'pending',
        metadata: {
          ...(metadata && typeof metadata === 'object' ? metadata : {}),
          conversationId: metadata?.conversationId ?? this.getConversationId(),
        },
      };
      this.items.push(item);
      this.emit();
      this.start();
      return item;
    }

    enqueueMany(values) {
      const created = [];
      for (const value of Array.isArray(values) ? values : []) {
        const item = typeof value === 'string'
          ? this.enqueue(value)
          : this.enqueue(value?.content, value?.metadata);
        if (item) created.push(item);
      }
      return created;
    }

    remove(id) {
      const before = this.items.length;
      this.items = this.items.filter((item) => item.id !== id);
      if (this.items.length !== before) this.emit();
    }

    clear() {
      this.items = [];
      this.idleCount = 0;
      this.emit();
    }

    retry(id) {
      const item = this.items.find((candidate) => candidate.id === id);
      if (!item) return false;
      item.status = 'pending';
      this.idleCount = 0;
      this.emit();
      return true;
    }

    pause() {
      if (this.isPaused) return;
      this.isPaused = true;
      this.idleCount = 0;
      this.emit();
    }

    resume() {
      if (!this.isPaused) return;
      this.isPaused = false;
      this.idleCount = 0;
      this.emit();
      this.start();
    }

    togglePause() {
      if (this.isPaused) this.resume();
      else this.pause();
    }

    start() {
      if (this.timer) return;
      this.timer = window.setInterval(() => this.tick(), this.POLL_INTERVAL);
      window.setTimeout(() => this.tick(), 80);
    }

    stop() {
      if (this.timer) window.clearInterval(this.timer);
      this.timer = 0;
      this.idleCount = 0;
    }

    getConversationId() {
      return location.pathname.match(/\/c\/([0-9a-f-]{20,})/i)?.[1] || '';
    }

    isItemOnCurrentConversation(item) {
      const bound = String(item?.metadata?.conversationId || '');
      return !bound || bound === this.getConversationId();
    }

    isGenerating() {
      if (typeof this.runtime.isGenerating === 'function') {
        try { return Boolean(this.runtime.isGenerating()); } catch {}
      }
      const directStop = document.querySelector(
        '[data-testid="stop-button"], [data-testid="composer-stop-button"], [data-testid*="stop-generating"]'
      );
      if (directStop instanceof HTMLElement) {
        const rect = directStop.getBoundingClientRect();
        const style = getComputedStyle(directStop);
        if (rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden') return true;
      }
      return false;
    }

    getConversationActivitySignature() {
      const assistants = document.querySelectorAll('main [data-message-author-role="assistant"]');
      const last = assistants[assistants.length - 1];
      const text = String(last?.textContent || '');
      return `${assistants.length}:${text.length}:${text.slice(Math.max(0, text.length - 400))}`;
    }

    getLatestUserTurnSignature() {
      const users = document.querySelectorAll('main [data-message-author-role="user"]');
      const last = users[users.length - 1];
      if (!last) return `0::`;
      const messageId = last.getAttribute('data-message-id')
        || last.closest('[data-message-id]')?.getAttribute('data-message-id')
        || last.closest('[data-testid^="conversation-turn-"]')?.getAttribute('data-testid')
        || '';
      const text = String(last.textContent || '')
        .replace(/[\u200B\u200C\u200D\uFEFF]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      return `${users.length}:${messageId}:${text.length}:${text.slice(Math.max(0, text.length - 240))}`;
    }

    hasUserTurnAdvanced(item) {
      const before = String(item?.submitBaseline || '');
      return Boolean(before && this.getLatestUserTurnSignature() !== before);
    }

    completeItem(id) {
      const item = this.items.find((candidate) => candidate.id === id);
      if (item) item.status = 'sent';
      this.items = this.items.filter((candidate) => candidate.id !== id);
      this.emit();
    }

    startPostSubmitWait() {
      const now = Date.now();
      this.awaitingResponse = {
        sentAt: now,
        lastActivityAt: now,
        signature: this.getConversationActivitySignature(),
        sawGenerating: this.isGenerating(),
      };
      this.idleCount = 0;
    }

    updatePostSubmitWait() {
      const state = this.awaitingResponse;
      if (!state) return false;
      const now = Date.now();
      const generating = this.isGenerating();
      if (generating) {
        state.sawGenerating = true;
        state.lastActivityAt = now;
      }
      const signature = this.getConversationActivitySignature();
      if (signature !== state.signature) {
        state.signature = signature;
        state.lastActivityAt = now;
      }
      const elapsed = now - state.sentAt;
      const quietFor = now - state.lastActivityAt;
      const generationHadTimeToStart = state.sawGenerating || elapsed >= this.GENERATION_START_GRACE_MS;
      const done = (
        elapsed >= this.POST_SUBMIT_MIN_WAIT_MS
        && quietFor >= this.POST_SUBMIT_QUIET_MS
        && !generating
        && generationHadTimeToStart
      ) || elapsed >= this.POST_SUBMIT_MAX_WAIT_MS;
      if (done) {
        this.awaitingResponse = null;
        this.idleCount = 0;
        this.emit();
      }
      return true;
    }

    async tick() {
      if (this.isDispatching) return;
      if (this.updatePostSubmitWait()) return;
      if (this.isPaused) {
        this.idleCount = 0;
        return;
      }

      const sending = this.items.find((item) => item.status === 'sending');
      if (sending) {
        await this.recoverSendingItem(sending);
        return;
      }
      const pending = this.items.find((item) => item.status === 'pending');
      if (!pending) {
        this.idleCount = 0;
        return;
      }

      const promptLibrary = this.runtime.promptLibrary;
      if (!this.isItemOnCurrentConversation(pending)) {
        this.idleCount = 0;
        return;
      }
      if (!promptLibrary?.findComposer?.()) {
        this.idleCount = 0;
        return;
      }
      if (promptLibrary.hasComposerContent?.()) {
        this.idleCount = 0;
        return;
      }
      if (this.isGenerating()) {
        this.idleCount = 0;
        return;
      }
      this.idleCount += 1;
      if (this.idleCount < this.IDLE_THRESHOLD) return;
      this.idleCount = 0;
      await this.dispatchNext(pending);
    }

    async dispatchNext(item) {
      if (!item || this.isDispatching || item.status !== 'pending') return;
      const promptLibrary = this.runtime.promptLibrary;
      if (!promptLibrary) return;
      this.isDispatching = true;
      item.status = 'sending';
      this.emit();
      try {
        if (this.isGenerating() || promptLibrary.hasComposerContent()) {
          item.status = 'pending';
          return;
        }
        const inserted = promptLibrary.insertIntoComposer(item.content, { silent: true });
        if (!inserted) {
          item.status = 'failed';
          return;
        }
        item.submitBaseline = this.getLatestUserTurnSignature();
        const submitted = await promptLibrary.submitComposer();
        if (submitted || this.hasUserTurnAdvanced(item) || !promptLibrary.composerContains(item.content)) {
          this.completeItem(item.id);
          this.startPostSubmitWait();
        } else {
          // Keep the item in "sending" instead of immediately retrying. The
          // recovery path waits for another confirmed idle window first.
          item.status = 'sending';
        }
      } catch (error) {
        console.error('[发送队列] 发送失败：', error);
        item.status = promptLibrary.composerContains(item.content) ? 'sending' : 'pending';
      } finally {
        this.isDispatching = false;
        this.emit();
      }
    }

    async recoverSendingItem(item) {
      if (!item || this.isDispatching) return;
      const promptLibrary = this.runtime.promptLibrary;
      if (!promptLibrary) return;
      if (!this.isItemOnCurrentConversation(item)) {
        this.idleCount = 0;
        return;
      }
      if (this.isGenerating()) {
        this.idleCount = 0;
        return;
      }
      if (this.hasUserTurnAdvanced(item) || !promptLibrary.composerContains(item.content)) {
        this.completeItem(item.id);
        this.startPostSubmitWait();
        return;
      }
      this.idleCount += 1;
      if (this.idleCount < this.IDLE_THRESHOLD) return;
      this.idleCount = 0;
      this.isDispatching = true;
      try {
        if (!item.submitBaseline) item.submitBaseline = this.getLatestUserTurnSignature();
        const submitted = await promptLibrary.submitComposer();
        if (submitted || this.hasUserTurnAdvanced(item) || !promptLibrary.composerContains(item.content)) {
          this.completeItem(item.id);
          this.startPostSubmitWait();
        }
      } catch (error) {
        console.error('[发送队列] 重试发送失败：', error);
      } finally {
        this.isDispatching = false;
        this.emit();
      }
    }
  }

  class ComposerQueueDock {
    constructor(runtimeRef) {
      this.runtime = runtimeRef;
      this.root = null;
      this.capsule = null;
      this.capsuleLabel = null;
      this.capsuleBadge = null;
      this.panel = null;
      this.countLabel = null;
      this.pauseButton = null;
      this.clearButton = null;
      this.list = null;
      this.input = null;
      this.enqueueButton = null;
      this.status = null;
      this.isOpen = false;
      this.unsubscribe = null;
      this.observer = null;
      this.resizeObserver = null;
      this.observedShell = null;
      this.positionRaf = 0;
      this.heartbeat = 0;
      this.started = false;
      this.onViewportChange = () => this.schedulePosition();
      this.onUiSettingsChange = () => {
        this.render();
        this.schedulePosition();
      };
      this.onDocumentPointerDown = (event) => {
        if (!this.isOpen || !this.root || this.root.contains(event.target)) return;
        this.close();
      };
    }

    start() {
      if (this.started) return;
      this.started = true;
      this.installStyles();
      this.unsubscribe = this.runtime.messageQueue?.subscribe?.(() => {
        this.render();
        this.schedulePosition();
      }) || null;
      window.addEventListener('resize', this.onViewportChange, { passive: true });
      window.addEventListener('scroll', this.onViewportChange, { capture: true, passive: true });
      window.visualViewport?.addEventListener('resize', this.onViewportChange, { passive: true });
      window.visualViewport?.addEventListener('scroll', this.onViewportChange, { passive: true });
      document.addEventListener('cgpt-unified-ui-settings-change', this.onUiSettingsChange);
      document.addEventListener('pointerdown', this.onDocumentPointerDown, true);
      const observe = () => {
        if (this.observer || !document.documentElement) return;
        this.observer = new MutationObserver(() => this.schedulePosition());
        this.observer.observe(document.documentElement, { childList: true, subtree: true });
      };
      observe();
      this.heartbeat = window.setInterval(() => this.schedulePosition(), 1200);
      window.setTimeout(() => {
        this.ensureRoot();
        this.render();
        this.schedulePosition();
      }, 0);
    }

    installStyles() {
      if (document.getElementById('cgpt-unified-composer-queue-style')) return;
      const style = document.createElement('style');
      style.id = 'cgpt-unified-composer-queue-style';
      style.textContent = `
        #cgpt-unified-queue-dock { position: static; width: 0; height: 0; }
        #cgpt-unified-queue-dock[hidden] { display: none !important; }
        .cgpt-queue-capsule,
        .cgpt-queue-panel { position: fixed; z-index: 2147482500; font-family: var(--cgfc-queue-font, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif); }
        .cgpt-queue-capsule { display: inline-flex; align-items: center; gap: 6px; min-height: 30px; padding: 5px 10px; border: 1px solid var(--cgfc-theme-border, color-mix(in srgb, currentColor 14%, transparent)); border-radius: 999px; background: var(--cgfc-queue-panel-background, color-mix(in srgb, var(--cgfc-theme-surface-primary, var(--main-surface-primary, #fff)) 92%, transparent)); color: var(--cgfc-queue-text-color, var(--cgfc-theme-text-secondary, var(--text-secondary, #555))); box-shadow: var(--cgfc-theme-shadow-soft, 0 4px 16px rgba(0,0,0,.10)); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); cursor: pointer; font-size: var(--cgfc-queue-font-size, 12px); font-weight: 600; line-height: var(--cgfc-queue-line-height, 1.4); user-select: none; transition: transform 120ms ease, box-shadow 120ms ease, background 120ms ease; color-scheme: var(--cgfc-color-scheme, light); }
        .cgpt-queue-capsule:hover { transform: translateY(-1px); background: var(--cgfc-queue-panel-background, var(--cgfc-theme-surface-primary, var(--main-surface-primary, #fff))); color: var(--cgfc-queue-text-color, var(--cgfc-theme-text-primary, var(--text-primary, #161616))); box-shadow: var(--cgfc-theme-shadow-soft, 0 7px 20px rgba(0,0,0,.13)); }
        .cgpt-queue-capsule svg { width: 15px; height: 15px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
        .cgpt-queue-capsule-badge { display: inline-flex; min-width: 17px; height: 17px; padding: 0 5px; align-items: center; justify-content: center; border-radius: 999px; background: var(--cgfc-queue-accent-color, #6d5dfc); color: #fff; font-size: .833em; font-weight: 700; }
        .cgpt-queue-capsule-badge[hidden] { display: none !important; }
        .cgpt-queue-panel { display: flex; width: var(--cgfc-queue-panel-width, 420px); max-width: calc(100vw - 20px); flex-direction: column; overflow: hidden; border: 1px solid var(--cgfc-theme-border, var(--border-light, rgba(0,0,0,.14))); border-radius: 14px; background: var(--cgfc-queue-panel-background, var(--cgfc-theme-surface-primary, var(--main-surface-primary, var(--bg-primary, #fff)))); color: var(--cgfc-queue-text-color, var(--cgfc-theme-text-primary, var(--text-primary, #161616))); box-shadow: var(--cgfc-theme-shadow-strong, 0 18px 48px rgba(0,0,0,.18)); font-size: var(--cgfc-queue-font-size, 12px); line-height: var(--cgfc-queue-line-height, 1.4); color-scheme: var(--cgfc-color-scheme, light); }
        .cgpt-queue-panel[hidden] { display: none !important; }
        .cgpt-queue-panel-header { display: flex; min-height: 45px; padding: 8px 10px 8px 12px; align-items: center; gap: 8px; border-bottom: 1px solid var(--cgfc-theme-border, var(--border-light, rgba(0,0,0,.1))); }
        .cgpt-queue-panel-title { margin-right: auto; font-size: 1.083em; font-weight: 700; }
        .cgpt-queue-panel-actions { display: flex; gap: 3px; }
        .cgpt-queue-icon-btn { display: inline-grid; min-width: 29px; height: 29px; padding: 0 7px; place-items: center; border: 0; border-radius: 8px; background: transparent; color: var(--cgfc-queue-text-color, var(--cgfc-theme-text-secondary, var(--text-secondary, #666))); cursor: pointer; font: inherit; font-size: .917em; }
        .cgpt-queue-icon-btn:hover { background: var(--cgfc-theme-surface-secondary, var(--main-surface-secondary, var(--bg-secondary, #eee))); color: var(--cgfc-theme-text-primary, var(--text-primary, #161616)); }
        .cgpt-queue-list { min-height: 38px; max-height: 190px; overflow-y: auto; padding: 8px; scrollbar-width: thin; }
        .cgpt-queue-empty { padding: 12px 8px; color: var(--cgfc-queue-muted-color, var(--cgfc-theme-text-tertiary, var(--text-tertiary, #888))); font-size: 1em; text-align: center; }
        .cgpt-queue-row { display: grid; grid-template-columns: 23px minmax(0, 1fr) auto; gap: 7px; align-items: center; margin-bottom: 5px; padding: 7px; border-radius: 9px; background: color-mix(in srgb, var(--cgfc-theme-surface-secondary, var(--main-surface-secondary, #eee)) 48%, transparent); }
        .cgpt-queue-row[data-status="sending"] { outline: 1px solid color-mix(in srgb, var(--cgfc-queue-accent-color, #6d5dfc) 42%, transparent); }
        .cgpt-queue-row[data-status="failed"] { outline: 1px solid color-mix(in srgb, #dc2626 40%, transparent); }
        .cgpt-queue-index { display: grid; width: 22px; height: 22px; place-items: center; border-radius: 7px; background: var(--cgfc-theme-surface-primary, var(--main-surface-primary, #fff)); color: var(--cgfc-queue-muted-color, var(--cgfc-theme-text-secondary, var(--text-secondary, #666))); font-size: .833em; font-weight: 700; }
        .cgpt-queue-main { min-width: 0; }
        .cgpt-queue-text { overflow: hidden; color: var(--cgfc-queue-text-color, var(--cgfc-theme-text-primary, var(--text-primary, #161616))); font-size: 1em; line-height: inherit; text-overflow: ellipsis; white-space: nowrap; }
        .cgpt-queue-item-status { margin-top: 2px; color: var(--cgfc-queue-muted-color, var(--cgfc-theme-text-tertiary, var(--text-tertiary, #888))); font-size: .833em; }
        .cgpt-queue-row-actions { display: flex; gap: 2px; }
        .cgpt-queue-row-actions button { width: 25px; height: 25px; padding: 0; border: 0; border-radius: 7px; background: transparent; color: var(--cgfc-theme-text-tertiary, var(--text-tertiary, #777)); cursor: pointer; }
        .cgpt-queue-row-actions button:hover { background: var(--cgfc-theme-surface-primary, var(--main-surface-primary, #fff)); color: var(--cgfc-theme-text-primary, var(--text-primary, #161616)); }
        .cgpt-queue-compose { display: flex; gap: 7px; padding: 9px 10px; align-items: flex-end; border-top: 1px solid var(--cgfc-theme-border, var(--border-light, rgba(0,0,0,.1))); }
        .cgpt-queue-compose textarea { min-width: 0; min-height: 38px; max-height: 112px; flex: 1; padding: 8px 10px; resize: vertical; border: 1px solid var(--cgfc-theme-border, var(--border-light, rgba(0,0,0,.15))); border-radius: 9px; background: var(--cgfc-theme-surface-primary, var(--main-surface-primary, #fff)); color: var(--cgfc-queue-text-color, var(--cgfc-theme-text-primary, var(--text-primary, #161616))); font: inherit; font-size: 1em; line-height: inherit; outline: none; color-scheme: var(--cgfc-color-scheme, light); }
        .cgpt-queue-compose textarea:focus { border-color: color-mix(in srgb, var(--cgfc-queue-accent-color, #6d5dfc) 60%, var(--cgfc-theme-border, var(--border-light, rgba(0,0,0,.15)))); box-shadow: 0 0 0 3px color-mix(in srgb, var(--cgfc-queue-accent-color, #6d5dfc) 12%, transparent); }
        .cgpt-queue-enqueue { width: 38px; height: 38px; flex: none; border: 0; border-radius: 50%; background: var(--cgfc-queue-accent-color, #6d5dfc); color: #fff; cursor: pointer; font-size: 17px; line-height: 1; }
        .cgpt-queue-enqueue:disabled { opacity: .45; cursor: default; }
        .cgpt-queue-footer { display: flex; min-height: 26px; padding: 0 11px 8px; align-items: center; gap: 6px; color: var(--cgfc-queue-muted-color, var(--cgfc-theme-text-tertiary, var(--text-tertiary, #888))); font-size: .833em; }
        .cgpt-queue-dot { width: 6px; height: 6px; border-radius: 50%; background: #22c55e; }
        .cgpt-queue-dot[data-state="paused"] { background: #f59e0b; }
        .cgpt-queue-dot[data-state="busy"] { background: var(--cgfc-queue-accent-color, #6d5dfc); }
        @media (max-width: 640px) {
          .cgpt-queue-capsule { min-height: 32px; padding: 5px 9px; }
          .cgpt-queue-panel { width: calc(100vw - 20px); max-height: calc(100dvh - 20px); }
        }
        @media (prefers-reduced-motion: reduce) {
          .cgpt-queue-capsule { transition: none; }
        }
      `;
      (document.head || document.documentElement)?.appendChild(style);
    }

    ensureRoot() {
      if (!document.body) return false;
      if (this.root?.isConnected) return true;
      const existing = document.getElementById('cgpt-unified-queue-dock');
      if (existing) existing.remove();

      const root = document.createElement('div');
      root.id = 'cgpt-unified-queue-dock';
      root.hidden = true;

      const capsule = document.createElement('button');
      capsule.type = 'button';
      capsule.className = 'cgpt-queue-capsule';
      capsule.title = '发送队列';
      capsule.setAttribute('aria-label', '打开发送队列');
      capsule.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 6h14M5 12h9M5 18h6M17 15v6M14 18h6"/></svg>';
      const capsuleLabel = document.createElement('span');
      capsuleLabel.textContent = '发送队列';
      const badge = document.createElement('span');
      badge.className = 'cgpt-queue-capsule-badge';
      badge.hidden = true;
      capsule.append(capsuleLabel, badge);
      capsule.addEventListener('click', () => this.open());

      const panel = document.createElement('section');
      panel.className = 'cgpt-queue-panel';
      panel.hidden = true;
      panel.setAttribute('role', 'dialog');
      panel.setAttribute('aria-label', '发送队列');

      const header = document.createElement('div');
      header.className = 'cgpt-queue-panel-header';
      const title = document.createElement('div');
      title.className = 'cgpt-queue-panel-title';
      title.textContent = '发送队列 · 0';
      const headerActions = document.createElement('div');
      headerActions.className = 'cgpt-queue-panel-actions';
      const pause = this.makeButton('暂停', '暂停自动发送');
      const clear = this.makeButton('清空', '清空待发送消息');
      const close = this.makeButton('×', '关闭发送队列');
      pause.addEventListener('click', () => this.runtime.messageQueue?.togglePause?.());
      clear.addEventListener('click', () => {
        const count = this.runtime.messageQueue?.snapshot?.().items?.length || 0;
        if (!count || window.confirm(`清空 ${count} 条待发送消息？`)) this.runtime.messageQueue?.clear?.();
      });
      close.addEventListener('click', () => this.close());
      headerActions.append(pause, clear, close);
      header.append(title, headerActions);

      const list = document.createElement('div');
      list.className = 'cgpt-queue-list';

      const compose = document.createElement('div');
      compose.className = 'cgpt-queue-compose';
      const input = document.createElement('textarea');
      input.rows = 1;
      input.placeholder = '输入待发送消息，Enter 入队';
      input.setAttribute('aria-label', '发送队列输入框');
      const enqueue = document.createElement('button');
      enqueue.type = 'button';
      enqueue.className = 'cgpt-queue-enqueue';
      enqueue.textContent = '↑';
      enqueue.title = '加入发送队列';
      enqueue.disabled = true;
      input.addEventListener('input', () => { enqueue.disabled = !input.value.trim(); });
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          this.close();
          return;
        }
        if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
        event.preventDefault();
        this.enqueueInput();
      });
      enqueue.addEventListener('click', () => this.enqueueInput());
      compose.append(input, enqueue);

      const footer = document.createElement('div');
      footer.className = 'cgpt-queue-footer';
      const dot = document.createElement('span');
      dot.className = 'cgpt-queue-dot';
      const status = document.createElement('span');
      status.textContent = '等待消息';
      footer.append(dot, status);

      panel.append(header, list, compose, footer);
      root.append(capsule, panel);
      document.body.appendChild(root);

      this.root = root;
      this.capsule = capsule;
      this.capsuleLabel = capsuleLabel;
      this.capsuleBadge = badge;
      this.panel = panel;
      this.countLabel = title;
      this.pauseButton = pause;
      this.clearButton = clear;
      this.list = list;
      this.input = input;
      this.enqueueButton = enqueue;
      this.status = status;
      this.statusDot = dot;
      this.capsule.hidden = this.isOpen;
      this.panel.hidden = !this.isOpen;
      return true;
    }

    makeButton(text, title) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'cgpt-queue-icon-btn';
      button.textContent = text;
      button.title = title;
      return button;
    }

    enqueueInput() {
      const content = String(this.input?.value || '').trim();
      if (!content) return;
      const item = this.runtime.messageQueue?.enqueue?.(content, { source: 'composer-dock' });
      if (!item) return;
      this.input.value = '';
      if (this.enqueueButton) this.enqueueButton.disabled = true;
      this.input.focus({ preventScroll: true });
      this.render();
    }

    open() {
      if (!this.ensureRoot()) return;
      this.isOpen = true;
      this.capsule.hidden = true;
      this.panel.hidden = false;
      this.render();
      this.schedulePosition();
      window.setTimeout(() => this.input?.focus({ preventScroll: true }), 0);
    }

    close() {
      if (!this.root) return;
      this.isOpen = false;
      this.panel.hidden = true;
      this.capsule.hidden = false;
      this.schedulePosition();
    }

    render() {
      if (!this.ensureRoot()) return;
      const queue = this.runtime.messageQueue;
      const snapshot = queue?.snapshot?.() || { items: [], isPaused: false };
      const items = snapshot.items || [];
      const count = items.length;
      this.capsuleLabel.textContent = count ? '队列' : '发送队列';
      this.capsuleBadge.textContent = String(count);
      this.capsuleBadge.hidden = count === 0;
      this.countLabel.textContent = `发送队列 · ${count}`;
      this.pauseButton.textContent = snapshot.isPaused ? '继续' : '暂停';
      this.pauseButton.title = snapshot.isPaused ? '继续自动发送' : '暂停自动发送';
      this.clearButton.disabled = count === 0;

      const fragment = document.createDocumentFragment();
      if (!count) {
        const empty = document.createElement('div');
        empty.className = 'cgpt-queue-empty';
        empty.textContent = snapshot.isPaused ? '队列为空，当前已暂停' : '队列为空';
        fragment.appendChild(empty);
      }
      const labels = { pending: '等待', sending: '发送中', failed: '失败' };
      items.forEach((item, index) => {
        const row = document.createElement('div');
        row.className = 'cgpt-queue-row';
        row.dataset.status = item.status || 'pending';
        const idx = document.createElement('span');
        idx.className = 'cgpt-queue-index';
        idx.textContent = String(index + 1);
        const main = document.createElement('div');
        main.className = 'cgpt-queue-main';
        const text = document.createElement('div');
        text.className = 'cgpt-queue-text';
        text.textContent = String(item.content || '').replace(/\s+/g, ' ').trim();
        text.title = String(item.content || '');
        const itemStatus = document.createElement('div');
        itemStatus.className = 'cgpt-queue-item-status';
        itemStatus.textContent = item.status === 'pending' && queue?.isItemOnCurrentConversation?.(item) === false
          ? '等待原会话'
          : labels[item.status] || item.status || '等待';
        main.append(text, itemStatus);
        const actions = document.createElement('div');
        actions.className = 'cgpt-queue-row-actions';
        if (item.status === 'failed') {
          const retry = document.createElement('button');
          retry.type = 'button';
          retry.textContent = '↻';
          retry.title = '重试';
          retry.addEventListener('click', () => queue?.retry?.(item.id));
          actions.appendChild(retry);
        }
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.textContent = '×';
        remove.title = '移出队列';
        remove.addEventListener('click', () => queue?.remove?.(item.id));
        actions.appendChild(remove);
        row.append(idx, main, actions);
        fragment.appendChild(row);
      });
      this.list.replaceChildren(fragment);

      const generating = Boolean(this.runtime.isGenerating?.());
      this.statusDot.dataset.state = snapshot.isPaused ? 'paused' : generating ? 'busy' : 'idle';
      if (snapshot.isPaused) this.status.textContent = '已暂停自动发送';
      else if (generating) this.status.textContent = count ? '等待当前回答完成后继续' : '当前正在生成回答';
      else if (count) this.status.textContent = '检测到空闲后自动发送下一条';
      else this.status.textContent = '等待消息';
    }

    resolveComposerShell(composer) {
      if (!(composer instanceof Element)) return null;
      const sendButton = this.runtime.promptLibrary?.findSendButton?.(composer) || null;
      const composerRect = composer.getBoundingClientRect();
      const maxShellHeight = Math.max(180, composerRect.height * 4.5);
      const maxTopDrift = Math.max(120, composerRect.height * 3);
      const isReasonableShell = (element) => {
        if (!(element instanceof Element)) return false;
        const rect = element.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return false;
        const topDrift = Math.max(0, composerRect.top - rect.top);
        return rect.height <= maxShellHeight && topDrift <= maxTopDrift;
      };

      // ChatGPT 当前页面会给真正的输入区外壳标记 data-composer-surface。
      // 空输入框时没有 send button，优先认这个显式锚点，避免退到偏窄的编辑器内层。
      const explicitSurface = composer.closest('[data-composer-surface="true"]');
      if (isReasonableShell(explicitSurface)) return explicitSurface;

      const candidates = [];
      let node = composer.parentElement;

      for (let depth = 0; node && node !== document.body && depth < 12; depth += 1, node = node.parentElement) {
        const rect = node.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) continue;
        const coversComposer = rect.left <= composerRect.left + 2
          && rect.right >= composerRect.right - 2
          && rect.top <= composerRect.top + 2
          && rect.bottom >= composerRect.bottom - 2;
        if (!coversComposer) continue;

        const topDrift = Math.max(0, composerRect.top - rect.top);
        if (rect.height > maxShellHeight || topDrift > maxTopDrift) continue;

        const radius = Number.parseFloat(getComputedStyle(node).borderRadius || '0') || 0;
        const explicit = node.matches('[data-composer-surface="true"]');
        const semantic = node.matches('form[data-type*="composer" i], form[class*="composer" i], [data-testid*="composer" i]');
        const genericForm = node.tagName === 'FORM';
        const containsSend = Boolean(sendButton && node.contains(sendButton));
        const widthGain = Math.max(0, rect.width - composerRect.width);
        let score = 0;
        if (explicit) score += 20;
        if (containsSend) score += 10;
        if (semantic) score += 8;
        else if (genericForm) score += 5;
        if (radius >= 12) score += 4;
        // 真正的 composer 外壳通常比文本编辑区更宽，因为右侧还包含模型、语音/发送等控件。
        // 在高度已受约束的前提下，适度奖励横向扩展，避免空输入框时锚到窄内层。
        score += Math.min(7, widthGain / 55);
        score -= Math.min(4, topDrift / 40);
        score -= Math.min(3, Math.max(0, rect.height - composerRect.height) / 60);
        candidates.push({ node, score, depth });
      }

      candidates.sort((a, b) => b.score - a.score || a.depth - b.depth);
      return candidates[0]?.node || composer;
    }

    observeShell(shell) {
      if (this.observedShell === shell) return;
      this.resizeObserver?.disconnect?.();
      this.resizeObserver = null;
      this.observedShell = shell;
      if (!(shell instanceof Element) || typeof ResizeObserver !== 'function') return;
      this.resizeObserver = new ResizeObserver(() => this.schedulePosition());
      this.resizeObserver.observe(shell);
    }

    schedulePosition() {
      if (this.positionRaf) return;
      this.positionRaf = window.requestAnimationFrame(() => {
        this.positionRaf = 0;
        this.refreshPosition();
      });
    }

    refreshPosition() {
      if (!this.ensureRoot()) return;
      const composer = this.runtime.promptLibrary?.findComposer?.();
      if (!composer) {
        this.root.hidden = true;
        return;
      }
      const shell = this.resolveComposerShell(composer);
      if (!(shell instanceof Element) || !shell.isConnected) {
        this.root.hidden = true;
        return;
      }
      const rect = shell.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0 || rect.bottom < 0 || rect.top > window.innerHeight) {
        this.root.hidden = true;
        return;
      }
      this.observeShell(shell);
      this.root.hidden = false;

      const visualViewport = window.visualViewport;
      const viewportLeft = Math.max(0, visualViewport?.offsetLeft || 0);
      const viewportTop = Math.max(0, visualViewport?.offsetTop || 0);
      const viewportWidth = Math.max(240, visualViewport?.width || document.documentElement.clientWidth || window.innerWidth || 320);
      const viewportHeight = Math.max(240, visualViewport?.height || document.documentElement.clientHeight || window.innerHeight || 320);
      const viewportRight = viewportLeft + viewportWidth;
      const viewportBottom = viewportTop + viewportHeight;
      const edge = 10;
      const rootStyles = getComputedStyle(document.documentElement);
      const preferredPanelWidth = Number.parseFloat(rootStyles.getPropertyValue('--cgfc-queue-panel-width')) || 420;
      const panelWidth = Math.min(Math.max(280, preferredPanelWidth), viewportWidth - edge * 2);
      this.panel.style.width = `${panelWidth}px`;
      const availableAbove = Math.max(120, rect.top - viewportTop - edge - 6);
      this.panel.style.maxHeight = `${Math.min(440, viewportHeight - edge * 2, availableAbove)}px`;

      const positionAboveComposer = (element, width) => {
        const elementRect = element.getBoundingClientRect();
        const safeWidth = Math.max(1, width || elementRect.width || 1);
        const safeHeight = Math.max(1, elementRect.height || 1);
        const left = Math.min(
          viewportRight - edge - safeWidth,
          Math.max(viewportLeft + edge, rect.right - safeWidth - 10),
        );
        const top = Math.min(
          viewportBottom - edge - safeHeight,
          Math.max(viewportTop + edge, rect.top - safeHeight - 6),
        );
        element.style.removeProperty('right');
        element.style.removeProperty('bottom');
        element.style.left = `${left}px`;
        element.style.top = `${top}px`;
      };

      positionAboveComposer(this.capsule, this.capsule.getBoundingClientRect().width);
      positionAboveComposer(this.panel, panelWidth);
    }
  }


  runtime.tokenStats?.destroy?.();
  runtime.sessionExporter = new SessionExporter();
  runtime.tokenStats = new TokenStatsController(runtime.sessionExporter);
  runtime.tokenStats.init();
  runtime.promptLibrary = runtime.promptLibrary || new PromptLibrary();
  runtime.messageQueue = runtime.messageQueue || new MessageQueue(runtime);
  runtime.messageQueue.start();
  runtime.composerQueueDock = runtime.composerQueueDock || new ComposerQueueDock(runtime);
  runtime.composerQueueDock.start();
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

    // 首屏只挂载少量轮次时，分批借用原生目录补全真实提问标题。
    conversationTocAutoHydrateLabels: true,
    conversationTocHydrateBatchSize: 3,
    conversationTocHydrateDelayMs: 360,
    conversationTocHydrateTimeoutMs: 900,

    // 第一次使用时是否默认收起；之后会记住手动选择。
    answerTocInitiallyCollapsed: false,
    answerTocRememberCollapsedState: true,

    // 目录跳转动画。系统开启“减少动态效果”时会自动禁用动画。
    answerTocSmoothScroll: true,

    // 以视口从上往下 28% 的位置作为“当前章节 / 当前回答”阅读指针。
    answerTocActiveLineRatio: 0.28,

    // 章节切换迟滞区，避免标题在阅读指针附近来回抖动。
    answerTocActiveHysteresisPx: 38,

    // 点击章节后，将标题放在视口约 22% 高度，而不是紧贴顶部。
    answerTocJumpLineRatio: 0.22,

    // 用户正在手动浏览章节列表时，暂停目录自身的自动卷回。
    answerTocManualBrowseHoldMs: 1500,

    // 自动派生章节的常规质量门槛；不足时仅按分布补少量兜底章节。
    answerTocDerivedMinScore: 60,

    // 为官方右侧问答导航预留的最小空间。
    answerTocFallbackInlineEndPx: 68,
    answerTocOfficialNavGapPx: 12,

    // 始终保留入口；窄屏/手机通过下方响应式布局避开输入框和安全区。
    answerTocMinViewportWidth: 0,

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
      ${ASSISTANT_SELECTOR} :is(h1, h2, h3, h4, h5, h6) {
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
      this.pendingHeadingIndex = -1;
      this.pendingHeadingUntil = 0;
      this.pendingHeadingTimer = 0;
      this.headingJumpToken = 0;
      this.headingJumpSettleTimer = 0;
      this.headingJumpScrollTarget = null;
      this.headingJumpScrollEndHandler = null;
      this.headingNavPointerInside = false;
      this.headingNavUserActiveUntil = 0;

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
      this.conversationLabelHydrationTimer = 0;
      this.conversationLabelHydrationToken = 0;
      this.conversationLabelHydrating = false;
      this.conversationLabelHydrationContext = null;
      this.conversationLabelHydrationAttempts = new Map();

      // API-first 完整问答目录。只缓存当前会话当前分支的 user 节点；
      // 页面 DOM 可以继续按性能策略卸载，不影响目录总数和标题。
      this.apiConversationOutline = null;
      this.apiConversationRefreshTimer = 0;
      this.apiConversationRefreshForce = false;
      this.apiConversationRefreshToken = 0;
      this.apiConversationRefreshInFlight = false;
      this.apiConversationLastErrorKey = '';

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
      this.lastConversationRouteKey = this.getConversationRouteKey(this.lastUrl);
      this.restoreConversationLabelSnapshot();

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
      this.onUiSettingsChange = () => {
        window.requestAnimationFrame(() => {
          this.ensurePanelSizeInViewport(false);
          this.ensureManualPositionInViewport(true);
          this.updateInlineEndOffset();
        });
      };
    }

    start() {
      if (!document.body) return;

      this.createUi();
      this.bindMainObserver();
      this.syncOfficialConversationNav();
      this.rebuildConversationToc();
      this.scheduleApiConversationOutlineRefresh(40, true);
      this.updateInlineEndOffset();
      this.syncVisibility();

      document.addEventListener('scroll', this.onScroll, {
        capture: true,
        passive: true,
      });
      window.addEventListener('resize', this.onResize, { passive: true });
      window.visualViewport?.addEventListener('resize', this.onResize, { passive: true });
      window.visualViewport?.addEventListener('scroll', this.onResize, { passive: true });
      window.addEventListener('popstate', this.onRouteSignal, { passive: true });
      window.addEventListener('hashchange', this.onRouteSignal, { passive: true });
      document.addEventListener('keydown', this.onKeyDown, true);
      document.addEventListener('pointerdown', this.onDocumentPointerDown, true);
      document.addEventListener('click', this.onDocumentClick, true);
      document.addEventListener('visibilitychange', this.onVisibilityChange);
      document.addEventListener('cgpt-unified-ui-settings-change', this.onUiSettingsChange);

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
            font-family: var(--cgfc-toolbox-font, ui-sans-serif, -apple-system, BlinkMacSystemFont,
              "Segoe UI", "Microsoft YaHei", sans-serif) !important;
            font-size: var(--cgfc-toolbox-font-size, 13px) !important;
            line-height: var(--cgfc-toolbox-line-height, 1.4) !important;
            color: var(--cgfc-toolbox-text-color, var(--cgfc-theme-text-primary, var(--text-primary, #161616))) !important;
            color-scheme: var(--cgfc-color-scheme, light) !important;
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
            border: 1px solid var(--cgfc-theme-border, var(--border-light, rgba(0, 0, 0, 0.14)));
            border-radius: 12px;
            background: var(--cgfc-toolbox-launcher-background, color-mix(
              in srgb,
              var(--cgfc-theme-surface-primary, var(--main-surface-primary, var(--bg-primary, #ffffff))) ${launcherOpacityPercent},
              transparent
            ));
            color: var(--cgfc-toolbox-text-color, var(--cgfc-theme-text-secondary, var(--text-secondary, #444444)));
            box-shadow: var(--cgfc-theme-shadow-soft, 0 6px 22px rgba(0, 0, 0, 0.14));
            cursor: grab;
            touch-action: none;
            user-select: none;
          }

          .launcher:hover {
            background: var(--cgfc-toolbox-launcher-background, rgba(244, 244, 244, ${launcherOpacity}));
            background: var(--cgfc-toolbox-launcher-background, color-mix(
              in srgb,
              var(--cgfc-theme-surface-secondary, var(--main-surface-secondary, var(--bg-secondary, #f4f4f4))) ${launcherOpacityPercent},
              transparent
            ));
            color: var(--cgfc-toolbox-text-color, var(--cgfc-theme-text-primary, var(--text-primary, #161616)));
          }

          .launcher:focus-visible,
          .icon-button:focus-visible,
          .view-tab:focus-visible,
          .toc-item:focus-visible {
            outline: 2px solid var(--cgfc-toolbox-accent-color, var(--text-primary, #161616));
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
            color: var(--cgfc-toolbox-muted-color, var(--text-tertiary, #777777));
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
            width: min(var(--cgpt-answer-toc-width, var(--cgfc-toolbox-panel-width, 300px)), calc(100vw - 16px));
            max-height: min(68dvh, 660px, calc(100dvh - 16px));
            display: flex;
            flex-direction: column;
            overflow: hidden;
            border: 1px solid var(--cgfc-theme-border, var(--border-light, rgba(0, 0, 0, 0.14)));
            border-radius: 14px;
            background: var(--cgfc-toolbox-panel-background, color-mix(
              in srgb,
              var(--cgfc-theme-surface-primary, var(--main-surface-primary, var(--bg-primary, #ffffff))) ${panelOpacityPercent},
              transparent
            ));
            box-shadow: var(--cgfc-theme-shadow-strong, 0 10px 34px rgba(0, 0, 0, 0.16));
          }

          :host([data-size-mode="manual"]) .panel {
            width: var(--cgpt-answer-toc-width, var(--cgfc-toolbox-panel-width, 300px));
            height: var(--cgpt-answer-toc-height, 420px);
            min-width: ${minWidth}px;
            min-height: ${minHeight}px;
            max-width: calc(100vw - 16px);
            max-height: calc(100dvh - 16px);
          }

          .panel[hidden],
          .launcher[hidden],
          .toc-nav[hidden],
          .empty-state[hidden] {
            display: none !important;
          }

          .panel-header {
            min-height: 36px;
            display: flex;
            flex: none;
            align-items: center;
            gap: 7px;
            padding-block: 5px;
            padding-inline-start: 8px;
            padding-inline-end: 20px;
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
            color: var(--cgfc-toolbox-muted-color, var(--text-tertiary, #777777));
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
            color: var(--cgfc-toolbox-text-color, var(--cgfc-theme-text-primary, var(--text-primary, #161616)));
            font-weight: 600;
            text-overflow: ellipsis;
            white-space: nowrap;
          }

          .count-label {
            flex: none;
            color: var(--cgfc-toolbox-muted-color, var(--text-tertiary, #777777));
            font-size: 11px;
            font-variant-numeric: tabular-nums;
          }

          .icon-button {
            position: relative;
            z-index: 4;
            width: 27px;
            height: 27px;
            display: inline-flex;
            flex: none;
            align-items: center;
            justify-content: center;
            padding: 0;
            border: 0;
            border-radius: 8px;
            background: transparent;
            color: var(--cgfc-toolbox-muted-color, var(--text-secondary, #555555));
            cursor: pointer;
          }

          .icon-button:hover {
            background: var(--cgfc-theme-surface-secondary, var(--main-surface-secondary, var(--bg-secondary, #f1f1f1)));
            color: var(--cgfc-toolbox-text-color, var(--cgfc-theme-text-primary, var(--text-primary, #161616)));
          }

          .view-tabs {
            display: grid;
            flex: none;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 3px;
            padding: 3px 5px;
            border-bottom: 1px solid var(--border-light, rgba(0, 0, 0, 0.09));
          }

          .view-tab {
            min-width: 0;
            min-height: 28px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 4px;
            padding: 3px 5px;
            border: 0;
            border-radius: 8px;
            background: transparent;
            color: var(--cgfc-toolbox-muted-color, var(--text-secondary, #4a4a4a));
            cursor: pointer;
            white-space: nowrap;
          }

          .view-tab:hover {
            background: color-mix(
              in srgb,
              var(--cgfc-theme-surface-secondary, var(--main-surface-secondary, var(--bg-secondary, #f3f3f3))) 74%,
              transparent
            );
            color: var(--cgfc-toolbox-text-color, var(--cgfc-theme-text-primary, var(--text-primary, #161616)));
          }

          .view-tab[aria-selected="true"] {
            background: color-mix(in srgb, var(--cgfc-toolbox-accent-color, var(--cgfc-theme-surface-secondary, var(--main-surface-secondary, var(--bg-secondary, #ededed)))) 18%, transparent);
            color: var(--cgfc-toolbox-text-color, var(--cgfc-theme-text-primary, var(--text-primary, #111111)));
            font-weight: 600;
          }

          .view-count {
            min-width: 1.45em;
            padding: 0 4px;
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
            color: var(--cgfc-toolbox-muted-color, var(--text-secondary, #4a4a4a));
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
              var(--cgfc-theme-surface-secondary, var(--main-surface-secondary, var(--bg-secondary, #f3f3f3))) 82%,
              transparent
            );
            color: var(--cgfc-toolbox-text-color, var(--cgfc-theme-text-primary, var(--text-primary, #161616)));
          }

          .toc-item[data-active="true"] {
            background: color-mix(in srgb, var(--cgfc-toolbox-accent-color, var(--cgfc-theme-surface-secondary, var(--main-surface-secondary, var(--bg-secondary, #ededed)))) 18%, transparent);
            color: var(--cgfc-toolbox-text-color, var(--cgfc-theme-text-primary, var(--text-primary, #111111)));
          }

          .toc-item[data-active="true"]::before {
            background: var(--cgfc-toolbox-accent-color, var(--cgfc-theme-text-primary, var(--text-primary, #111111)));
          }

          .toc-item[data-level="1"] {
            font-weight: 600;
          }

          .toc-item[data-level="2"] {
            padding-inline-start: 25px;
            font-size: 12.5px;
          }

          .toc-item[data-level="3"] {
            padding-inline-start: 38px;
            font-size: 12px;
          }

          .toc-item[data-level="4"],
          .toc-item[data-level="5"],
          .toc-item[data-level="6"] {
            padding-inline-start: 50px;
            font-size: 11.5px;
          }

          .prompt-index {
            width: 2.4em;
            flex: none;
            padding-top: 1px;
            color: var(--cgfc-toolbox-muted-color, var(--text-tertiary, #777777));
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
            color: var(--cgfc-toolbox-muted-color, var(--text-tertiary, #777777));
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

          @media (max-width: 819px) {
            :host(:not([data-position-mode="manual"])) {
              inset-inline-end: max(8px, env(safe-area-inset-right)) !important;
              top: auto !important;
              bottom: max(140px, calc(env(safe-area-inset-bottom) + 128px)) !important;
              transform: none !important;
            }

            .launcher {
              min-width: 44px;
              height: 40px;
            }

            .panel {
              width: min(var(--cgpt-answer-toc-width, var(--cgfc-toolbox-panel-width, 300px)), calc(100vw - 16px));
              max-height: min(72dvh, calc(100dvh - 96px));
            }

            .panel-header {
              padding-inline-end: 12px;
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

      this.tocNav?.addEventListener('pointerenter', () => {
        this.headingNavPointerInside = true;
      });
      this.tocNav?.addEventListener('pointerleave', () => {
        this.headingNavPointerInside = false;
        this.markHeadingNavInteraction(360);
      });
      for (const eventName of ['wheel', 'touchstart', 'pointerdown', 'keydown']) {
        this.tocNav?.addEventListener(eventName, () => this.markHeadingNavInteraction(), {
          passive: eventName !== 'keydown',
        });
      }

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
      if (nextView !== 'headings') {
        // 隐藏章节列表时 pointerleave 不一定会触发，主动清掉“用户仍在浏览目录”的状态。
        this.headingNavPointerInside = false;
        this.headingNavUserActiveUntil = 0;
      }
      if (nextView === this.activeView) {
        this.applyActiveView();
        return;
      }

      this.activeView = nextView;
      if (persist) this.writeViewState();
      this.applyActiveView();
      this.updateViewMeta();
      if (this.activeView === 'conversation') this.scheduleConversationLabelHydration();
      else this.cancelConversationLabelHydration();

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
      if (event.isTrusted && this.conversationLabelHydrating) {
        this.cancelConversationLabelHydration();
      }
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
      if (nextCollapsed) {
        this.cancelConversationLabelHydration();
        // 键盘/Escape 收起时列表会直接 hidden，浏览器可能不会补发 pointerleave。
        this.headingNavPointerInside = false;
        this.headingNavUserActiveUntil = 0;
      }

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

      if (this.host) this.host.dataset.collapsed = String(this.collapsed);
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
      const visualViewport = window.visualViewport;
      const viewportLeft = Math.max(0, visualViewport?.offsetLeft || 0);
      const viewportTop = Math.max(0, visualViewport?.offsetTop || 0);
      const viewportWidth = Math.max(1, visualViewport?.width || document.documentElement.clientWidth);
      const viewportHeight = Math.max(1, visualViewport?.height || document.documentElement.clientHeight);
      const safeWidth = Math.max(1, Number(width) || 1);
      const safeHeight = Math.max(1, Number(height) || 1);
      const minLeft = viewportLeft + margin;
      const minTop = viewportTop + margin;
      const maxLeft = Math.max(minLeft, viewportLeft + viewportWidth - safeWidth - margin);
      const maxTop = Math.max(minTop, viewportTop + viewportHeight - safeHeight - margin);

      return {
        left: Math.min(maxLeft, Math.max(minLeft, left)),
        top: Math.min(maxTop, Math.max(minTop, top)),
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

    getConversationRouteKey(value = location.href) {
      try {
        const url = new URL(value, location.origin);
        return `${url.origin}${url.pathname}`;
      } catch {
        return String(value || '').split(/[?#]/, 1)[0];
      }
    }

    resetForNavigation() {
      const nextUrl = location.href;
      const nextRouteKey = this.getConversationRouteKey(nextUrl);
      const routeChanged = nextRouteKey !== this.lastConversationRouteKey;
      this.lastUrl = nextUrl;
      this.lastConversationRouteKey = nextRouteKey;
      this.cancelConversationJump();
      this.cancelConversationLabelHydration(!routeChanged);

      if (routeChanged) {
        this.clearConversationLabelCacheState();
        this.maxObservedOfficialLogicalIndex = -1;
        this.restoreConversationLabelSnapshot();
        this.clearConversationToc();
        this.apiConversationOutline = null;
        this.apiConversationRefreshToken += 1;
        globalThis.__cgptUnifiedRuntimeV1?.sessionExporter?.invalidateApiTreeCache?.();
      } else {
        // React 仅替换 main 或 URL 查询参数变化时保留完整问答目录快照。
        this.lastConversationSignature = '';
      }

      this.disconnectCurrentAnswer();
      this.clearToc();
      this.bindMainObserver();
      this.syncOfficialConversationNav();
      this.scheduleConversationRebuild(80);
      this.scheduleApiConversationOutlineRefresh(120, routeChanged);
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

      if (conversationChanged) {
        this.scheduleConversationRebuild();
        this.scheduleApiConversationOutlineRefresh(420, true);
      }
      if (assistantAdded) {
        this.requestFrame(true);
        // 新回答节点出现时再补一次强制刷新，覆盖“发送后 API 尚未落库”的短窗口。
        this.scheduleApiConversationOutlineRefresh(700, true);
      }
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

      // 阅读指针优先：当前章节与当前回答尽量使用同一条 28% 活动线。
      // 若活动线恰好落在空白/浮层，再退回原来的多点加权算法。
      const activeY = Math.min(height - 1, Math.max(0, this.getActiveLineViewportY()));
      for (const xRatio of [0.5, 0.42, 0.58]) {
        const x = Math.min(width - 1, Math.max(0, width * xRatio));
        const element = document.elementFromPoint(x, activeY);
        const answer = element?.closest?.('[data-message-author-role="assistant"]');
        if (answer) return answer;
      }

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
      this.cancelHeadingJump();
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
      this.normalizeOutlineLevels(headings);

      // 正式 H1-H6 一律完整保留；answerTocDerivedMaxItems 只限制自动派生项。
      this.headings = headings;
      this.observeHeadingText();
      this.renderTocItems();
      const nextActiveIndex = this.findActiveIndexBinary();
      this.activeIndex = -1;
      this.applyActiveIndex(nextActiveIndex, false);
      this.updateViewMeta();
      this.syncVisibility();
    }

    normalizeOutlineLevels(headings) {
      /*
       * 正式 H1-H6 单独建立层级栈。派生章节只能“挂在”最近的正式章节下，
       * 绝不能进入这个栈，否则一个正文候选会改变后续 H3/H4 的真实父子关系。
       */
      const formalStack = [];
      const formalItems = headings.filter((heading) => !heading.derived);
      for (const heading of formalItems) {
        const rawLevel = Math.min(6, Math.max(1, Number(heading.level) || 2));
        while (formalStack.length && formalStack[formalStack.length - 1].rawLevel >= rawLevel) {
          formalStack.pop();
        }
        heading.rawLevel = rawLevel;
        heading.displayLevel = Math.min(4, formalStack.length + 1);
        formalStack.push({ rawLevel, displayLevel: heading.displayLevel });
      }

      let previousFormal = null;
      const hasFormal = formalItems.length > 0;
      for (const heading of headings) {
        const rawLevel = Math.min(6, Math.max(1, Number(heading.level) || 2));
        heading.rawLevel = rawLevel;
        if (!heading.derived) {
          previousFormal = heading;
          continue;
        }

        // 完全没有 Markdown 标题时，自动识别出的章节彼此都是一级章节。
        // 有正式标题时，派生项作为最近正式章节的一级子项显示。
        heading.displayLevel = !hasFormal || !previousFormal
          ? 1
          : Math.min(4, (previousFormal.displayLevel || 1) + 1);
      }
      return headings;
    }

    extractOutlineSentence(value) {
      const source = this.normalizeText(value ?? '').replace(/\*\*([^*]+)\*\*/g, '$1');
      if (!source) return '';

      const endpoints = [];
      const lineBreak = source.indexOf('\n');
      if (lineBreak >= 0) endpoints.push(lineBreak);

      // 中文句号后通常没有空格，不能沿用英文的“标点 + 空格”分句规则。
      const cjk = /[。！？]/u.exec(source);
      if (cjk) endpoints.push(cjk.index + cjk[0].length);

      // 英文句号保守要求后接空白或文本结束，避免把 3.14 / v1.3.1 切碎。
      const latin = /[.!?](?=\s|$)/u.exec(source);
      if (latin) endpoints.push(latin.index + latin[0].length);

      const end = endpoints.length ? Math.min(...endpoints) : source.length;
      return source.slice(0, end).trim();
    }

    canonicalOutlineLabel(value) {
      return this.normalizeText(value ?? '')
        .toLocaleLowerCase()
        .replace(
          /^\s*(?:(?:第\s*)?[一二三四五六七八九十百零〇\d]+\s*(?:章|节|部分|篇|卷|单元)\s*[：:、.．)）-]?\s*|[一二三四五六七八九十百零〇]+\s*[、.．：:)）]\s*|\d+(?:\.\d+)*(?:\s*[.)、：:．-]\s*|\s+)|[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳]\s*)/u,
          '',
        )
        .replace(/[\s\p{P}\p{S}]+/gu, '');
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
        const sentence = this.extractOutlineSentence(raw) || raw;
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
      const minScore = Math.max(0, Number(this.config.answerTocDerivedMinScore) || 60);
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
      const canonicalLabel = (value) => this.canonicalOutlineLabel(value);
      const existingLabels = new Set(existing.map((item) => canonicalLabel(item.fullLabel)));
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
      const sentenceFrom = (value) => this.extractOutlineSentence(value);
      const makeItem = (element, labelOverride = '', level = 3) => {
        if (!(element instanceof HTMLElement) || existingElements.has(element) || !belongsToAnswer(element)) return null;
        const raw = this.normalizeText(element.textContent ?? '');
        const source = this.normalizeText(labelOverride || raw).replace(/\*\*([^*]+)\*\*/g, '$1');
        if (raw.length < minLength || source.length < 2) return null;
        const sentence = sentenceFrom(source);
        const prefix = element.tagName === 'PRE' ? '代码：' : element.tagName === 'TABLE' ? '表格：' : '';
        const fullLabel = (prefix + sentence).slice(0, 220);
        const key = canonicalLabel(fullLabel);
        if (!key || existingLabels.has(key)) return null;
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
      const looksLikeNumberedTitle = (label) => /^(?:#{0,6}\s*)?(?:\d+(?:\.\d+)*(?:[.)、：:．-]|\s+)|[一二三四五六七八九十百零〇]+[、.．：:)）]|第[一二三四五六七八九十百零〇\d]+(?:章|节|部分|篇|卷|单元)|[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳])\s*\S+/.test(label);
      const lowSignalLead = /^(?:所以|因此|那么|然后|接下来|另外|不过|但是|其实|当然|总之|换句话说|也就是说|可以看到|这意味着|这里|此时|现在)/;
      const scoreLabel = (item, baseScore) => {
        const label = this.normalizeText(item?.fullLabel ?? '');
        if (!label) return -Infinity;
        let score = baseScore;
        if (looksLikeNumberedTitle(label)) score += 20;
        if (label.length <= 48) score += 9;
        else if (label.length <= 88) score += 4;
        else if (label.length > 150) score -= 14;
        if (lowSignalLead.test(label)) score -= 24;
        if (/^[“"'（(]?\S.{16,}[。！？.!?]$/.test(label)) score -= 8;
        if (item.element.tagName === 'PRE' || item.element.tagName === 'TABLE') score -= 3;
        return score;
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
      const offer = (element, labelOverride, level, baseScore, sourceKind) => {
        const item = makeItem(element, labelOverride, level);
        if (!item) return;
        const score = scoreLabel(item, baseScore);
        const current = candidates.get(element);
        if (!current || score > current.score) candidates.set(element, { item, score, sourceKind });
      };

      const firstExisting = existing.map((item) => item.element).filter(Boolean).sort(compareElements)[0] || null;
      const leadingBlock = blocks.find((block) => !firstExisting
        || Boolean(block.compareDocumentPosition(firstExisting) & Node.DOCUMENT_POSITION_FOLLOWING));
      if (leadingBlock) offer(leadingBlock, '', 2, 62, 'lead');

      for (const element of root.querySelectorAll('p, li')) {
        if (!(element instanceof HTMLElement) || !belongsToAnswer(element)) continue;
        const leadingLabel = extractLeadingLabel(element);
        if (leadingLabel) offer(element, leadingLabel, element.tagName === 'LI' ? 4 : 3, 82, 'strong');
      }

      const boundaryNodes = Array.from(root.querySelectorAll('hr, h1, h2, h3, h4, h5, h6, p, blockquote, pre, ul, ol, table'))
        .filter((element) => element instanceof HTMLElement && belongsToAnswer(element));
      for (let index = 0; index < boundaryNodes.length; index += 1) {
        if (boundaryNodes[index].tagName !== 'HR') continue;
        const next = boundaryNodes.slice(index + 1).find((element) => element.tagName !== 'HR');
        if (!next || /^H[1-6]$/.test(next.tagName) || existingElements.has(next)) continue;
        offer(next, '', 3, 72, 'separator');
      }

      // 普通正文仅作为低权重候选，避免把“所以/接下来……”之类句子轻易升级为章节。
      const stride = Math.max(1, Math.floor(blocks.length / Math.max(1, needed)));
      blocks.forEach((element, index) => {
        if (index === 0 || index % stride === 0 || index === blocks.length - 1) {
          offer(element, '', 3, 46, 'distributed');
        }
      });

      const ranked = [...candidates.values()]
        .sort((a, b) => b.score - a.score || compareElements(a.item.element, b.item.element));

      // 不只和正式标题去重，也让不同 DOM 块生成的同名派生章节彼此去重。
      // 分数更高的候选排在前面，因此自然保留质量更好的那个。
      const uniqueRanked = [];
      const seenLabels = new Set(existingLabels);
      for (const entry of ranked) {
        const key = canonicalLabel(entry.item.fullLabel);
        if (!key || seenLabels.has(key)) continue;
        seenLabels.add(key);
        uniqueRanked.push(entry);
      }

      const selected = uniqueRanked.filter((entry) => entry.score >= minScore).slice(0, needed);

      // 完全无正式标题时必须保留可导航性，但兜底只补到目标数量，不再无差别抽正文。
      if (selected.length < needed && existing.length === 0) {
        const selectedElements = new Set(selected.map((entry) => entry.item.element));
        for (const entry of uniqueRanked) {
          if (selected.length >= needed) break;
          if (selectedElements.has(entry.item.element)) continue;
          if (entry.score < 38) continue;
          selected.push(entry);
          selectedElements.add(entry.item.element);
        }
      }

      return selected
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
        button.dataset.level = String(heading.displayLevel || heading.level || 1);
        button.dataset.active = 'false';
        button.dataset.derived = heading.derived ? 'true' : 'false';
        button.title = heading.derived ? `自动识别章节 · ${heading.fullLabel}` : heading.fullLabel;

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

    getConversationIdFromLocation() {
      const match = location.pathname.match(/\/c\/([0-9a-f-]{20,})/i);
      return match?.[1] || '';
    }

    getApiConversationOutlineForCurrentRoute() {
      const conversationId = this.getConversationIdFromLocation();
      if (!conversationId || this.apiConversationOutline?.conversationId !== conversationId) return null;
      return Array.isArray(this.apiConversationOutline.items) ? this.apiConversationOutline.items : null;
    }

    scheduleApiConversationOutlineRefresh(delay = 180, force = false) {
      if (!this.config.enableConversationToc) return;
      this.apiConversationRefreshForce ||= Boolean(force);
      window.clearTimeout(this.apiConversationRefreshTimer);
      this.apiConversationRefreshTimer = window.setTimeout(() => {
        this.apiConversationRefreshTimer = 0;
        const shouldForce = this.apiConversationRefreshForce;
        this.apiConversationRefreshForce = false;
        void this.refreshApiConversationOutline(shouldForce);
      }, Math.max(0, Number(delay) || 0));
    }

    async refreshApiConversationOutline(force = false) {
      if (document.hidden || this.apiConversationRefreshInFlight) {
        if (force) this.scheduleApiConversationOutlineRefresh(500, true);
        return;
      }
      const exporter = globalThis.__cgptUnifiedRuntimeV1?.sessionExporter;
      if (!exporter?.getConversationOutline) return;
      const conversationId = this.getConversationIdFromLocation();
      if (!conversationId) return;

      this.apiConversationRefreshInFlight = true;
      const token = ++this.apiConversationRefreshToken;
      const routeKey = this.lastConversationRouteKey;
      try {
        const outline = await exporter.getConversationOutline({
          force: Boolean(force),
          maxAgeMs: force ? 0 : 8000,
        });
        if (
          token !== this.apiConversationRefreshToken
          || routeKey !== this.lastConversationRouteKey
          || outline?.conversationId !== this.getConversationIdFromLocation()
        ) return;
        if (outline?.items?.length) {
          this.apiConversationOutline = outline;
          this.apiConversationLastErrorKey = '';
          // API 标签是当前分支的权威目录快照，不需要再通过“逐个点官方目录”补标题。
          outline.items.forEach((item) => {
            if (item?.fullLabel) this.conversationLabelCache.set(item.logicalIndex, item.fullLabel);
          });
          this.rebuildConversationToc();
        }
      } catch (error) {
        const key = `${conversationId}:${error?.message || error}`;
        if (this.apiConversationLastErrorKey !== key) {
          this.apiConversationLastErrorKey = key;
          console.warn('[ChatGPT 完整问答目录] API 目录读取失败，继续使用 DOM/官方目录回退：', error);
        }
      } finally {
        // 路由切换会递增 token；无论请求属于新旧路由，都必须释放 in-flight 锁。
        this.apiConversationRefreshInFlight = false;
      }
    }

    findApiRecordMatch(apiItem, records, legacyMapping = null) {
      const identity = apiItem?.messageId ? `message:${apiItem.messageId}` : '';
      if (identity) {
        const exact = records.find((record) => record.identity === identity);
        if (exact) return exact;
      }

      const normalizedLabel = this.normalizeConversationText(apiItem?.fullLabel || '');
      if (normalizedLabel) {
        const labelMatches = records.filter((record) =>
          this.normalizeConversationText(record.fullLabel || '') === normalizedLabel);
        if (labelMatches.length === 1) return labelMatches[0];
      }

      if (legacyMapping?.confident) {
        const mapped = legacyMapping.recordsByIndex.get(apiItem.logicalIndex);
        if (mapped) return mapped;
      }
      return null;
    }

    rebuildConversationTocFromApi(apiOutline, records, officialButtons) {
      const buttonsByIndex = new Map();
      officialButtons.forEach((button) => {
        const logicalIndex = Number.parseInt(button.dataset.tocItemIndex ?? '', 10);
        if (Number.isInteger(logicalIndex) && logicalIndex >= 0) buttonsByIndex.set(logicalIndex, button);
      });
      const legacyMapping = this.mapUserRecordsToLogicalIndices(records, officialButtons);

      const items = apiOutline.map((apiItem, logicalIndex) => {
        const canonical = { ...apiItem, logicalIndex };
        const mappedRecord = this.findApiRecordMatch(canonical, records, legacyMapping);
        const officialButton = buttonsByIndex.get(logicalIndex) ?? null;
        const fullLabel = canonical.fullLabel || `提问 ${logicalIndex + 1}`;
        if (fullLabel) this.conversationLabelCache.set(logicalIndex, fullLabel);
        return {
          logicalIndex,
          apiMessageId: canonical.messageId || '',
          apiNodeId: canonical.nodeId || '',
          userElement: mappedRecord?.userElement ?? null,
          targetElement: mappedRecord?.targetElement ?? null,
          officialButton,
          fullLabel,
          label: this.formatConversationLabel(fullLabel),
          mappingConfident: Boolean(mappedRecord),
          // 目录始终完整显示；这里只标记“目标当前是否挂载”，供视觉提示和跳转策略使用。
          unloaded: !mappedRecord?.targetElement?.isConnected,
          source: 'api',
        };
      });

      this.conversationItems = items;
      this.maxObservedOfficialLogicalIndex = Math.max(
        this.maxObservedOfficialLogicalIndex,
        items.length - 1,
      );
      this.lastConversationSignature = this.getConversationSignature();
      this.renderConversationItems();
      const active = this.findActiveConversationIndex();
      this.activeConversationIndex = -1;
      this.applyActiveConversationIndex(active, false);
      this.updateViewMeta();
      this.syncVisibility();
      this.persistConversationLabelSnapshot();
      // API 已提供完整标题，不再运行会主动切换官方目录项的 hydration。
      this.cancelConversationLabelHydration(false);
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
        this.scheduleApiConversationOutlineRefresh(460, true);
      } else if (!this.getApiConversationOutlineForCurrentRoute()) {
        // 首次打开超长会话时 DOM 可能看起来完全没变化，但 API 目录仍需要补齐。
        this.scheduleApiConversationOutlineRefresh(120, false);
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

    getConversationLabelSnapshotKey() {
      const routeKey = this.lastConversationRouteKey || this.getConversationRouteKey();
      return 'cgpt-unified-conversation-labels-v1:' + encodeURIComponent(routeKey);
    }

    restoreConversationLabelSnapshot() {
      try {
        const parsed = JSON.parse(sessionStorage.getItem(this.getConversationLabelSnapshotKey()) || '[]');
        if (!Array.isArray(parsed)) return;
        for (const entry of parsed.slice(0, 500)) {
          const logicalIndex = Number(entry?.[0]);
          const label = this.normalizeConversationText(entry?.[1] || '').slice(0, 1000);
          if (Number.isInteger(logicalIndex) && logicalIndex >= 0 && label) {
            this.conversationLabelCache.set(logicalIndex, label);
          }
        }
      } catch (_) {
        // sessionStorage 不可用或旧快照损坏时直接重新采集。
      }
    }

    persistConversationLabelSnapshot() {
      try {
        const entries = [...this.conversationLabelCache.entries()]
          .filter(([logicalIndex, label]) =>
            Number.isInteger(logicalIndex) && logicalIndex >= 0
            && !this.isConversationPlaceholderLabel(label, logicalIndex))
          .slice(0, 500);
        sessionStorage.setItem(this.getConversationLabelSnapshotKey(), JSON.stringify(entries));
      } catch (_) {
        // 标签只在当前标签页保存；存储不可用不影响目录跳转。
      }
    }

    clearConversationLabelCacheState() {
      this.conversationLabelCache.clear();
      this.conversationCacheIdentityByIndex.clear();
      this.conversationCacheIndexByIdentity.clear();
      this.conversationLabelHydrationAttempts?.clear();
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

    isConversationPlaceholderLabel(label, logicalIndex = -1) {
      const normalized = this.normalizeConversationText(label || '');
      if (!normalized) return true;
      if (/^Prompt\s+\d+$/i.test(normalized)) return true;
      if (/^提问\s+\d+(?:（尚未加载，点击加载）)?$/.test(normalized)) return true;
      return logicalIndex >= 0 && normalized === 'Prompt ' + (logicalIndex + 1);
    }

    findDirectConversationRecord(logicalIndex) {
      const records = this.collectUserMessageRecords();
      return records.find((record) =>
        Number.isInteger(record.turnNumber)
        && Math.floor(record.turnNumber / 2) === logicalIndex
        && !this.isConversationPlaceholderLabel(record.fullLabel, logicalIndex)) || null;
    }

    waitForDirectConversationRecord(logicalIndex, token) {
      const routeKey = this.lastConversationRouteKey;
      const startedAt = performance.now();
      const timeout = Math.max(250, Number(this.config.conversationTocHydrateTimeoutMs) || 900);
      return new Promise((resolve) => {
        const inspect = () => {
          if (token !== this.conversationLabelHydrationToken || routeKey !== this.lastConversationRouteKey) {
            resolve(null);
            return;
          }
          const record = this.findDirectConversationRecord(logicalIndex);
          if (record || performance.now() - startedAt >= timeout) {
            resolve(record);
            return;
          }
          window.setTimeout(inspect, 60);
        };
        inspect();
      });
    }

    restoreConversationLabelHydrationContext() {
      const context = this.conversationLabelHydrationContext;
      this.conversationLabelHydrationContext = null;
      if (!context || context.routeKey !== this.lastConversationRouteKey) return;
      if (context.activeIndex >= 0 && this.getOfficialActiveLogicalIndex() !== context.activeIndex) {
        this.activateOfficialConversationButton(context.activeIndex);
      }
      window.setTimeout(() => {
        if (context.routeKey !== this.lastConversationRouteKey) return;
        if (context.scrollRoot instanceof HTMLElement) context.scrollRoot.scrollTop = context.scrollTop;
        else window.scrollTo({ top: context.scrollTop, behavior: 'auto' });
      }, 120);
    }

    cancelConversationLabelHydration(restore = true) {
      this.conversationLabelHydrationToken += 1;
      window.clearTimeout(this.conversationLabelHydrationTimer);
      this.conversationLabelHydrationTimer = 0;
      this.conversationLabelHydrating = false;
      if (restore) this.restoreConversationLabelHydrationContext();
      else this.conversationLabelHydrationContext = null;
    }

    scheduleConversationLabelHydration(delay = this.config.conversationTocHydrateDelayMs) {
      if (
        !this.config.conversationTocAutoHydrateLabels
        || this.collapsed
        || this.activeView !== 'conversation'
        || document.hidden
        || this.conversationLabelHydrating
        || this.dragState
        || this.resizeState
      ) return;
      const hasMissingLabel = this.conversationItems.some((item) =>
        this.isConversationPlaceholderLabel(item.fullLabel, item.logicalIndex)
        && (this.conversationLabelHydrationAttempts.get(item.logicalIndex) || 0) < 2);
      if (!hasMissingLabel) return;
      window.clearTimeout(this.conversationLabelHydrationTimer);
      this.conversationLabelHydrationTimer = window.setTimeout(() => {
        this.conversationLabelHydrationTimer = 0;
        void this.hydrateConversationLabelBatch();
      }, Math.max(80, Number(delay) || 360));
    }

    async hydrateConversationLabelBatch() {
      if (this.conversationLabelHydrating || this.collapsed || this.activeView !== 'conversation') return;
      const buttons = this.getOfficialNavButtons();
      const buttonIndices = new Set(buttons.map((button) =>
        Number.parseInt(button.dataset.tocItemIndex ?? '', 10)));
      const batchSize = Math.max(1, Math.min(6, Number(this.config.conversationTocHydrateBatchSize) || 3));
      const missing = this.conversationItems
        .filter((item) => buttonIndices.has(item.logicalIndex)
          && this.isConversationPlaceholderLabel(item.fullLabel, item.logicalIndex)
          && (this.conversationLabelHydrationAttempts.get(item.logicalIndex) || 0) < 2)
        .slice(0, batchSize);
      if (!missing.length) return;

      this.conversationLabelHydrating = true;
      const token = ++this.conversationLabelHydrationToken;
      const routeKey = this.lastConversationRouteKey;
      const originalActiveIndex = this.getOfficialActiveLogicalIndex(buttons);
      const scrollRoot = this.currentScrollRoot instanceof HTMLElement
        ? this.currentScrollRoot
        : document.scrollingElement;
      const originalScrollTop = scrollRoot?.scrollTop ?? window.scrollY;
      this.conversationLabelHydrationContext = {
        routeKey,
        activeIndex: originalActiveIndex,
        scrollRoot,
        scrollTop: originalScrollTop,
      };

      try {
        for (const item of missing) {
          if (token !== this.conversationLabelHydrationToken || routeKey !== this.lastConversationRouteKey) break;
          const button = this.getOfficialNavButtons().find((candidate) =>
            Number.parseInt(candidate.dataset.tocItemIndex ?? '', 10) === item.logicalIndex);
          if (!(button instanceof HTMLButtonElement) || button.disabled) continue;
          button.click();
          const record = await this.waitForDirectConversationRecord(item.logicalIndex, token);
          if (record) {
            this.cacheConversationRecordLabel(item.logicalIndex, record);
            this.conversationLabelHydrationAttempts.delete(item.logicalIndex);
          } else {
            const attempts = this.conversationLabelHydrationAttempts.get(item.logicalIndex) || 0;
            this.conversationLabelHydrationAttempts.set(item.logicalIndex, attempts + 1);
          }
        }
      } finally {
        if (token === this.conversationLabelHydrationToken && routeKey === this.lastConversationRouteKey) {
          if (originalActiveIndex >= 0 && this.getOfficialActiveLogicalIndex() !== originalActiveIndex) {
            this.activateOfficialConversationButton(originalActiveIndex);
            await new Promise((resolve) => window.setTimeout(resolve, 120));
          }
          if (scrollRoot instanceof HTMLElement) scrollRoot.scrollTop = originalScrollTop;
          else window.scrollTo({ top: originalScrollTop, behavior: 'auto' });
          this.conversationLabelHydrationContext = null;
          this.persistConversationLabelSnapshot();
          this.conversationLabelHydrating = false;
          this.rebuildConversationToc();
          this.scheduleConversationLabelHydration();
        }
      }
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
        let maxCachedIndex = -1;
        for (const logicalIndex of this.conversationLabelCache.keys()) {
          if (Number.isInteger(logicalIndex)) maxCachedIndex = Math.max(maxCachedIndex, logicalIndex);
        }
        const knownCount = Math.max(this.maxObservedOfficialLogicalIndex, maxCachedIndex) + 1;
        const domAppearsPartial = knownCount > records.length;
        const offset = domAppearsPartial ? knownCount - records.length : 0;
        acceptCandidate(
          records.map((_, index) => index + offset),
          domAppearsPartial ? 'known-catalog-partial' : 'dom-only',
          !domAppearsPartial,
          !domAppearsPartial,
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
      const apiOutline = this.getApiConversationOutlineForCurrentRoute();
      if (apiOutline?.length) {
        this.rebuildConversationTocFromApi(apiOutline, records, officialButtons);
        return;
      }
      const cachedOutline = globalThis.__cgptUnifiedRuntimeV1?.sessionExporter?.getCachedConversationOutlineSync?.();
      if (cachedOutline?.conversationId === this.getConversationIdFromLocation() && cachedOutline.items?.length) {
        this.apiConversationOutline = cachedOutline;
        this.rebuildConversationTocFromApi(cachedOutline.items, records, officialButtons);
        return;
      }
      const mapping = this.mapUserRecordsToLogicalIndices(records, officialButtons);
      const items = [];

      /*
       * 首次 hydration 时官方目录可能先出现 1～2 项，随后一次性扩展为
       * 完整问答数。只有缓存尚不完整时才清空早期错位索引；完整快照必须保留。
       */
      if (
        this.maxObservedOfficialLogicalIndex >= 0 &&
        mapping.officialMaxIndex > this.maxObservedOfficialLogicalIndex + 1 &&
        this.conversationLabelCache.size < mapping.officialMaxIndex + 1
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
      // 官方导航或 DOM 暂时缩小时，目录总数不得回退。
      const maxIndex = Math.max(
        mapping.maxIndex,
        maxKnownIndex,
        this.maxObservedOfficialLogicalIndex,
      );

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
      this.persistConversationLabelSnapshot();
      this.scheduleConversationLabelHydration();
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
      if (currentItem?.apiMessageId) {
        const exactRecord = records.find((record) =>
          record.identity === `message:${currentItem.apiMessageId}`);
        if (exactRecord) {
          currentItem.userElement = exactRecord.userElement;
          currentItem.targetElement = exactRecord.targetElement;
          currentItem.mappingConfident = true;
          currentItem.unloaded = !exactRecord.targetElement?.isConnected;
          return exactRecord.targetElement || exactRecord.userElement;
        }
      }

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
      this.cancelConversationLabelHydration(false);
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

    clearHeadingJumpSettleListener() {
      window.clearTimeout(this.headingJumpSettleTimer);
      this.headingJumpSettleTimer = 0;
      if (this.headingJumpScrollTarget && this.headingJumpScrollEndHandler) {
        try {
          this.headingJumpScrollTarget.removeEventListener('scrollend', this.headingJumpScrollEndHandler);
        } catch {}
      }
      this.headingJumpScrollTarget = null;
      this.headingJumpScrollEndHandler = null;
    }

    cancelHeadingJump() {
      this.headingJumpToken += 1;
      this.clearHeadingJumpSettleListener();
      this.pendingHeadingIndex = -1;
      this.pendingHeadingUntil = 0;
      window.clearTimeout(this.pendingHeadingTimer);
      this.pendingHeadingTimer = 0;
    }

    jumpToHeading(index) {
      const heading = this.headings[index];
      if (!heading?.element?.isConnected) return;

      this.cancelHeadingJump();
      const token = this.headingJumpToken;
      const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      const behavior = this.config.answerTocSmoothScroll && !reduceMotion
        ? 'smooth'
        : 'auto';

      // 跳转完成前固定用户点击的章节，避免 smooth scroll 穿过中间标题时高亮闪烁。
      const maxHoldMs = behavior === 'smooth' ? 1800 : 260;
      this.pendingHeadingIndex = index;
      this.pendingHeadingUntil = performance.now() + maxHoldMs;
      this.applyActiveIndex(index, true);
      globalThis.__cgptUnifiedRuntimeV1?.beginNavigationLease?.(behavior === 'smooth' ? 2600 : 900);

      const finish = () => {
        if (token !== this.headingJumpToken) return;
        this.clearHeadingJumpSettleListener();
        if (heading.element.isConnected) {
          const targetY = this.getJumpLineViewportY();
          const delta = heading.element.getBoundingClientRect().top - targetY;
          if (Math.abs(delta) > 8) this.scrollHeadingToReadingLine(heading.element, 'auto');
        }
        this.pendingHeadingIndex = -1;
        this.pendingHeadingUntil = 0;
        window.clearTimeout(this.pendingHeadingTimer);
        this.pendingHeadingTimer = 0;
        this.requestFrame(false);
      };

      this.scrollHeadingToReadingLine(heading.element, behavior);

      if (behavior === 'smooth') {
        // Chrome/Edge 支持 scrollend 时等真实动画结束再校正；不支持时走超时兜底。
        const scrollTarget = this.currentScrollRoot instanceof HTMLElement
          ? this.currentScrollRoot
          : document;
        const startedAt = performance.now();
        const onScrollEnd = () => {
          if (token !== this.headingJumpToken) return;
          // 防止上一段滚动残留的 scrollend 在本次跳转刚开始时误触发。
          const elapsed = performance.now() - startedAt;
          if (elapsed < 90) {
            window.clearTimeout(this.headingJumpSettleTimer);
            this.headingJumpSettleTimer = window.setTimeout(finish, 100 - elapsed);
            return;
          }
          finish();
        };
        this.headingJumpScrollTarget = scrollTarget;
        this.headingJumpScrollEndHandler = onScrollEnd;
        try {
          scrollTarget.addEventListener('scrollend', onScrollEnd, { once: true, passive: true });
        } catch {}
        this.headingJumpSettleTimer = window.setTimeout(finish, maxHoldMs);
      } else {
        this.headingJumpSettleTimer = window.setTimeout(finish, 80);
      }
    }

    getJumpLineViewportY() {
      const ratio = Math.min(0.75, Math.max(0.08, Number(this.config.answerTocJumpLineRatio) || 0.22));
      if (this.currentScrollRoot instanceof HTMLElement) {
        const rect = this.currentScrollRoot.getBoundingClientRect();
        const top = Math.max(0, rect.top);
        const bottom = Math.min(window.innerHeight, rect.bottom);
        return top + Math.max(1, bottom - top) * ratio;
      }
      return window.innerHeight * ratio;
    }

    scrollHeadingToReadingLine(element, behavior = 'auto') {
      if (!(element instanceof HTMLElement) || !element.isConnected) return;
      const targetY = this.getJumpLineViewportY();
      const delta = element.getBoundingClientRect().top - targetY;
      if (Math.abs(delta) < 1) return;

      if (this.currentScrollRoot instanceof HTMLElement) {
        this.currentScrollRoot.scrollTo({
          top: Math.max(0, this.currentScrollRoot.scrollTop + delta),
          behavior,
        });
      } else {
        const scrollingElement = document.scrollingElement || document.documentElement;
        const currentTop = window.scrollY || scrollingElement.scrollTop || 0;
        window.scrollTo({ top: Math.max(0, currentTop + delta), behavior });
      }
    }

    updateActiveHeading() {
      if (!this.headings.length || !this.currentAnswer?.isConnected) return;

      if (
        this.pendingHeadingIndex >= 0 &&
        this.pendingHeadingIndex < this.headings.length &&
        performance.now() < this.pendingHeadingUntil
      ) {
        this.applyActiveIndex(this.pendingHeadingIndex, false);
        return;
      }
      if (this.pendingHeadingIndex >= 0) {
        this.pendingHeadingIndex = -1;
        this.pendingHeadingUntil = 0;
      }

      const lineY = this.getActiveLineViewportY();
      const hysteresis = Math.max(0, Number(this.config.answerTocActiveHysteresisPx) || 0);
      const currentScrollTop = this.getScrollTop();
      const viewportSpan = this.getScrollViewportSpan();
      const largeJump = Math.abs(currentScrollTop - this.lastScrollTop) > viewportSpan * 0.8;
      this.lastScrollTop = currentScrollTop;

      let index = this.activeIndex;
      if (index < 0 || index >= this.headings.length || largeJump) {
        index = this.findActiveIndexBinary(lineY);
      } else {
        // 向下进入新章节时必须越过活动线一点；向上返回旧章节同理。
        // 这一小段迟滞区能消除触控板慢滚时的 2↔3 抖动。
        while (
          index + 1 < this.headings.length &&
          this.headings[index + 1].element.getBoundingClientRect().top <= lineY - hysteresis
        ) {
          index += 1;
        }

        while (
          index > 0 &&
          this.headings[index].element.getBoundingClientRect().top > lineY + hysteresis
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
      if (
        ensureVisible ||
        (!this.collapsed && this.activeView === 'headings' && !this.isHeadingNavAutoFollowSuspended())
      ) {
        this.scrollItemIntoView(this.tocNav, current);
      }
    }

    markHeadingNavInteraction(duration = this.config.answerTocManualBrowseHoldMs) {
      const hold = Math.max(250, Number(duration) || 1500);
      this.headingNavUserActiveUntil = Math.max(this.headingNavUserActiveUntil, performance.now() + hold);
    }

    isHeadingNavAutoFollowSuspended() {
      return this.headingNavPointerInside || performance.now() < this.headingNavUserActiveUntil;
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

      if (document.documentElement.clientWidth < 820) offset = 8;

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
    const BOTTOM_RECOLLAPSE_THRESHOLD = 850; // px: 可开始回收，但不代表视口应被强制吸到底部
    const BOTTOM_PIN_THRESHOLD = 96;         // px: 只有真正贴近底部时才维持 bottom pin
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

    function isUnifiedNavigationActive() {
      return document.documentElement?.hasAttribute('data-cgpt-unified-navigation-active') === true;
    }

    function isInteractionHot() {
      // 目录跳转期间性能模块必须完全让路，避免刚恢复的目标轮次
      // 在长距离导航重试尚未结束时又被后台回收。
      return now() < inputHotUntil || isUnifiedNavigationActive();
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
      // Parked 节点本身已经脱离 DOM，但它的 placeholder 仍留在原位置。
      // 以 placeholder 作为排序锚点即可恢复“真实会话顺序”，而不是简单地
      // 把 parked + live 两组拼接。这样 DOM 回退导出和目录都不会乱序。
      const records = [
        ...hiddenStore.map((item, index) => ({
          node: item.node,
          anchor: item.placeholder,
          fallback: index,
        })),
        ...getTurns().map((node, index) => ({
          node,
          anchor: node,
          fallback: hiddenStore.length + index,
        })),
      ];
      const seen = new Set();
      const unique = records.filter(({ node }) =>
        node instanceof HTMLElement && !seen.has(node) && seen.add(node)
      );

      unique.sort((a, b) => {
        if (a.anchor === b.anchor) return a.fallback - b.fallback;
        if (a.anchor?.isConnected && b.anchor?.isConnected) {
          const relation = a.anchor.compareDocumentPosition(b.anchor);
          if (relation & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
          if (relation & Node.DOCUMENT_POSITION_PRECEDING) return 1;
        }

        const getTurnNumber = (node) => {
          const match = /conversation-turn-(\d+)/i.exec(node?.getAttribute?.('data-testid') || '');
          return match ? Number.parseInt(match[1], 10) : null;
        };
        const an = getTurnNumber(a.node);
        const bn = getTurnNumber(b.node);
        if (an != null && bn != null && an !== bn) return an - bn;
        return a.fallback - b.fallback;
      });

      return unique.map(({ node }) => node);
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
        const pinnedToBottomBefore = isNearBottom(BOTTOM_PIN_THRESHOLD);

        // “允许回收”与“强制贴底”是两件事。用户哪怕距离底部还有几百像素，
        // 也可能正在读刚生成的上一段内容；此时回收旧 DOM 可以继续做，但
        // 必须用锚点补偿保持当前阅读位置。
        withAnchorCompensation(preserveAnchor || !pinnedToBottomBefore, () => {
          detachFirstN(getTurns(), needDetach);
        });

        if (pinnedToBottomBefore) requestAnimationFrame(scrollToBottom);

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
  const CHATGPT_DISCLAIMER_TEXT = 'ChatGPT 也可能会犯错。请核查重要信息。';
  const CHATGPT_DISCLAIMER_KEY = CHATGPT_DISCLAIMER_TEXT.replace(/\s+/g, '');
  const HIDDEN_DISCLAIMER_CLASS = 'ophel-chatgpt-disclaimer-hidden';
  const KATEX_STYLE_ID = 'cgfc-katex-resource-style';
  const RESIDUAL_WRAPPER_CLASS = 'cgfc-residual-latex';
  const RESIDUAL_ROOT_MARKER = 'data-cgfc-residual-root';
  const RESIDUAL_DEBOUNCE_MS = 180;
  const RESIDUAL_MAX_TEXT_NODES = 300;
  const STORAGE_KEY = 'chatgpt_font_customizer_settings_v2';
  const THEME_PALETTE_MIGRATION_KEY = 'cgpt_unified_theme_palette_migration_v1';
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
    stopAutoScrollWhileGenerating: true,
    wrapCode: true,
    enableFontSmoothing: true,
    fontSmoothingMode: 'antialiased',
    textRenderingMode: 'optimizeLegibility',
    enableResidualLatex: true,
    enableKatexLetterFont: true,
    enableFormulaCopy: true,
    formulaCopyDelimiters: true,
    formulaCopyBorderColor: '#6d5dfc',
    toolboxFont: '"Segoe UI", "Microsoft YaHei", sans-serif',
    toolboxFontSize: 13,
    toolboxLineHeight: 1.4,
    toolboxPanelWidth: 300,
    toolboxUseCustomColors: false,
    toolboxTextColor: '#f4f4f4',
    toolboxBackgroundColor: '#212121',
    toolboxAccentColor: '#6d5dfc',
    toolboxOpacity: 0.82,
    queueFont: '"Segoe UI", "Microsoft YaHei", sans-serif',
    queueFontSize: 12,
    queueLineHeight: 1.4,
    queuePanelWidth: 420,
    queueUseCustomColors: false,
    queueTextColor: '#f4f4f4',
    queueBackgroundColor: '#212121',
    queueAccentColor: '#6d5dfc',
    queueOpacity: 0.94,
    showTokenStats: true,
    showTokenMessageChips: true,
    showTokenSummary: true,
    tokenSummaryPosition: 'auto',
    tokenSummaryOffsetX: 0,
    tokenSummaryOffsetY: 0,
    tokenSummaryCompactAlways: false,
    tokenSummaryCompactOnNarrow: true,
    tokenSummaryAvoidQueue: true,
    tokenSummaryTextColor: '#f4f4f4',
    tokenSummaryBackgroundColor: '#212121',
    tokenSummaryBorderColor: '#3f3f46',
  };

  // Appearance values are stored independently from whether the script is
  // currently allowed to override them. Turning an override off deliberately
  // removes the corresponding CSS declaration instead of substituting another
  // script default.
  const OVERRIDEABLE_SETTING_KEYS = new Set([
    'latinFont', 'chineseFont', 'boldLatinFont', 'boldChineseFont',
    'mathFont', 'mathFontMode', 'codeFont',
    'fontSize', 'lineHeight', 'codeFontSize', 'codeLineHeight',
    'normalColor', 'boldColor', 'boldWeight',
    'fontSmoothingMode', 'textRenderingMode', 'formulaCopyBorderColor',
    'toolboxFont', 'toolboxFontSize', 'toolboxLineHeight', 'toolboxPanelWidth',
    'toolboxTextColor', 'toolboxBackgroundColor', 'toolboxAccentColor', 'toolboxOpacity',
    'queueFont', 'queueFontSize', 'queueLineHeight', 'queuePanelWidth',
    'queueTextColor', 'queueBackgroundColor', 'queueAccentColor', 'queueOpacity',
    'tokenSummaryTextColor', 'tokenSummaryBackgroundColor', 'tokenSummaryBorderColor',
  ]);
  const DEFAULT_DISABLED_OVERRIDE_KEYS = new Set([
    'normalColor', 'boldColor',
    'toolboxTextColor', 'toolboxBackgroundColor', 'toolboxAccentColor', 'toolboxOpacity',
    'queueTextColor', 'queueBackgroundColor', 'queueAccentColor', 'queueOpacity',
    'tokenSummaryTextColor', 'tokenSummaryBackgroundColor', 'tokenSummaryBorderColor',
  ]);
  const overrideEnabledKey = (key) => `${key}Enabled`;
  for (const key of OVERRIDEABLE_SETTING_KEYS) {
    defaults[overrideEnabledKey(key)] = !DEFAULT_DISABLED_OVERRIDE_KEYS.has(key);
  }

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
    stopAutoScrollWhileGenerating: 'boolean',
    wrapCode: 'boolean',
    enableFontSmoothing: 'boolean',
    fontSmoothingMode: 'select',
    textRenderingMode: 'select',
    enableResidualLatex: 'boolean',
    enableKatexLetterFont: 'boolean',
    enableFormulaCopy: 'boolean',
    formulaCopyDelimiters: 'boolean',
    formulaCopyBorderColor: 'color',
    toolboxFont: 'text',
    toolboxFontSize: 'number',
    toolboxLineHeight: 'number',
    toolboxPanelWidth: 'number',
    toolboxUseCustomColors: 'boolean',
    toolboxTextColor: 'color',
    toolboxBackgroundColor: 'color',
    toolboxAccentColor: 'color',
    toolboxOpacity: 'number',
    queueFont: 'text',
    queueFontSize: 'number',
    queueLineHeight: 'number',
    queuePanelWidth: 'number',
    queueUseCustomColors: 'boolean',
    queueTextColor: 'color',
    queueBackgroundColor: 'color',
    queueAccentColor: 'color',
    queueOpacity: 'number',
    showTokenStats: 'boolean',
    showTokenMessageChips: 'boolean',
    showTokenSummary: 'boolean',
    tokenSummaryPosition: 'select',
    tokenSummaryOffsetX: 'number',
    tokenSummaryOffsetY: 'number',
    tokenSummaryCompactAlways: 'boolean',
    tokenSummaryCompactOnNarrow: 'boolean',
    tokenSummaryAvoidQueue: 'boolean',
    tokenSummaryTextColor: 'color',
    tokenSummaryBackgroundColor: 'color',
    tokenSummaryBorderColor: 'color',
  };
  for (const key of OVERRIDEABLE_SETTING_KEYS) {
    settingTypes[overrideEnabledKey(key)] = 'boolean';
  }

  const numberLimits = {
    fontSize: [10, 40],
    lineHeight: [1, 2.8],
    codeFontSize: [10, 32],
    codeLineHeight: [1, 2.8],
    boldWeight: [400, 1000],
    toolboxFontSize: [9, 24],
    toolboxLineHeight: [1, 2.2],
    toolboxPanelWidth: [220, 560],
    toolboxOpacity: [0.2, 1],
    queueFontSize: [9, 24],
    queueLineHeight: [1, 2.2],
    queuePanelWidth: [280, 720],
    queueOpacity: [0.2, 1],
    tokenSummaryOffsetX: [-600, 600],
    tokenSummaryOffsetY: [-600, 600],
  };

  const selectValues = {
    mathFontMode: ['native', 'off'],
    fontSmoothingMode: ['auto', 'antialiased', 'subpixel-antialiased'],
    textRenderingMode: ['auto', 'optimizeLegibility', 'geometricPrecision'],
    tokenSummaryPosition: [
      'auto',
      'composer-top-center',
      'composer-top-left',
      'composer-top-right',
      'viewport-bottom-left',
      'viewport-bottom-right',
    ],
  };

  const FONT_SETTING_KEYS = new Set([
    'latinFont', 'chineseFont', 'boldLatinFont', 'boldChineseFont', 'mathFont', 'codeFont',
    'toolboxFont', 'queueFont',
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
  let disclaimerTimer = 0;
  let shellGuardTimer = 0;
  let observersStarted = false;
  let residualLatexObserverStarted = false;
  let residualLatexTimer = 0;
  let formulaCopyInitialized = false;
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

  function colorWithAlpha(value, alpha, fallback) {
    const color = sanitizeColor(value, fallback);
    const opacity = clamp(alpha, 0, 1, 1);
    const red = Number.parseInt(color.slice(1, 3), 16);
    const green = Number.parseInt(color.slice(3, 5), 16);
    const blue = Number.parseInt(color.slice(5, 7), 16);
    return `rgba(${red}, ${green}, ${blue}, ${opacity})`;
  }

  function parseRgbColor(value) {
    const text = String(value || '').trim();
    const rgb = text.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/i);
    if (rgb) {
      return {
        red: clamp(rgb[1], 0, 255, 0),
        green: clamp(rgb[2], 0, 255, 0),
        blue: clamp(rgb[3], 0, 255, 0),
        alpha: rgb[4] == null ? 1 : clamp(rgb[4], 0, 1, 1),
      };
    }
    const hex = text.match(/^#([0-9a-f]{6})$/i);
    if (!hex) return null;
    return {
      red: Number.parseInt(hex[1].slice(0, 2), 16),
      green: Number.parseInt(hex[1].slice(2, 4), 16),
      blue: Number.parseInt(hex[1].slice(4, 6), 16),
      alpha: 1,
    };
  }

  function detectPageTheme() {
    const root = document.documentElement;
    if (!root) return 'light';

    const explicit = [
      root.getAttribute('data-theme'),
      root.getAttribute('data-color-scheme'),
      document.body?.getAttribute?.('data-theme'),
    ].map((value) => String(value || '').toLowerCase());
    if (explicit.some((value) => value === 'dark')) return 'dark';
    if (explicit.some((value) => value === 'light')) return 'light';
    if (root.classList.contains('dark') || document.body?.classList?.contains('dark')) return 'dark';
    if (root.classList.contains('light') || document.body?.classList?.contains('light')) return 'light';

    try {
      const rootStyle = getComputedStyle(root);
      const bodyStyle = document.body ? getComputedStyle(document.body) : null;
      const candidates = [
        rootStyle.getPropertyValue('--main-surface-primary'),
        rootStyle.getPropertyValue('--bg-primary'),
        bodyStyle?.backgroundColor,
        rootStyle.backgroundColor,
      ];
      for (const candidate of candidates) {
        const rgb = parseRgbColor(candidate);
        if (!rgb || rgb.alpha < 0.2) continue;
        const luma = (rgb.red * 0.2126 + rgb.green * 0.7152 + rgb.blue * 0.0722) / 255;
        return luma < 0.48 ? 'dark' : 'light';
      }
      const colorScheme = `${rootStyle.colorScheme || ''} ${bodyStyle?.colorScheme || ''}`.toLowerCase();
      if (/\bdark\b/.test(colorScheme) && !/\blight\b/.test(colorScheme)) return 'dark';
    } catch (_) {}

    try {
      return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    } catch (_) {
      return 'light';
    }
  }

  function syncThemeMode() {
    const root = document.documentElement;
    if (!root) return 'light';
    const theme = detectPageTheme();
    root.dataset.cgfcTheme = theme;
    root.style.setProperty('--cgfc-color-scheme', theme);
    return theme;
  }

  let themeSyncStarted = false;
  let themeSyncObserver = null;
  function startThemeSync() {
    syncThemeMode();
    if (themeSyncStarted) return;
    themeSyncStarted = true;

    const observeThemeTarget = (target) => {
      if (!(target instanceof Element)) return;
      themeSyncObserver?.observe(target, {
        attributes: true,
        attributeFilter: ['class', 'data-theme', 'data-color-scheme'],
      });
    };

    themeSyncObserver = new MutationObserver(() => syncThemeMode());
    observeThemeTarget(document.documentElement);
    observeThemeTarget(document.body);
    if (!document.body) {
      document.addEventListener('DOMContentLoaded', () => {
        observeThemeTarget(document.body);
        syncThemeMode();
      }, { once: true });
    }

    try {
      const media = matchMedia('(prefers-color-scheme: dark)');
      media.addEventListener?.('change', syncThemeMode);
    } catch (_) {}
    window.addEventListener('pageshow', syncThemeMode);
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
    if (['latinFont', 'chineseFont', 'boldLatinFont', 'boldChineseFont', 'mathFont', 'codeFont', 'toolboxFont', 'queueFont'].includes(key)) {
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

    // Preserve the v1.4.x palette behavior when migrating an existing
    // installation. Other appearance values were always active before v1.5.0,
    // so their new per-item switches intentionally default to on.
    const migrateLegacyPalette = (prefix) => {
      const legacyKey = `${prefix}UseCustomColors`;
      if (!Object.prototype.hasOwnProperty.call(saved, legacyKey)) return;
      const enabled = normalizeSetting(legacyKey, saved[legacyKey]);
      ['TextColor', 'BackgroundColor', 'AccentColor', 'Opacity'].forEach((suffix) => {
        const enabledKey = overrideEnabledKey(`${prefix}${suffix}`);
        if (!Object.prototype.hasOwnProperty.call(saved, enabledKey)) saved[enabledKey] = enabled;
      });
    };
    migrateLegacyPalette('toolbox');
    migrateLegacyPalette('queue');

    // Older builds enabled a fixed white body palette by default, which made
    // ChatGPT's light theme nearly unreadable. Migrate only the exact legacy
    // default pair once; any customized body palette remains untouched.
    const themePaletteMigrated = readStore(THEME_PALETTE_MIGRATION_KEY, false) === true;
    if (!themePaletteMigrated) {
      const legacyDefaultPair = String(saved.normalColor || '').toLowerCase() === '#ffffff'
        && String(saved.boldColor || '').toLowerCase() === '#e8e2d8';
      if (legacyDefaultPair) {
        saved[overrideEnabledKey('normalColor')] = false;
        saved[overrideEnabledKey('boldColor')] = false;
      }
      writeStore(THEME_PALETTE_MIGRATION_KEY, true);
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

  function applySettings() {
    const root = document.documentElement;
    if (!root) return false;
    syncThemeMode();
    installStaticStyles();

    const enabled = (key) => Boolean(settings[overrideEnabledKey(key)]);
    const setOrRemove = (property, shouldApply, value) => {
      if (shouldApply) root.style.setProperty(property, value);
      else root.style.removeProperty(property);
    };
    const toggleOverrideAttr = (name, shouldApply) => root.toggleAttribute(name, Boolean(shouldApply));

    // Font-family is a stack, so Latin and CJK cannot be split perfectly once
    // one half is customized. If only one half is enabled, use ChatGPT's native
    // family stack as the other half rather than a userscript default. If both
    // halves are off, the font-family rule itself is disabled completely.
    const nativeFamily = (selector, attrName, fallback = 'system-ui') => {
      const had = root.hasAttribute(attrName);
      root.removeAttribute(attrName);
      let value = fallback;
      try {
        const target = document.querySelector(selector) || document.querySelector('main') || document.body || root;
        value = getComputedStyle(target).fontFamily || fallback;
      } catch (_) {}
      if (had) root.setAttribute(attrName, '');
      return value;
    };

    const latinEnabled = enabled('latinFont');
    const chineseEnabled = enabled('chineseFont');
    const bodyFontEnabled = latinEnabled || chineseEnabled;
    if (bodyFontEnabled) {
      const nativeBodyFont = (!latinEnabled || !chineseEnabled)
        ? nativeFamily('main [data-message-author-role] .markdown, main [data-message-author-role] .prose, main [data-message-author-role]', 'data-cgfc-body-font')
        : 'system-ui';
      root.style.setProperty('--cgfc-latin-font', latinEnabled
        ? stripGenericFontFallbacks(settings.latinFont, defaults.latinFont)
        : stripGenericFontFallbacks(nativeBodyFont, 'system-ui'));
      root.style.setProperty('--cgfc-chinese-font', chineseEnabled
        ? sanitizeFontStack(settings.chineseFont, defaults.chineseFont)
        : sanitizeFontStack(nativeBodyFont, 'system-ui'));
    } else {
      root.style.removeProperty('--cgfc-latin-font');
      root.style.removeProperty('--cgfc-chinese-font');
    }
    toggleOverrideAttr('data-cgfc-body-font', bodyFontEnabled);

    const boldLatinEnabled = enabled('boldLatinFont');
    const boldChineseEnabled = enabled('boldChineseFont');
    const boldFontEnabled = boldLatinEnabled || boldChineseEnabled;
    if (boldFontEnabled) {
      const nativeBoldFont = (!boldLatinEnabled || !boldChineseEnabled)
        ? nativeFamily('main [data-message-author-role] strong, main [data-message-author-role] b', 'data-cgfc-bold-font')
        : 'system-ui';
      root.style.setProperty('--cgfc-bold-latin-font', boldLatinEnabled
        ? stripGenericFontFallbacks(settings.boldLatinFont, defaults.boldLatinFont)
        : stripGenericFontFallbacks(nativeBoldFont, 'system-ui'));
      root.style.setProperty('--cgfc-bold-chinese-font', boldChineseEnabled
        ? sanitizeFontStack(settings.boldChineseFont, defaults.boldChineseFont)
        : sanitizeFontStack(nativeBoldFont, 'system-ui'));
    } else {
      root.style.removeProperty('--cgfc-bold-latin-font');
      root.style.removeProperty('--cgfc-bold-chinese-font');
    }
    toggleOverrideAttr('data-cgfc-bold-font', boldFontEnabled);

    setOrRemove('--cgfc-code-font', enabled('codeFont'), sanitizeFontStack(settings.codeFont, defaults.codeFont));
    toggleOverrideAttr('data-cgfc-code-font', enabled('codeFont'));
    setOrRemove('--cgfc-math-font', enabled('mathFont'), sanitizeFontStack(settings.mathFont, defaults.mathFont));
    toggleOverrideAttr('data-cgfc-math-font', enabled('mathFont'));

    setOrRemove('--cgfc-font-size', enabled('fontSize'), `${normalizeSetting('fontSize', settings.fontSize)}px`);
    toggleOverrideAttr('data-cgfc-font-size', enabled('fontSize'));
    setOrRemove('--cgfc-line-height', enabled('lineHeight'), String(normalizeSetting('lineHeight', settings.lineHeight)));
    toggleOverrideAttr('data-cgfc-line-height', enabled('lineHeight'));
    setOrRemove('--cgfc-code-font-size', enabled('codeFontSize'), `${normalizeSetting('codeFontSize', settings.codeFontSize)}px`);
    toggleOverrideAttr('data-cgfc-code-font-size', enabled('codeFontSize'));
    setOrRemove('--cgfc-code-line-height', enabled('codeLineHeight'), String(normalizeSetting('codeLineHeight', settings.codeLineHeight)));
    toggleOverrideAttr('data-cgfc-code-line-height', enabled('codeLineHeight'));
    setOrRemove('--cgfc-normal-color', enabled('normalColor'), normalizeSetting('normalColor', settings.normalColor));
    toggleOverrideAttr('data-cgfc-normal-color', enabled('normalColor'));
    setOrRemove('--cgfc-bold-color', enabled('boldColor'), normalizeSetting('boldColor', settings.boldColor));
    toggleOverrideAttr('data-cgfc-bold-color', enabled('boldColor'));
    setOrRemove('--cgfc-bold-weight', enabled('boldWeight'), String(normalizeSetting('boldWeight', settings.boldWeight)));
    toggleOverrideAttr('data-cgfc-bold-weight', enabled('boldWeight'));

    const smoothingEnabled = Boolean(settings.enableFontSmoothing) && enabled('fontSmoothingMode');
    setOrRemove('--cgfc-font-smoothing', smoothingEnabled, normalizeSetting('fontSmoothingMode', settings.fontSmoothingMode));
    setOrRemove('--cgfc-moz-font-smoothing', smoothingEnabled, getMozFontSmoothing(settings.fontSmoothingMode));
    toggleOverrideAttr('data-cgfc-font-smoothing-mode', smoothingEnabled);
    const textRenderingEnabled = Boolean(settings.enableFontSmoothing) && enabled('textRenderingMode');
    setOrRemove('--cgfc-text-rendering', textRenderingEnabled, normalizeSetting('textRenderingMode', settings.textRenderingMode));
    toggleOverrideAttr('data-cgfc-text-rendering-mode', textRenderingEnabled);
    root.removeAttribute('data-cgfc-font-smoothing');

    setOrRemove('--cgfc-formula-copy-border-color', enabled('formulaCopyBorderColor'), normalizeSetting('formulaCopyBorderColor', settings.formulaCopyBorderColor));

    const applyWidgetBase = (prefix) => {
      setOrRemove(`--cgfc-${prefix}-font`, enabled(`${prefix}Font`), sanitizeFontStack(settings[`${prefix}Font`], defaults[`${prefix}Font`]));
      setOrRemove(`--cgfc-${prefix}-font-size`, enabled(`${prefix}FontSize`), `${normalizeSetting(`${prefix}FontSize`, settings[`${prefix}FontSize`])}px`);
      setOrRemove(`--cgfc-${prefix}-line-height`, enabled(`${prefix}LineHeight`), String(normalizeSetting(`${prefix}LineHeight`, settings[`${prefix}LineHeight`])));
      setOrRemove(`--cgfc-${prefix}-panel-width`, enabled(`${prefix}PanelWidth`), `${normalizeSetting(`${prefix}PanelWidth`, settings[`${prefix}PanelWidth`])}px`);
    };
    applyWidgetBase('toolbox');
    applyWidgetBase('queue');

    const applyWidgetPalette = (prefix) => {
      const textEnabled = enabled(`${prefix}TextColor`);
      const backgroundEnabled = enabled(`${prefix}BackgroundColor`);
      const accentEnabled = enabled(`${prefix}AccentColor`);
      const opacityEnabled = enabled(`${prefix}Opacity`);

      if (textEnabled) {
        const textColor = normalizeSetting(`${prefix}TextColor`, settings[`${prefix}TextColor`]);
        root.style.setProperty(`--cgfc-${prefix}-text-color`, textColor);
        root.style.setProperty(`--cgfc-${prefix}-muted-color`, colorWithAlpha(textColor, 0.68, defaults[`${prefix}TextColor`]));
      } else {
        root.style.removeProperty(`--cgfc-${prefix}-text-color`);
        root.style.removeProperty(`--cgfc-${prefix}-muted-color`);
      }

      setOrRemove(`--cgfc-${prefix}-accent-color`, accentEnabled, normalizeSetting(`${prefix}AccentColor`, settings[`${prefix}AccentColor`]));

      if (!backgroundEnabled && !opacityEnabled) {
        root.style.removeProperty(`--cgfc-${prefix}-panel-background`);
        if (prefix === 'toolbox') root.style.removeProperty('--cgfc-toolbox-launcher-background');
        return;
      }

      const opacity = normalizeSetting(`${prefix}Opacity`, settings[`${prefix}Opacity`]);
      let panelBackground;
      if (backgroundEnabled) {
        const background = normalizeSetting(`${prefix}BackgroundColor`, settings[`${prefix}BackgroundColor`]);
        panelBackground = opacityEnabled
          ? colorWithAlpha(background, opacity, defaults[`${prefix}BackgroundColor`])
          : background;
      } else {
        const percent = Math.round(opacity * 100);
        panelBackground = `color-mix(in srgb, var(--cgfc-theme-surface-primary, var(--main-surface-primary, var(--bg-primary, #fff))) ${percent}%, transparent)`;
      }
      root.style.setProperty(`--cgfc-${prefix}-panel-background`, panelBackground);
      if (prefix === 'toolbox') {
        if (backgroundEnabled) {
          const background = normalizeSetting('toolboxBackgroundColor', settings.toolboxBackgroundColor);
          root.style.setProperty('--cgfc-toolbox-launcher-background', opacityEnabled
            ? colorWithAlpha(background, Math.min(1, opacity + 0.08), defaults.toolboxBackgroundColor)
            : background);
        } else {
          const percent = Math.round(Math.min(1, opacity + 0.08) * 100);
          root.style.setProperty('--cgfc-toolbox-launcher-background', `color-mix(in srgb, var(--cgfc-theme-surface-primary, var(--main-surface-primary, var(--bg-primary, #fff))) ${percent}%, transparent)`);
        }
      }
    };
    applyWidgetPalette('toolbox');
    applyWidgetPalette('queue');

    root.dataset.cgfcMathMode = enabled('mathFontMode')
      ? normalizeSetting('mathFontMode', settings.mathFontMode)
      : 'off';
    root.toggleAttribute('data-cgfc-wrap-code', settings.wrapCode);
    root.toggleAttribute('data-cgfc-katex-letter-font', settings.enableKatexLetterFont && enabled('mathFont'));
    root.toggleAttribute('data-cgfc-formula-copy', settings.enableFormulaCopy);
    root.toggleAttribute('data-cgpt-token-stats-enabled', settings.showTokenStats);
    root.toggleAttribute('data-cgpt-token-message-chips-enabled', settings.showTokenMessageChips);
    root.toggleAttribute('data-cgpt-token-summary-enabled', settings.showTokenSummary);
    root.setAttribute('data-cgpt-token-summary-position', normalizeSetting('tokenSummaryPosition', settings.tokenSummaryPosition));
    root.setAttribute('data-cgpt-token-summary-offset-x', String(normalizeSetting('tokenSummaryOffsetX', settings.tokenSummaryOffsetX)));
    root.setAttribute('data-cgpt-token-summary-offset-y', String(normalizeSetting('tokenSummaryOffsetY', settings.tokenSummaryOffsetY)));
    root.toggleAttribute('data-cgpt-token-summary-compact-always', settings.tokenSummaryCompactAlways);
    root.toggleAttribute('data-cgpt-token-summary-compact-narrow', settings.tokenSummaryCompactOnNarrow);
    root.toggleAttribute('data-cgpt-token-summary-avoid-queue', settings.tokenSummaryAvoidQueue);
    setOrRemove('--cgfc-token-summary-text-color', enabled('tokenSummaryTextColor'), normalizeSetting('tokenSummaryTextColor', settings.tokenSummaryTextColor));
    setOrRemove('--cgfc-token-summary-background-color', enabled('tokenSummaryBackgroundColor'), normalizeSetting('tokenSummaryBackgroundColor', settings.tokenSummaryBackgroundColor));
    setOrRemove('--cgfc-token-summary-border-color', enabled('tokenSummaryBorderColor'), normalizeSetting('tokenSummaryBorderColor', settings.tokenSummaryBorderColor));
    document.dispatchEvent(new CustomEvent('cgpt-unified-ui-settings-change'));
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
    if (win.__cgfcAutoScrollLockInstalledV410) return;
    win.__cgfcAutoScrollLockInstalledV410 = true;

    const ElementCtor = win.Element || Element;
    const HTMLElementCtor = win.HTMLElement || HTMLElement;
    const elementProto = ElementCtor.prototype;
    const SEND_GUARD_MS = 2800;
    const POST_GENERATION_GUARD_MS = 900;
    const NAVIGATION_END_GRACE_MS = 520;
    const SEND_BUTTON_SELECTOR = [
      '#composer-submit-button:not([data-testid="stop-button"])',
      'button[data-testid="send-button"]',
      'button[data-testid="composer-send-button"]',
      'button[aria-label*="send" i]',
      'button[aria-label*="发送" i]',
    ].join(',');
    const COMPOSER_EDITOR_SELECTOR = [
      '#prompt-textarea',
      'textarea[name="prompt-textarea"]',
      '.ProseMirror[contenteditable="true"]',
      '[contenteditable="true"][role="textbox"]',
    ].join(',');

    const state = {
      generating: false,
      sendGuardUntil: 0,
      postGenerationUntil: 0,
      lastUserScrollAt: 0,
      windowY: 0,
      elements: new WeakMap(),
      settleTimer: 0,
      restoring: false,
      navigationActive: false,
    };

    function isUnifiedNavigationActive() {
      return document.documentElement?.hasAttribute('data-cgpt-unified-navigation-active') === true;
    }

    function isLockEnabled() {
      return Boolean(settings.stopAutoScrollWhileGenerating);
    }

    function isSendGuardActive() {
      return Date.now() < state.sendGuardUntil;
    }

    function isPostGenerationGuardActive() {
      return Date.now() < state.postGenerationUntil;
    }

    function isAutoScrollLockActive() {
      return state.generating || isSendGuardActive() || isPostGenerationGuardActive();
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

    function isComposerEditor(target) {
      return Boolean(target?.closest?.(COMPOSER_EDITOR_SELECTOR));
    }

    function isSendButton(target) {
      const button = target?.closest?.(SEND_BUTTON_SELECTOR);
      if (!(button instanceof HTMLElementCtor)) return false;
      if (button.hasAttribute('disabled') || button.getAttribute('aria-disabled') === 'true') return false;

      // Avoid accidentally treating unrelated “Send feedback” buttons elsewhere
      // on the page as a chat submission.
      const form = button.closest('form');
      if (form?.querySelector?.(COMPOSER_EDITOR_SELECTOR)) return true;
      const composerShell = button.closest('[data-testid*="composer"], [class*="composer"]');
      return Boolean(composerShell?.querySelector?.(COMPOSER_EDITOR_SELECTOR));
    }

    function armSendGuard() {
      if (!isLockEnabled()) return;

      // Capture BEFORE ChatGPT handles the submit. This closes the small gap where
      // the UI scrolls to the newly appended turn before the stop/generating button
      // appears and the old generation detector notices it.
      snapshotPositions();
      state.sendGuardUntil = Math.max(state.sendGuardUntil, Date.now() + SEND_GUARD_MS);
      state.postGenerationUntil = 0;
    }

    function isSubmitKey(event) {
      if (event.key !== 'Enter' || event.isComposing) return false;
      if (event.shiftKey || event.altKey) return false;
      return isComposerEditor(event.target) || isComposerEditor(document.activeElement);
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

    function shouldProtectViewport() {
      return isLockEnabled()
        && isAutoScrollLockActive()
        && !isUserScrollWindowOpen()
        && !isUnifiedNavigationActive();
    }

    function shouldBlockWindowTop(nextTop) {
      if (!shouldProtectViewport()) return false;
      return typeof nextTop === 'number' && nextTop > state.windowY + SCROLL_EPSILON_PX;
    }

    function shouldBlockElementTop(el, nextTop) {
      if (!shouldProtectViewport()) return false;
      const lockedTop = state.elements.get(el);
      const baseline = typeof lockedTop === 'number' ? lockedTop : el.scrollTop || 0;
      return typeof nextTop === 'number' && nextTop > baseline + SCROLL_EPSILON_PX;
    }

    function handleScroll(event) {
      if (!shouldProtectViewport() || state.restoring) return;

      const target = event.target;
      const isWindowScroll = target === document || target === document.documentElement || target === document.body;
      const currentTop = isWindowScroll ? win.scrollY || document.documentElement.scrollTop || 0 : target?.scrollTop;

      if (typeof currentTop !== 'number') return;
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

    function syncNavigationState() {
      const active = isUnifiedNavigationActive();
      if (active === state.navigationActive) return;
      state.navigationActive = active;

      if (active) {
        // Navigation has explicit priority. Do not fight a TOC jump with the
        // pre-send/generation baseline.
        return;
      }

      // Once the lease ends, adopt the destination as the new baseline. If a
      // response is still streaming, subsequent ChatGPT auto-follow attempts are
      // blocked relative to the place the user intentionally navigated to.
      snapshotPositions();
      state.lastUserScrollAt = Date.now() - USER_SCROLL_GRACE_MS + NAVIGATION_END_GRACE_MS;
    }

    function refreshGenerationState() {
      const nextGenerating = isGenerating();
      const wasGenerating = state.generating;

      if (nextGenerating && !wasGenerating) {
        // If submit guard is already armed, its pre-submit snapshot is the one we
        // want. Re-snapshotting here would capture ChatGPT's unwanted jump.
        if (!isSendGuardActive() && !isPostGenerationGuardActive() && !isUnifiedNavigationActive()) {
          snapshotPositions();
        }
        state.postGenerationUntil = 0;
      }

      state.generating = nextGenerating;

      if (!nextGenerating && wasGenerating) {
        // Keep a short tail guard because ChatGPT and the performance module can
        // perform final layout/scroll work just after the stop button disappears.
        state.postGenerationUntil = Date.now() + POST_GENERATION_GUARD_MS;
      }
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
        if (!shouldProtectViewport()) return original.call(this, options);

        const rect = this.getBoundingClientRect();
        if (rect.top >= 0 && rect.bottom <= win.innerHeight) {
          return original.call(this, options);
        }
      });
    }

    // Share the same generation detector and pre-submit scroll guard with the
    // message queue. Programmatic button.click() does not emit pointerdown, so the
    // queue explicitly arms this guard before requesting submission.
    const coordinatorRuntime = globalThis.__cgptUnifiedRuntimeV1;
    if (coordinatorRuntime) {
      coordinatorRuntime.isGenerating = isGenerating;
      coordinatorRuntime.armSendGuard = armSendGuard;
    }

    // Arm before ChatGPT's own handlers run. `submit` is the semantic path;
    // pointerdown and Enter are early fallbacks for React/composer variants that
    // mutate the conversation before a native submit event is observable.
    document.addEventListener('submit', (event) => {
      const form = event.target;
      if (form instanceof ElementCtor && form.querySelector?.(COMPOSER_EDITOR_SELECTOR)) armSendGuard();
    }, true);

    document.addEventListener('pointerdown', (event) => {
      if (isSendButton(event.target)) armSendGuard();
    }, true);

    document.addEventListener('keydown', (event) => {
      if (isSubmitKey(event)) armSendGuard();
    }, true);

    ['wheel', 'touchstart', 'touchmove', 'keydown'].forEach((eventName) => {
      win.addEventListener(eventName, markUserScroll, { capture: true, passive: true });
    });
    win.addEventListener('pointerdown', markScrollbarDrag, { capture: true, passive: true });
    document.addEventListener('scroll', handleScroll, { capture: true, passive: true });

    wrapScrollApis();
    refreshAutoScrollLockState = () => {
      syncNavigationState();
      refreshGenerationState();
    };

    let generationRefreshTimer = 0;
    const queueStateRefresh = () => {
      win.clearTimeout(generationRefreshTimer);
      generationRefreshTimer = win.setTimeout(() => {
        syncNavigationState();
        refreshGenerationState();
      }, 36);
    };
    const observer = new MutationObserver(queueStateRefresh);
    const start = () => {
      syncNavigationState();
      refreshGenerationState();
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: [
          'aria-label',
          'data-testid',
          'disabled',
          'data-cgpt-unified-navigation-active',
        ],
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

  function syncOverrideVisual(control, key) {
    if (!(control instanceof HTMLElement) || !OVERRIDEABLE_SETTING_KEYS.has(key)) return;
    const enabledKey = overrideEnabledKey(key);
    const isEnabled = Boolean(settings[enabledKey]);
    control.toggleAttribute('data-override-disabled', !isEnabled);
    const button = control.querySelector('.cgfc-override-switch');
    if (!(button instanceof HTMLButtonElement)) return;
    button.setAttribute('aria-pressed', String(isEnabled));
    button.title = isEnabled ? '脚本正在覆盖此项，点击改为跟随系统' : '当前跟随 ChatGPT / 浏览器 / 设备，点击启用脚本覆盖';
    const label = control.querySelector('.cgfc-control-caption')?.textContent || key;
    button.setAttribute('aria-label', `${label}：${isEnabled ? '脚本覆盖' : '跟随系统'}`);
  }

  function appendControl(parent, options) {
    if (options.type === 'checkbox') {
      const label = document.createElement('label');
      label.className = 'cgfc-check';
      const caption = document.createElement('span');
      caption.textContent = options.label;
      const input = document.createElement('input');
      input.dataset.key = options.key;
      input.type = 'checkbox';
      input.checked = Boolean(settings[options.key]);
      input.addEventListener('change', () => updateSetting(options.key, input.checked));
      label.append(input, caption);
      parent.appendChild(label);
      return input;
    }

    const control = document.createElement('div');
    control.className = 'cgfc-control';
    const head = document.createElement('div');
    head.className = 'cgfc-control-head';
    const caption = document.createElement('span');
    caption.className = 'cgfc-control-caption';
    caption.textContent = options.label;
    head.appendChild(caption);

    if (OVERRIDEABLE_SETTING_KEYS.has(options.key)) {
      control.dataset.overrideKey = options.key;
      const switchButton = document.createElement('button');
      switchButton.type = 'button';
      switchButton.className = 'cgfc-override-switch';
      switchButton.dataset.overrideKey = options.key;
      switchButton.setAttribute('role', 'switch');
      const knob = document.createElement('span');
      knob.className = 'cgfc-override-switch-knob';
      switchButton.appendChild(knob);
      switchButton.addEventListener('click', (event) => {
        event.preventDefault();
        const enabledKey = overrideEnabledKey(options.key);
        updateSetting(enabledKey, !Boolean(settings[enabledKey]));
        syncOverrideVisual(control, options.key);
      });
      head.appendChild(switchButton);
    }

    const input = ['select', 'font-select'].includes(options.type) ? document.createElement('select') : document.createElement('input');
    input.dataset.key = options.key;
    input.setAttribute('aria-label', options.label);

    if (options.type === 'select') {
      options.choices.forEach((choice) => {
        const option = document.createElement('option');
        option.value = choice.value;
        option.textContent = choice.label;
        input.appendChild(option);
      });
      input.value = settings[options.key];
      input.addEventListener('change', () => updateSetting(options.key, input.value));
    } else if (options.type === 'font-select') {
      input.dataset.fontPicker = 'true';
      populateFontSelect(input);
      input.addEventListener('change', () => updateSetting(options.key, input.value));
    } else {
      input.type = options.type;
      input.value = settings[options.key];
      if (options.min !== undefined) input.min = options.min;
      if (options.max !== undefined) input.max = options.max;
      if (options.step !== undefined) input.step = options.step;
      input.addEventListener('input', () => updateSetting(options.key, input.value));
    }

    control.append(head, input);
    parent.appendChild(control);
    if (OVERRIDEABLE_SETTING_KEYS.has(options.key)) syncOverrideVisual(control, options.key);
    return input;
  }

  function createRow(parent) {
    const row = document.createElement('div');
    row.className = 'cgfc-row';
    parent.appendChild(row);
    return row;
  }

  function createSettingsGroup(parent, title, open = false) {
    const group = document.createElement('details');
    group.className = 'cgfc-settings-group';
    group.open = open;
    const summary = document.createElement('summary');
    summary.textContent = title;
    group.appendChild(summary);
    parent.appendChild(group);
    return group;
  }

  function syncPanelInputs(panel) {
    panel.querySelectorAll('input[data-key], select[data-key]').forEach((input) => {
      const key = input.dataset.key;
      if (!key) return;
      if (input.type === 'checkbox') input.checked = Boolean(settings[key]);
      else input.value = settings[key];
    });
    panel.querySelectorAll('.cgfc-control[data-override-key]').forEach((control) => {
      syncOverrideVisual(control, control.dataset.overrideKey);
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

    const overrideHint = document.createElement('p');
    overrideHint.className = 'cgfc-hint cgfc-override-hint';
    overrideHint.textContent = '每项右侧开关只控制脚本是否覆盖该项；关闭后跟随 ChatGPT、浏览器与当前设备的原生样式。关闭不会丢失你已经选好的值。';
    panel.appendChild(overrideHint);

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

    appendControl(panel, { label: '双击公式复制 LaTeX', key: 'enableFormulaCopy', type: 'checkbox' });
    appendControl(panel, { label: '复制公式时保留 $ / $$ 定界符', key: 'formulaCopyDelimiters', type: 'checkbox' });
    appendControl(panel, { label: '公式复制边框颜色', key: 'formulaCopyBorderColor', type: 'color' });
    const formulaCopyHint = document.createElement('p');
    formulaCopyHint.className = 'cgfc-hint';
    formulaCopyHint.textContent = '参考 Ophel Atlas：优先读取 KaTeX 内置的 application/x-tex 原始源码；行内公式复制为 $...$，块公式复制为 $$...$$。';
    panel.appendChild(formulaCopyHint);

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

    const toolboxGroup = createSettingsGroup(panel, '导航 / 提示词浮窗外观');
    appendControl(toolboxGroup, { label: '浮窗字体', key: 'toolboxFont', type: 'font-select' });
    row = createRow(toolboxGroup);
    appendControl(row, { label: '字号 px', key: 'toolboxFontSize', type: 'number', min: 9, max: 24, step: 1 });
    appendControl(row, { label: '行高', key: 'toolboxLineHeight', type: 'number', min: 1, max: 2.2, step: 0.05 });
    appendControl(toolboxGroup, { label: '面板宽度 px', key: 'toolboxPanelWidth', type: 'number', min: 220, max: 560, step: 10 });
    row = createRow(toolboxGroup);
    appendControl(row, { label: '文字颜色', key: 'toolboxTextColor', type: 'color' });
    appendControl(row, { label: '背景颜色', key: 'toolboxBackgroundColor', type: 'color' });
    row = createRow(toolboxGroup);
    appendControl(row, { label: '强调颜色', key: 'toolboxAccentColor', type: 'color' });
    appendControl(row, { label: '背景透明度', key: 'toolboxOpacity', type: 'number', min: 0.2, max: 1, step: 0.05 });
    const toolboxHint = document.createElement('p');
    toolboxHint.className = 'cgfc-hint';
    toolboxHint.textContent = '每个外观项均可独立启停；颜色项关闭后继续跟随 ChatGPT 明暗主题。面板宽度不会覆盖你手动拖拽保存的浮窗尺寸。';
    toolboxGroup.appendChild(toolboxHint);

    const queueGroup = createSettingsGroup(panel, '输入框旁发送队列外观');
    appendControl(queueGroup, { label: '队列字体', key: 'queueFont', type: 'font-select' });
    row = createRow(queueGroup);
    appendControl(row, { label: '字号 px', key: 'queueFontSize', type: 'number', min: 9, max: 24, step: 1 });
    appendControl(row, { label: '行高', key: 'queueLineHeight', type: 'number', min: 1, max: 2.2, step: 0.05 });
    appendControl(queueGroup, { label: '面板宽度 px', key: 'queuePanelWidth', type: 'number', min: 280, max: 720, step: 10 });
    row = createRow(queueGroup);
    appendControl(row, { label: '文字颜色', key: 'queueTextColor', type: 'color' });
    appendControl(row, { label: '背景颜色', key: 'queueBackgroundColor', type: 'color' });
    row = createRow(queueGroup);
    appendControl(row, { label: '强调颜色', key: 'queueAccentColor', type: 'color' });
    appendControl(row, { label: '背景透明度', key: 'queueOpacity', type: 'number', min: 0.2, max: 1, step: 0.05 });
    const queueHint = document.createElement('p');
    queueHint.className = 'cgfc-hint';
    queueHint.textContent = '每个外观项均可独立启停；关闭颜色项后继续跟随 ChatGPT 明暗主题。队列面板会自动限制在当前可视区域内，手机软键盘弹出后也会重新定位。';
    queueGroup.appendChild(queueHint);

    const statsGroup = createSettingsGroup(panel, 'Token 统计（估算）');
    appendControl(statsGroup, { label: '启用 Token 统计', key: 'showTokenStats', type: 'checkbox' });
    appendControl(statsGroup, { label: '显示逐消息 Token 标签', key: 'showTokenMessageChips', type: 'checkbox' });
    appendControl(statsGroup, { label: '显示本轮总览贴片', key: 'showTokenSummary', type: 'checkbox' });
    appendControl(statsGroup, {
      label: '总览贴片位置',
      key: 'tokenSummaryPosition',
      type: 'select',
      choices: [
        { value: 'auto', label: '自动避让' },
        { value: 'composer-top-center', label: '输入框上方 · 居中' },
        { value: 'composer-top-left', label: '输入框上方 · 左侧' },
        { value: 'composer-top-right', label: '输入框上方 · 右侧' },
        { value: 'viewport-bottom-left', label: '视口左下角' },
        { value: 'viewport-bottom-right', label: '视口右下角' },
      ],
    });
    row = createRow(statsGroup);
    appendControl(row, { label: '水平偏移 px', key: 'tokenSummaryOffsetX', type: 'number', min: -600, max: 600, step: 1 });
    appendControl(row, { label: '垂直偏移 px', key: 'tokenSummaryOffsetY', type: 'number', min: -600, max: 600, step: 1 });
    appendControl(statsGroup, { label: '始终使用紧凑格式（6/235/2.4k）', key: 'tokenSummaryCompactAlways', type: 'checkbox' });
    appendControl(statsGroup, { label: '窄屏自动使用紧凑格式', key: 'tokenSummaryCompactOnNarrow', type: 'checkbox' });
    appendControl(statsGroup, { label: '自动避让发送队列', key: 'tokenSummaryAvoidQueue', type: 'checkbox' });
    row = createRow(statsGroup);
    appendControl(row, { label: '总览文字颜色', key: 'tokenSummaryTextColor', type: 'color' });
    appendControl(row, { label: '总览背景颜色', key: 'tokenSummaryBackgroundColor', type: 'color' });
    appendControl(statsGroup, { label: '总览边框颜色', key: 'tokenSummaryBorderColor', type: 'color' });
    const tokenStatsHint = document.createElement('p');
    tokenStatsHint.className = 'cgfc-hint';
    tokenStatsHint.textContent = '统计当前活动分支中可见的用户/助手文本。总览依次表示本轮输入、输出和可见上下文；开启“始终紧凑”后宽屏也显示为“输入/输出/上下文”。三个颜色项关闭脚本覆盖时继续跟随 ChatGPT 明暗主题。系统指令、记忆、工具定义、隐藏推理等不可见内容不会计入，因此它只是近似值，不是官方 usage。';
    statsGroup.appendChild(tokenStatsHint);

    appendControl(panel, { label: '防止自动滚动', key: 'stopAutoScrollWhileGenerating', type: 'checkbox' });
    appendControl(panel, { label: '代码自动换行', key: 'wrapCode', type: 'checkbox' });

    const actions = document.createElement('div');
    actions.className = 'cgfc-actions';

    const followSystemButton = document.createElement('button');
    followSystemButton.type = 'button';
    followSystemButton.textContent = '全部跟随系统';
    followSystemButton.addEventListener('click', () => {
      const next = { ...settings };
      OVERRIDEABLE_SETTING_KEYS.forEach((key) => { next[overrideEnabledKey(key)] = false; });
      next.toolboxUseCustomColors = false;
      next.queueUseCustomColors = false;
      settings = next;
      writeStore(STORAGE_KEY, settings);
      applySettings();
      syncPanelInputs(panel);
    });

    const resetButton = document.createElement('button');
    resetButton.type = 'button';
    resetButton.textContent = '恢复脚本预设';
    resetButton.addEventListener('click', () => {
      settings = { ...defaults };
      writeStore(STORAGE_KEY, settings);
      applySettings();
      detectKnownLocalFonts();
      refreshFontSelects();
      syncPanelInputs(panel);
    });

    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.textContent = '关闭';

    actions.append(followSystemButton, resetButton, closeButton);
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
      holder.dataset.cgfcLatex = token.content;
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

  function unwrapFormulaDelimiters(value) {
    const text = String(value || '').trim();
    if (!text) return '';
    const pairs = [['$$', '$$'], ['\\(', '\\)'], ['\\[', '\\]'], ['$', '$']];
    for (const [open, close] of pairs) {
      if (text.startsWith(open) && text.endsWith(close) && text.length > open.length + close.length) {
        return text.slice(open.length, text.length - close.length).trim();
      }
    }
    return text;
  }

  function extractFormulaCopyPayload(target) {
    const element = target instanceof Element ? target : target?.parentElement;
    if (!element) return null;
    if (element.closest(`#${PANEL_ID}, #${TOGGLE_ID}, textarea, input, [contenteditable="true"]`)) return null;

    const host = element.closest([
      `.${RESIDUAL_WRAPPER_CLASS}`,
      '.math-block',
      '.math-inline',
      '.katex-display',
      '.katex',
      'math',
      '[data-latex]',
      '[data-math]',
      '[data-math-source]',
      '[data-custom-copy-text]',
      'annotation[encoding="application/x-tex"]',
    ].join(', '));
    if (!host) return null;

    const residual = host.closest(`.${RESIDUAL_WRAPPER_CLASS}`) || element.closest(`.${RESIDUAL_WRAPPER_CLASS}`);
    if (residual?.dataset.cgfcLatex) {
      return {
        latex: unwrapFormulaDelimiters(residual.dataset.cgfcLatex),
        isBlock: residual.dataset.cgfcResidualDisplay === 'true',
      };
    }

    const dataHost = host.closest('[data-latex], [data-math], [data-math-source], [data-custom-copy-text]');
    if (dataHost) {
      const raw = dataHost.getAttribute('data-latex')
        || dataHost.getAttribute('data-math')
        || dataHost.getAttribute('data-math-source')
        || dataHost.getAttribute('data-custom-copy-text')
        || dataHost.getAttribute('copy-text')
        || '';
      const latex = unwrapFormulaDelimiters(raw);
      if (latex) {
        return {
          latex,
          isBlock: dataHost.classList.contains('math-block') || Boolean(dataHost.querySelector('.katex-display')),
        };
      }
    }

    const katexDisplay = host.matches('.katex-display') ? host : host.closest('.katex-display');
    const katex = host.matches('.katex') ? host : host.querySelector?.('.katex') || host.closest('.katex');
    const math = host.matches('math') ? host : host.querySelector?.('math') || katex?.querySelector?.('math') || host.closest('math');
    const annotation = host.matches('annotation[encoding="application/x-tex"]')
      ? host
      : katex?.querySelector?.('annotation[encoding="application/x-tex"]')
        || math?.querySelector?.('annotation[encoding="application/x-tex"]')
        || host.querySelector?.('annotation[encoding="application/x-tex"]');
    const latex = unwrapFormulaDelimiters(annotation?.textContent || '');
    if (!latex) return null;
    return {
      latex,
      isBlock: Boolean(katexDisplay || katex?.closest('.katex-display') || math?.getAttribute?.('display') === 'block'),
    };
  }

  function formatFormulaCopy(payload) {
    const latex = String(payload?.latex || '').replace(/\r\n?/g, '\n').trim();
    if (!latex) return '';
    if (!settings.formulaCopyDelimiters) return latex;
    if (!payload.isBlock) return `$${latex}$`;
    const needsMultiline = latex.includes('\n') || /(^|[^\\])\\\\($|[^\\])/.test(latex);
    return needsMultiline ? `$$\n${latex}\n$$` : `$$${latex}$$`;
  }

  async function writeClipboardText(text) {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {}
    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.setAttribute('readonly', '');
      Object.assign(textarea.style, {
        position: 'fixed',
        left: '-9999px',
        top: '0',
        opacity: '0',
      });
      document.body.appendChild(textarea);
      textarea.select();
      const ok = document.execCommand('copy');
      textarea.remove();
      return ok;
    } catch {
      return false;
    }
  }

  function showFormulaCopyToast(message) {
    const id = 'cgfc-formula-copy-toast';
    document.getElementById(id)?.remove();
    const toast = document.createElement('div');
    toast.id = id;
    toast.textContent = message;
    Object.assign(toast.style, {
      position: 'fixed',
      left: '50%',
      bottom: '28px',
      zIndex: '2147483647',
      transform: 'translateX(-50%)',
      padding: '7px 11px',
      border: '1px solid var(--cgfc-theme-border, rgba(0,0,0,.14))',
      borderRadius: '8px',
      background: 'color-mix(in srgb, var(--cgfc-theme-surface-primary, #fff) 94%, transparent)',
      color: 'var(--cgfc-theme-text-primary, #161616)',
      boxShadow: 'var(--cgfc-theme-shadow-soft, 0 4px 16px rgba(0,0,0,.18))',
      font: '12px/1.35 system-ui, "Microsoft YaHei", sans-serif',
      backdropFilter: 'blur(10px)',
      pointerEvents: 'none',
    });
    document.body?.appendChild(toast);
    setTimeout(() => toast.remove(), 1500);
  }

  function startFormulaCopy() {
    if (formulaCopyInitialized) return;
    formulaCopyInitialized = true;
    document.addEventListener('dblclick', async (event) => {
      if (!settings.enableFormulaCopy) return;
      const payload = extractFormulaCopyPayload(event.target);
      if (!payload?.latex) return;
      event.preventDefault();
      event.stopPropagation();
      const text = formatFormulaCopy(payload);
      const ok = text ? await writeClipboardText(text) : false;
      showFormulaCopyToast(ok ? '已复制公式 LaTeX' : '公式复制失败');
    }, true);
  }

  function onReady(callback) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', callback, { once: true });
    } else {
      callback();
    }
  }

  const STATIC_CSS = `
    html {
      --cgfc-theme-surface-primary: var(--main-surface-primary, var(--bg-primary, #ffffff));
      --cgfc-theme-surface-secondary: var(--main-surface-secondary, var(--bg-secondary, #f4f4f4));
      --cgfc-theme-text-primary: var(--text-primary, #161616);
      --cgfc-theme-text-secondary: var(--text-secondary, #555555);
      --cgfc-theme-text-tertiary: var(--text-tertiary, #777777);
      --cgfc-theme-border: var(--border-light, rgba(0, 0, 0, .14));
      --cgfc-theme-warning: #9a5b00;
      --cgfc-theme-shadow-soft: 0 6px 22px rgba(0, 0, 0, .14);
      --cgfc-theme-shadow-strong: 0 14px 36px rgba(0, 0, 0, .18);
      --cgfc-theme-overlay: rgba(0, 0, 0, .42);
      color-scheme: var(--cgfc-color-scheme, light);
    }

    html[data-cgfc-theme="dark"] {
      --cgfc-theme-surface-primary: var(--main-surface-primary, var(--bg-primary, #212121));
      --cgfc-theme-surface-secondary: var(--main-surface-secondary, var(--bg-secondary, #2f2f2f));
      --cgfc-theme-text-primary: var(--text-primary, #f4f4f4);
      --cgfc-theme-text-secondary: var(--text-secondary, #c7c7c7);
      --cgfc-theme-text-tertiary: var(--text-tertiary, #a3a3a3);
      --cgfc-theme-border: var(--border-light, rgba(255, 255, 255, .14));
      --cgfc-theme-warning: #f4bd72;
      --cgfc-theme-shadow-soft: 0 8px 28px rgba(0, 0, 0, .38);
      --cgfc-theme-shadow-strong: 0 14px 36px rgba(0, 0, 0, .42);
      --cgfc-theme-overlay: rgba(0, 0, 0, .58);
    }

    html[data-cgfc-body-font] body,
    html[data-cgfc-body-font] main [data-message-author-role],
    html[data-cgfc-body-font] main .markdown,
    html[data-cgfc-body-font] main .prose,
    html[data-cgfc-body-font] textarea,
    html[data-cgfc-body-font] [contenteditable="true"] {
      font-family: var(--cgfc-latin-font), var(--cgfc-chinese-font), serif !important;
    }

    html[data-cgfc-font-smoothing-mode] body,
    html[data-cgfc-font-smoothing-mode] main [data-message-author-role],
    html[data-cgfc-font-smoothing-mode] main .markdown,
    html[data-cgfc-font-smoothing-mode] main .prose,
    html[data-cgfc-font-smoothing-mode] textarea,
    html[data-cgfc-font-smoothing-mode] [contenteditable="true"] {
      -webkit-font-smoothing: var(--cgfc-font-smoothing) !important;
      -moz-osx-font-smoothing: var(--cgfc-moz-font-smoothing) !important;
    }

    html[data-cgfc-text-rendering-mode] body,
    html[data-cgfc-text-rendering-mode] main [data-message-author-role],
    html[data-cgfc-text-rendering-mode] main .markdown,
    html[data-cgfc-text-rendering-mode] main .prose,
    html[data-cgfc-text-rendering-mode] textarea,
    html[data-cgfc-text-rendering-mode] [contenteditable="true"] {
      text-rendering: var(--cgfc-text-rendering) !important;
    }

    html[data-cgfc-formula-copy] :is(.katex, .cgfc-residual-latex) {
      cursor: copy;
    }

    html[data-cgfc-formula-copy] :is(.katex, .cgfc-residual-latex):hover {
      border-radius: 4px;
      box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--cgfc-formula-copy-border-color, currentColor) 70%, transparent);
    }

    html[data-cgfc-formula-copy] .cgfc-residual-latex:hover .katex {
      box-shadow: none;
    }

    html[data-cgfc-normal-color] main [data-message-author-role],
    html[data-cgfc-normal-color] main .markdown,
    html[data-cgfc-normal-color] main .prose {
      color: var(--cgfc-normal-color) !important;
    }

    html[data-cgfc-font-size] main [data-message-author-role],
    html[data-cgfc-font-size] main .markdown,
    html[data-cgfc-font-size] main .prose {
      font-size: var(--cgfc-font-size) !important;
    }

    html[data-cgfc-line-height] main [data-message-author-role],
    html[data-cgfc-line-height] main .markdown,
    html[data-cgfc-line-height] main .prose {
      line-height: var(--cgfc-line-height) !important;
    }

    html[data-cgfc-normal-color] main .markdown :is(p, li, td, th, blockquote, details, summary),
    html[data-cgfc-normal-color] main .prose :is(p, li, td, th, blockquote, details, summary) {
      color: inherit !important;
    }

    html[data-cgfc-line-height] main .markdown :is(p, li, td, th, blockquote, details, summary),
    html[data-cgfc-line-height] main .prose :is(p, li, td, th, blockquote, details, summary) {
      line-height: inherit !important;
    }

    html[data-cgfc-line-height] main .markdown :is(h1, h2, h3, h4),
    html[data-cgfc-line-height] main .prose :is(h1, h2, h3, h4) {
      line-height: 1.35 !important;
    }

    html[data-cgfc-code-font] main .markdown :is(pre, code),
    html[data-cgfc-code-font] main .prose :is(pre, code),
    html[data-cgfc-code-font] [data-message-author-role] :is(pre, code) {
      font-family: var(--cgfc-code-font) !important;
    }

    html[data-cgfc-code-font-size] main .markdown :is(pre, code),
    html[data-cgfc-code-font-size] main .prose :is(pre, code),
    html[data-cgfc-code-font-size] [data-message-author-role] :is(pre, code) {
      font-size: var(--cgfc-code-font-size) !important;
    }

    html[data-cgfc-code-line-height] main .markdown :is(pre, code),
    html[data-cgfc-code-line-height] main .prose :is(pre, code),
    html[data-cgfc-code-line-height] [data-message-author-role] :is(pre, code) {
      line-height: var(--cgfc-code-line-height) !important;
    }

    html[data-cgfc-wrap-code] main .markdown pre,
    html[data-cgfc-wrap-code] main .prose pre,
    html[data-cgfc-wrap-code] [data-message-author-role] pre {
      white-space: pre-wrap !important;
      overflow-wrap: anywhere !important;
    }

    html[data-cgfc-bold-font] main .markdown :is(strong, b),
    html[data-cgfc-bold-font] main .prose :is(strong, b),
    html[data-cgfc-bold-font] [data-message-author-role] :is(strong, b) {
      font-family: var(--cgfc-bold-latin-font), var(--cgfc-bold-chinese-font), serif !important;
    }

    html[data-cgfc-bold-color] main .markdown :is(strong, b),
    html[data-cgfc-bold-color] main .prose :is(strong, b),
    html[data-cgfc-bold-color] [data-message-author-role] :is(strong, b) {
      color: var(--cgfc-bold-color) !important;
    }

    html[data-cgfc-bold-weight] main .markdown :is(strong, b),
    html[data-cgfc-bold-weight] main .prose :is(strong, b),
    html[data-cgfc-bold-weight] [data-message-author-role] :is(strong, b) {
      font-weight: var(--cgfc-bold-weight) !important;
    }

    /*
      Renderer-safe boundary:
      - Native MathML may use an installed OpenType math font.
      - KaTeX and MathJax retain their own webfonts and metrics. In particular,
        KaTeX negated relations can use private-use overlay glyphs that disappear
        when a system font is forced onto internal relation spans.
    */
    html[data-cgfc-math-font][data-cgfc-math-mode="native"] math,
    html[data-cgfc-math-font][data-cgfc-math-mode="native"] math * {
      font-family: var(--cgfc-math-font) !important;
    }

    /* KaTeX renders visible HTML rather than native MathML. This opt-in bridge
       only changes ordinary letter atoms; relations, operators, radicals,
       delimiters, size glyphs, and layout metrics keep KaTeX's own fonts. */
    html[data-cgfc-katex-letter-font][data-cgfc-math-font] .katex :is(
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
      border: 1px solid var(--cgfc-theme-border, rgba(0, 0, 0, .14));
      border-radius: 8px;
      background: color-mix(in srgb, var(--cgfc-theme-surface-primary, #fff) 90%, transparent);
      color: var(--cgfc-theme-text-primary, #161616);
      font: 700 16px/1 system-ui, "Microsoft YaHei", sans-serif;
      cursor: pointer;
      box-shadow: var(--cgfc-theme-shadow-soft, 0 8px 24px rgba(0, 0, 0, .18));
      -webkit-backdrop-filter: blur(12px) saturate(118%);
      backdrop-filter: blur(12px) saturate(118%);
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
      border: 1px solid var(--cgfc-theme-border, rgba(0, 0, 0, .14));
      border-radius: 8px;
      background: color-mix(in srgb, var(--cgfc-theme-surface-primary, #fff) 96%, transparent);
      color: var(--cgfc-theme-text-primary, #161616);
      box-shadow: var(--cgfc-theme-shadow-strong, 0 14px 36px rgba(0, 0, 0, .18));
      font-family: system-ui, "Microsoft YaHei", sans-serif !important;
      font-size: 13px !important;
      line-height: 1.35 !important;
      overflow-y: auto;
      overscroll-behavior: contain;
      color-scheme: var(--cgfc-color-scheme, light);
      -webkit-backdrop-filter: blur(14px) saturate(118%);
      backdrop-filter: blur(14px) saturate(118%);
    }

    #${PANEL_ID}[hidden] {
      display: none !important;
    }

    #${PANEL_ID} h2 {
      margin: 0 0 10px;
      color: var(--cgfc-theme-text-primary, #161616);
      font-size: 14px;
      line-height: 1.3;
    }

    #${PANEL_ID} .cgfc-hint {
      margin: -2px 0 8px;
      color: var(--cgfc-theme-text-tertiary, #777);
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
      color: var(--cgfc-theme-warning, #9a5b00);
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
      border: 1px solid var(--cgfc-theme-border, rgba(0, 0, 0, .14));
      border-radius: 6px;
      padding: 7px 8px;
      background: var(--cgfc-theme-surface-secondary, #f4f4f4);
      color: var(--cgfc-theme-text-primary, #161616);
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
      background: var(--cgfc-theme-surface-primary, #fff);
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

    #${PANEL_ID} .cgfc-settings-group {
      margin: 12px 0;
      padding: 0 10px 8px;
      border: 1px solid var(--cgfc-theme-border, rgba(0, 0, 0, .14));
      border-radius: 8px;
      background: color-mix(in srgb, var(--cgfc-theme-text-primary, #161616) 3.5%, transparent);
    }

    #${PANEL_ID} .cgfc-settings-group > summary {
      margin: 0 -10px;
      padding: 10px;
      color: var(--cgfc-theme-text-primary, #161616);
      cursor: pointer;
      font-weight: 700;
      user-select: none;
    }

    #${PANEL_ID} .cgfc-settings-group[open] > summary {
      margin-bottom: 4px;
      border-bottom: 1px solid var(--cgfc-theme-border, rgba(0, 0, 0, .12));
    }

    #${PANEL_ID} .cgfc-actions {
      position: sticky;
      bottom: -14px;
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin: 12px -14px -14px;
      padding: 10px 14px 14px;
      border-top: 1px solid var(--cgfc-theme-border, rgba(0, 0, 0, .12));
      background: color-mix(in srgb, var(--cgfc-theme-surface-primary, #fff) 98%, transparent);
    }

    #${PANEL_ID} button {
      flex: 1;
      border: 1px solid var(--cgfc-theme-border, rgba(0, 0, 0, .14));
      border-radius: 6px;
      padding: 8px;
      background: var(--cgfc-theme-surface-secondary, #f4f4f4);
      color: var(--cgfc-theme-text-primary, #161616);
      cursor: pointer;
      font: 13px/1 system-ui, "Microsoft YaHei", sans-serif;
    }

    #${PANEL_ID} button:hover,
    #${TOGGLE_ID}:hover {
      background: color-mix(in srgb, var(--cgfc-theme-text-primary, #161616) 10%, var(--cgfc-theme-surface-secondary, #f4f4f4));
    }


    #${PANEL_ID} .cgfc-control {
      display: grid;
      gap: 6px;
      margin: 9px 0;
    }

    #${PANEL_ID} .cgfc-control-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      min-height: 22px;
    }

    #${PANEL_ID} .cgfc-control-caption {
      min-width: 0;
      color: var(--cgfc-theme-text-primary, #161616);
    }

    #${PANEL_ID} .cgfc-control[data-override-disabled] > input,
    #${PANEL_ID} .cgfc-control[data-override-disabled] > select {
      opacity: .5;
      filter: saturate(.7);
    }

    #${PANEL_ID} button.cgfc-override-switch {
      position: relative;
      flex: 0 0 auto !important;
      width: 38px;
      min-width: 38px;
      height: 22px;
      padding: 2px !important;
      border: 1px solid var(--cgfc-theme-border, rgba(0, 0, 0, .14));
      border-radius: 999px;
      background: color-mix(in srgb, var(--cgfc-theme-text-primary, #161616) 12%, transparent);
      box-shadow: inset 0 1px 2px rgba(0, 0, 0, .2);
      transition: background 150ms ease, border-color 150ms ease, box-shadow 150ms ease;
    }

    #${PANEL_ID} button.cgfc-override-switch:hover {
      background: color-mix(in srgb, var(--cgfc-theme-text-primary, #161616) 18%, transparent);
    }

    #${PANEL_ID} button.cgfc-override-switch[aria-pressed="true"] {
      border-color: rgba(16, 163, 127, .9);
      background: #10a37f;
      box-shadow: inset 0 1px 2px rgba(0, 0, 0, .12), 0 0 0 1px rgba(16, 163, 127, .08);
    }

    #${PANEL_ID} .cgfc-override-switch-knob {
      display: block;
      width: 16px;
      height: 16px;
      border-radius: 50%;
      background: #fff;
      box-shadow: 0 1px 4px rgba(0, 0, 0, .35);
      transform: translateX(0);
      transition: transform 150ms ease;
    }

    #${PANEL_ID} button.cgfc-override-switch[aria-pressed="true"] .cgfc-override-switch-knob {
      transform: translateX(16px);
    }

    #${PANEL_ID} button.cgfc-override-switch:focus-visible {
      outline: 2px solid rgba(78, 156, 255, .95);
      outline-offset: 2px;
    }

    #${PANEL_ID} .cgfc-override-hint {
      margin-top: 2px;
      padding: 8px 9px;
      border: 1px solid var(--cgfc-theme-border, rgba(0, 0, 0, .12));
      border-radius: 7px;
      background: color-mix(in srgb, var(--cgfc-theme-text-primary, #161616) 3.5%, transparent);
      color: var(--cgfc-theme-text-secondary, #555);
    }

    @media (max-width: 520px) {
      #${TOGGLE_ID} {
        right: auto;
        left: max(10px, env(safe-area-inset-left));
        bottom: max(94px, calc(env(safe-area-inset-bottom) + 82px));
      }

      #${PANEL_ID} {
        left: max(8px, env(safe-area-inset-left));
        right: max(8px, env(safe-area-inset-right));
        top: max(8px, env(safe-area-inset-top));
        width: auto;
        max-height: calc(100dvh - 76px - env(safe-area-inset-top) - env(safe-area-inset-bottom));
      }

      #${PANEL_ID} .cgfc-row {
        grid-template-columns: 1fr;
        gap: 0;
      }
    }
  `;

  startThemeSync();
  installAutoScrollLock();
  applySettings();
  startResidualLatexObserver();
  startFormulaCopy();
  onReady(() => {
    ensureShell();
    // ChatGPT hydrates its typography after DOMContentLoaded. Re-apply a few
    // times so mixed custom/native font stacks can sample the final native
    // family rather than the early loading shell.
    setTimeout(applySettings, 800);
    setTimeout(applySettings, 2400);

    if (!observersStarted) {
      observersStarted = true;
      startShellGuard();
      startDisclaimerObserver();
    }
  });
})();
