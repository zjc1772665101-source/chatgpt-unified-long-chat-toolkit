// ==UserScript==
// @name         ChatGPT Token Stats (Unified Toolkit feature)
// @namespace    local.codex.chatgpt.unified.tokenstats
// @version      0.1.0
// @description  Estimates visible user/assistant token counts per message and per active conversation branch. Designed for integration into ChatGPT 长对话统一工具箱.
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @run-at       document-idle
// @grant        unsafeWindow
// @noframes
// @license      GPL-3.0-or-later
// ==/UserScript==

(function tokenStatsFeature() {
  'use strict';

  const ROOT_ID = 'cgpt-unified-token-stats';
  const CHIP_ATTR = 'data-cgpt-token-chip';
  const REFRESH_MIN_MS = 12000;
  const DOM_DEBOUNCE_MS = 220;
  const apiCache = { conversationId: '', currentNode: '', messages: [], fetchedAt: 0, promise: null };
  const state = { href: location.href, refreshTimer: 0, mutationTimer: 0, lastGenerating: false };

  const normalizeText = (value) => String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  function formatCount(value) {
    const n = Math.max(0, Math.round(Number(value) || 0));
    if (n < 1000) return String(n);
    if (n < 10000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
    return `${Math.round(n / 1000)}k`;
  }

  // Fast, zero-dependency approximation tuned for mixed Chinese/English/code text.
  // It estimates visible text tokens, not OpenAI billing/usage tokens.
  function estimateTokens(input) {
    const text = normalizeText(input);
    if (!text) return 0;

    let score = 0;
    let asciiRun = '';
    const flushAscii = () => {
      if (!asciiRun) return;
      // English/code identifiers are usually ~3.5-4.5 chars/token; short runs
      // and punctuation-heavy identifiers need a small floor correction.
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

      if (/\s/.test(ch)) {
        score += 0.06;
      } else if (
        (cp >= 0x3400 && cp <= 0x4dbf) ||
        (cp >= 0x4e00 && cp <= 0x9fff) ||
        (cp >= 0xf900 && cp <= 0xfaff)
      ) {
        // Modern OpenAI tokenizers compress common Chinese better than 1 char/token.
        score += 0.72;
      } else if (
        (cp >= 0x3040 && cp <= 0x30ff) ||
        (cp >= 0xac00 && cp <= 0xd7af)
      ) {
        score += 0.78;
      } else if (cp <= 0x7f) {
        // ASCII punctuation/operators/code syntax.
        score += /[.,;:!?()[\]{}'"`~@#$%^&*+=<>/\\|-]/.test(ch) ? 0.55 : 0.35;
      } else if (cp >= 0x1f000) {
        // Emoji are frequently split into 1-3 tokens.
        score += 1.65;
      } else {
        // Other Unicode scripts/symbols.
        score += 0.95;
      }
    }
    flushAscii();
    return Math.max(1, Math.round(score));
  }

  function getConversationId() {
    return location.pathname.match(/\/c\/([0-9a-f-]{20,})/i)?.[1] || '';
  }

  function getPageFetch() {
    try {
      if (typeof unsafeWindow !== 'undefined' && typeof unsafeWindow.fetch === 'function') {
        return unsafeWindow.fetch.bind(unsafeWindow);
      }
    } catch {}
    return window.fetch.bind(window);
  }

  function extractApiPart(part) {
    if (typeof part === 'string') return part;
    if (!part || typeof part !== 'object') return '';
    const kind = String(part.content_type || part.type || '').toLowerCase();
    if (/image|audio|video|asset_pointer|file/.test(kind) || part.asset_pointer) return '';
    if (typeof part.text === 'string') return part.text;
    if (typeof part.content === 'string') return part.content;
    if (typeof part.caption === 'string') return part.caption;
    if (Array.isArray(part.parts)) return part.parts.map(extractApiPart).filter(Boolean).join('\n');
    return '';
  }

  function extractApiContent(message) {
    const content = message?.content || {};
    const type = String(content.content_type || '').toLowerCase();
    if (new Set(['thoughts', 'reasoning', 'reasoning_recap', 'model_editable_context', 'user_editable_context', 'system_content']).has(type)) {
      return '';
    }
    let body = '';
    if (Array.isArray(content.parts)) body = content.parts.map(extractApiPart).filter(Boolean).join('\n\n');
    else if (typeof content.text === 'string') body = content.text;
    else if (typeof content.result === 'string') body = content.result;
    return normalizeText(body);
  }

  function isApiMessageVisible(message) {
    if (!message || typeof message !== 'object') return false;
    const role = message.author?.role;
    if (role !== 'user' && role !== 'assistant') return false;
    const metadata = message.metadata || {};
    if (
      metadata.is_visually_hidden_from_conversation === true ||
      metadata.is_hidden === true ||
      metadata.hidden === true ||
      String(metadata.channel || '').toLowerCase() === 'analysis'
    ) return false;
    const recipient = String(message.recipient || 'all');
    return !(role === 'assistant' && recipient && !['all', 'assistant'].includes(recipient));
  }

  function linearizeActiveBranch(tree) {
    const mapping = tree?.mapping;
    let currentId = tree?.current_node;
    if (!mapping || typeof mapping !== 'object' || !currentId || !mapping[currentId]) return [];
    const chain = [];
    const seen = new Set();
    while (currentId && mapping[currentId] && !seen.has(currentId)) {
      seen.add(currentId);
      chain.push(mapping[currentId]);
      currentId = mapping[currentId]?.parent || '';
    }
    return chain.reverse();
  }

  function messagesFromTree(tree) {
    const messages = [];
    for (const node of linearizeActiveBranch(tree)) {
      const message = node?.message;
      if (!isApiMessageVisible(message)) continue;
      const content = extractApiContent(message);
      if (!content) continue;
      const role = message.author.role;
      const id = String(message.id || node.id || `api-${messages.length}`);
      const previous = messages[messages.length - 1];
      if (role === 'assistant' && previous?.role === 'assistant') {
        previous.content = normalizeText(`${previous.content}\n\n${content}`);
        previous.tokens = estimateTokens(previous.content);
        previous.sourceIds.push(id);
        continue;
      }
      messages.push({ id, sourceIds: [id], role, content, tokens: estimateTokens(content) });
    }
    return messages;
  }

  async function fetchConversationMessages({ force = false } = {}) {
    const conversationId = getConversationId();
    if (!conversationId) return [];
    if (!force && apiCache.conversationId === conversationId && apiCache.messages.length && Date.now() - apiCache.fetchedAt < REFRESH_MIN_MS) {
      return apiCache.messages;
    }
    if (apiCache.conversationId === conversationId && apiCache.promise) return apiCache.promise;

    const request = (async () => {
      try {
        const pageFetch = getPageFetch();
        const sessionResponse = await pageFetch('/api/auth/session', {
          credentials: 'include', cache: 'no-store', headers: { Accept: 'application/json' },
        });
        if (!sessionResponse.ok) throw new Error(`session HTTP ${sessionResponse.status}`);
        const authSession = await sessionResponse.json();
        if (!authSession?.accessToken) throw new Error('missing accessToken');
        const response = await pageFetch(`/backend-api/conversation/${encodeURIComponent(conversationId)}`, {
          method: 'GET', credentials: 'include', cache: 'no-store',
          headers: { Accept: 'application/json', Authorization: `Bearer ${authSession.accessToken}` },
        });
        if (!response.ok) throw new Error(`conversation HTTP ${response.status}`);
        const tree = await response.json();
        const messages = messagesFromTree(tree);
        apiCache.conversationId = conversationId;
        apiCache.currentNode = String(tree?.current_node || '');
        apiCache.messages = messages;
        apiCache.fetchedAt = Date.now();
        return messages;
      } catch (error) {
        console.debug('[Token Stats] API unavailable, falling back to DOM:', error);
        return collectDomMessages();
      } finally {
        apiCache.promise = null;
      }
    })();
    apiCache.conversationId = conversationId;
    apiCache.promise = request;
    return request;
  }

  function getRoleNodes() {
    const candidates = Array.from(document.querySelectorAll('main [data-message-author-role]'));
    return candidates.filter((node) => {
      const role = node.getAttribute('data-message-author-role');
      return (role === 'user' || role === 'assistant') && !node.parentElement?.closest('[data-message-author-role]');
    });
  }

  function extractDomContent(roleNode) {
    const source = roleNode.querySelector('.markdown, [data-message-content], .whitespace-pre-wrap') || roleNode;
    const clone = source.cloneNode(true);
    clone.querySelectorAll?.(`[${CHIP_ATTR}]`).forEach((node) => node.remove());
    return normalizeText(clone.innerText || clone.textContent || '');
  }

  function collectDomMessages() {
    return getRoleNodes().map((node, index) => {
      const role = node.getAttribute('data-message-author-role');
      const id = node.getAttribute('data-message-id') || node.closest('[data-message-id]')?.getAttribute('data-message-id') || `dom-${index}`;
      const content = extractDomContent(node);
      return { id, sourceIds: [id], role, content, tokens: estimateTokens(content) };
    }).filter((message) => message.content);
  }

  function latestRound(messages) {
    let userIndex = -1;
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i].role === 'user') { userIndex = i; break; }
    }
    if (userIndex < 0) return { input: 0, output: 0 };
    const input = messages[userIndex].tokens || 0;
    let output = 0;
    for (let i = userIndex + 1; i < messages.length; i += 1) {
      if (messages[i].role === 'user') break;
      if (messages[i].role === 'assistant') output += messages[i].tokens || 0;
    }
    return { input, output };
  }

  function totalVisible(messages) {
    return messages.reduce((sum, message) => sum + (message.tokens || 0), 0);
  }

  function ensureStyles() {
    if (document.getElementById(`${ROOT_ID}-style`)) return;
    const style = document.createElement('style');
    style.id = `${ROOT_ID}-style`;
    style.textContent = `
      #${ROOT_ID} {
        position: fixed;
        right: max(14px, env(safe-area-inset-right));
        bottom: max(78px, calc(env(safe-area-inset-bottom) + 78px));
        z-index: 2147483000;
        font: 12px/1.35 ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        color: var(--text-primary, CanvasText);
      }
      #${ROOT_ID} .cgpt-token-pill {
        display: flex; align-items: center; gap: 7px;
        padding: 7px 10px; border-radius: 999px;
        border: 1px solid color-mix(in srgb, currentColor 16%, transparent);
        background: color-mix(in srgb, Canvas 92%, transparent);
        box-shadow: 0 4px 16px rgba(0,0,0,.10);
        backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
        cursor: default; user-select: none; white-space: nowrap;
      }
      #${ROOT_ID} .cgpt-token-muted { opacity: .58; }
      #${ROOT_ID} .cgpt-token-sep { opacity: .22; }
      [${CHIP_ATTR}] {
        display: inline-flex; align-items: center;
        margin-inline-start: 6px; padding: 1px 5px; border-radius: 999px;
        font: 10px/1.35 ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        opacity: .52; border: 1px solid color-mix(in srgb, currentColor 13%, transparent);
        vertical-align: middle; white-space: nowrap; user-select: none;
      }
      @media (max-width: 640px) {
        #${ROOT_ID} { right: 8px; bottom: max(70px, calc(env(safe-area-inset-bottom) + 70px)); font-size: 11px; }
        #${ROOT_ID} .cgpt-token-pill { gap: 5px; padding: 6px 8px; }
      }
    `;
    document.head?.appendChild(style);
  }

  function ensureSummary() {
    ensureStyles();
    let root = document.getElementById(ROOT_ID);
    if (root) return root;
    root = document.createElement('div');
    root.id = ROOT_ID;
    root.innerHTML = '<div class="cgpt-token-pill" title="估算可见文本 token；不包含系统指令、记忆、工具定义等隐藏上下文，因此不是官方 usage。"><span data-slot="input">输入 ≈0</span><span class="cgpt-token-sep">·</span><span data-slot="output">输出 ≈0</span><span class="cgpt-token-sep">·</span><span class="cgpt-token-muted" data-slot="context">可见上下文 ≈0</span></div>';
    document.body?.appendChild(root);
    return root;
  }

  function renderSummary(messages) {
    const root = ensureSummary();
    if (!root) return;
    const round = latestRound(messages);
    root.querySelector('[data-slot="input"]').textContent = `输入 ≈${formatCount(round.input)}`;
    root.querySelector('[data-slot="output"]').textContent = `输出 ≈${formatCount(round.output)}`;
    root.querySelector('[data-slot="context"]').textContent = `可见上下文 ≈${formatCount(totalVisible(messages))}`;
  }

  function renderMessageChips() {
    for (const roleNode of getRoleNodes()) {
      const content = extractDomContent(roleNode);
      if (!content) continue;
      const tokens = estimateTokens(content);
      let chip = roleNode.querySelector(`:scope > [${CHIP_ATTR}]`);
      if (!chip) {
        chip = document.createElement('span');
        chip.setAttribute(CHIP_ATTR, '1');
        chip.title = '估算的可见文本 token，不是官方 usage';
        roleNode.appendChild(chip);
      }
      const nextText = `≈${formatCount(tokens)} tok`;
      if (chip.textContent !== nextText) chip.textContent = nextText;
    }
  }

  function isGenerating() {
    return Boolean(document.querySelector('[data-testid="stop-button"], button[aria-label*="Stop" i], button[aria-label*="停止"]'));
  }

  async function refresh({ forceApi = false } = {}) {
    renderMessageChips();
    const messages = await fetchConversationMessages({ force: forceApi });
    // While streaming, the API tree can lag. Replace/append the current visible tail
    // with DOM data for a smoother live output count; API refresh after generation ends
    // restores the complete active branch total.
    const dom = collectDomMessages();
    const generating = isGenerating();
    if (generating && dom.length) {
      const apiIds = new Set(messages.flatMap((m) => m.sourceIds || [m.id]));
      const merged = [...messages];
      for (const message of dom.slice(-4)) {
        if (!apiIds.has(message.id)) merged.push(message);
        else {
          const idx = merged.findIndex((item) => (item.sourceIds || [item.id]).includes(message.id));
          if (idx >= 0 && message.content.length >= merged[idx].content.length) merged[idx] = message;
        }
      }
      renderSummary(merged);
    } else {
      renderSummary(messages.length ? messages : dom);
    }
  }

  function scheduleRefresh(forceApi = false) {
    clearTimeout(state.mutationTimer);
    state.mutationTimer = window.setTimeout(() => refresh({ forceApi }).catch(() => {}), DOM_DEBOUNCE_MS);
  }

  const observer = new MutationObserver((records) => {
    const hasExternalChange = records.some((record) => {
      const target = record.target?.nodeType === Node.ELEMENT_NODE ? record.target : record.target?.parentElement;
      if (!(target instanceof Element)) return true;
      return !target.closest(`#${ROOT_ID}, [${CHIP_ATTR}]`);
    });
    if (!hasExternalChange) return;
    const generating = isGenerating();
    const justFinished = state.lastGenerating && !generating;
    state.lastGenerating = generating;
    scheduleRefresh(justFinished);
  });

  function start() {
    ensureSummary();
    observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    scheduleRefresh(true);
    state.refreshTimer = window.setInterval(() => {
      if (location.href !== state.href) {
        state.href = location.href;
        apiCache.conversationId = '';
        apiCache.currentNode = '';
        apiCache.messages = [];
        apiCache.fetchedAt = 0;
        scheduleRefresh(true);
      } else if (!isGenerating()) {
        scheduleRefresh(false);
      }
    }, 4000);
  }

  start();
})();
