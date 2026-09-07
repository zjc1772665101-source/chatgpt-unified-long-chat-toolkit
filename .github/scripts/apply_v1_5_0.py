from pathlib import Path
import re

path = Path('chatgpt-unified-long-chat-toolkit.user.js')
s = path.read_text(encoding='utf-8')


def replace_once(old, new, label):
    global s
    count = s.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 exact match, got {count}')
    s = s.replace(old, new, 1)


def sub_once(pattern, repl, label, flags=0):
    global s
    s2, count = re.subn(pattern, repl, s, count=1, flags=flags)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 regex match, got {count}')
    s = s2


replace_once('// @version      1.4.4', '// @version      1.5.0', 'metadata version')
replace_once(
    '// @description  合并长对话性能优化、可恢复 DOM 卸载、API 优先完整会话导出与问答目录、提示词库与安全发送队列、LaTeX 公式复制、经典紧凑 UI、字体与滚动修复；v1.4.4 修复窄屏/手机浮窗可见性与可视视口定位，并加入浮窗和发送队列的独立外观设置。',
    '// @description  合并长对话性能优化、可恢复 DOM 卸载、API 优先完整会话导出与问答目录、提示词库与安全发送队列、LaTeX 公式复制、经典紧凑 UI、字体与滚动修复；v1.5.0 为每个外观子项加入独立覆盖开关，关闭即跟随 ChatGPT、浏览器与当前设备原生样式。',
    'metadata description',
)
replace_once("runtime.version = '1.4.4';", "runtime.version = '1.5.0';", 'runtime version')

replace_once(
    "    queueOpacity: 0.94,\n  };\n\n  const settingTypes = {",
    """    queueOpacity: 0.94,
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
  ]);
  const DEFAULT_DISABLED_OVERRIDE_KEYS = new Set([
    'toolboxTextColor', 'toolboxBackgroundColor', 'toolboxAccentColor', 'toolboxOpacity',
    'queueTextColor', 'queueBackgroundColor', 'queueAccentColor', 'queueOpacity',
  ]);
  const overrideEnabledKey = (key) => `${key}Enabled`;
  for (const key of OVERRIDEABLE_SETTING_KEYS) {
    defaults[overrideEnabledKey(key)] = !DEFAULT_DISABLED_OVERRIDE_KEYS.has(key);
  }

  const settingTypes = {""",
    'override key definitions',
)

replace_once(
    "    queueOpacity: 'number',\n  };\n\n  const numberLimits = {",
    """    queueOpacity: 'number',
  };
  for (const key of OVERRIDEABLE_SETTING_KEYS) {
    settingTypes[overrideEnabledKey(key)] = 'boolean';
  }

  const numberLimits = {""",
    'override setting types',
)

replace_once(
    """    Object.keys(defaults).forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(saved || {}, key)) {
        next[key] = normalizeSetting(key, saved[key]);
      }
    });""",
    """    // Preserve the v1.4.x palette behavior when migrating an existing
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

    Object.keys(defaults).forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(saved || {}, key)) {
        next[key] = normalizeSetting(key, saved[key]);
      }
    });""",
    'settings migration',
)

new_apply = r'''  function applySettings() {
    const root = document.documentElement;
    if (!root) return false;
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
        panelBackground = `color-mix(in srgb, var(--main-surface-primary, var(--bg-primary, #fff)) ${percent}%, transparent)`;
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
          root.style.setProperty('--cgfc-toolbox-launcher-background', `color-mix(in srgb, var(--main-surface-primary, var(--bg-primary, #fff)) ${percent}%, transparent)`);
        }
      }
    };
    applyWidgetPalette('toolbox');
    applyWidgetPalette('queue');

    root.dataset.cgfcMathMode = enabled('mathFontMode')
      ? normalizeSetting('mathFontMode', settings.mathFontMode)
      : 'off';
    root.toggleAttribute('data-cgfc-scroll-fix', settings.fixOuterScroll && hasInternalScrollContainer());
    root.toggleAttribute('data-cgfc-wrap-code', settings.wrapCode);
    root.toggleAttribute('data-cgfc-katex-letter-font', settings.enableKatexLetterFont && enabled('mathFont'));
    root.toggleAttribute('data-cgfc-formula-copy', settings.enableFormulaCopy);
    document.dispatchEvent(new CustomEvent('cgpt-unified-ui-settings-change'));
    return true;
  }

  function getPageWindow()'''
sub_once(r"  function applySettings\(\) \{.*?\n  \}\n\n  function getPageWindow\(\)", new_apply, 'applySettings', re.S)

new_controls = r'''  function syncOverrideVisual(control, key) {
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

  function createRow(parent)'''
sub_once(r"  function appendControl\(parent, options\) \{.*?\n  \}\n\n  function createRow\(parent\)", new_controls, 'appendControl', re.S)

new_sync = r'''  function syncPanelInputs(panel) {
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

  function createPanel()'''
sub_once(r"  function syncPanelInputs\(panel\) \{.*?\n  \}\n\n  function createPanel\(\)", new_sync, 'syncPanelInputs', re.S)

replace_once(
    "    panel.appendChild(fontScanRow);\n\n    appendControl(panel, { label: '英文字体（Latin / 数字优先）', key: 'latinFont', type: 'font-select' });",
    """    panel.appendChild(fontScanRow);

    const overrideHint = document.createElement('p');
    overrideHint.className = 'cgfc-hint cgfc-override-hint';
    overrideHint.textContent = '每项右侧开关只控制脚本是否覆盖该项；关闭后跟随 ChatGPT、浏览器与当前设备的原生样式。关闭不会丢失你已经选好的值。';
    panel.appendChild(overrideHint);

    appendControl(panel, { label: '英文字体（Latin / 数字优先）', key: 'latinFont', type: 'font-select' });""",
    'override hint',
)

replace_once("    appendControl(toolboxGroup, { label: '启用浮窗自定义颜色', key: 'toolboxUseCustomColors', type: 'checkbox' });\n", '', 'remove toolbox legacy palette toggle')
replace_once("    appendControl(queueGroup, { label: '启用队列自定义颜色', key: 'queueUseCustomColors', type: 'checkbox' });\n", '', 'remove queue legacy palette toggle')
replace_once(
    "    toolboxHint.textContent = '颜色开关关闭时继续跟随 ChatGPT 明暗主题；面板宽度不会覆盖你手动拖拽保存的浮窗尺寸。';",
    "    toolboxHint.textContent = '每个外观项均可独立启停；颜色项关闭后继续跟随 ChatGPT 明暗主题。面板宽度不会覆盖你手动拖拽保存的浮窗尺寸。';",
    'toolbox hint',
)
replace_once(
    "    queueHint.textContent = '队列面板会自动限制在当前可视区域内；手机软键盘弹出后也会重新定位。';",
    "    queueHint.textContent = '每个外观项均可独立启停；关闭颜色项后继续跟随 ChatGPT 明暗主题。队列面板会自动限制在当前可视区域内，手机软键盘弹出后也会重新定位。';",
    'queue hint',
)

old_actions = r'''    const resetButton = document.createElement('button');
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

    actions.append(resetButton, closeButton);'''
new_actions = r'''    const followSystemButton = document.createElement('button');
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
      queueNoticeScan();
    });

    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.textContent = '关闭';

    actions.append(followSystemButton, resetButton, closeButton);'''
replace_once(old_actions, new_actions, 'bottom actions')

sub_once(
    r"  const STATIC_CSS = `\n    :root \{.*?\n    \}\n\n",
    "  const STATIC_CSS = `\n",
    'static root defaults',
    re.S,
)

old_body_font = r'''    body,
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
    }'''
new_body_font = r'''    html[data-cgfc-body-font] body,
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
    }'''
replace_once(old_body_font, new_body_font, 'body font and smoothing CSS')

old_main = r'''    main [data-message-author-role],
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
    }'''
new_main = r'''    html[data-cgfc-normal-color] main [data-message-author-role],
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
    }'''
replace_once(old_main, new_main, 'main typography CSS')

old_code = r'''    main .markdown :is(pre, code),
    main .prose :is(pre, code),
    [data-message-author-role] :is(pre, code) {
      font-family: var(--cgfc-code-font) !important;
      font-size: var(--cgfc-code-font-size) !important;
      line-height: var(--cgfc-code-line-height) !important;
    }'''
new_code = r'''    html[data-cgfc-code-font] main .markdown :is(pre, code),
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
    }'''
replace_once(old_code, new_code, 'code typography CSS')

old_bold = r'''    main .markdown :is(strong, b),
    main .prose :is(strong, b),
    [data-message-author-role] :is(strong, b) {
      font-family: var(--cgfc-bold-latin-font), var(--cgfc-bold-chinese-font), serif !important;
      color: var(--cgfc-bold-color) !important;
      font-weight: var(--cgfc-bold-weight) !important;
    }'''
new_bold = r'''    html[data-cgfc-bold-font] main .markdown :is(strong, b),
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
    }'''
replace_once(old_bold, new_bold, 'bold CSS')

replace_once(
    '    html[data-cgfc-math-mode="native"] math,\n    html[data-cgfc-math-mode="native"] math * {',
    '    html[data-cgfc-math-font][data-cgfc-math-mode="native"] math,\n    html[data-cgfc-math-font][data-cgfc-math-mode="native"] math * {',
    'math font CSS guard',
)
replace_once(
    '    html[data-cgfc-katex-letter-font] .katex :is(',
    '    html[data-cgfc-katex-letter-font][data-cgfc-math-font] .katex :is(',
    'katex font CSS guard',
)
replace_once(
    'var(--cgfc-formula-copy-border-color) 70%',
    'var(--cgfc-formula-copy-border-color, currentColor) 70%',
    'formula copy border fallback',
)

switch_css = r'''
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
      color: rgba(255, 255, 255, .92);
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
      border: 1px solid rgba(255, 255, 255, .22);
      border-radius: 999px;
      background: rgba(255, 255, 255, .12);
      box-shadow: inset 0 1px 2px rgba(0, 0, 0, .2);
      transition: background 150ms ease, border-color 150ms ease, box-shadow 150ms ease;
    }

    #${PANEL_ID} button.cgfc-override-switch:hover {
      background: rgba(255, 255, 255, .18);
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
      border: 1px solid rgba(255, 255, 255, .1);
      border-radius: 7px;
      background: rgba(255, 255, 255, .035);
    }
'''
replace_once(
    '    @media (max-width: 520px) {',
    switch_css + '\n    @media (max-width: 520px) {',
    'switch CSS insertion',
)
replace_once(
    "      display: flex;\n      gap: 8px;\n      margin: 12px -14px -14px;",
    "      display: flex;\n      flex-wrap: wrap;\n      gap: 8px;\n      margin: 12px -14px -14px;",
    'action wrapping',
)

replace_once(
    """  onReady(() => {
    ensureShell();

    if (!observersStarted) {""",
    """  onReady(() => {
    ensureShell();
    // ChatGPT hydrates its typography after DOMContentLoaded. Re-apply a few
    // times so mixed custom/native font stacks can sample the final native
    // family rather than the early loading shell.
    setTimeout(applySettings, 800);
    setTimeout(applySettings, 2400);

    if (!observersStarted) {""",
    'hydration reapply',
)

required = [
    '// @version      1.5.0',
    "runtime.version = '1.5.0';",
    'OVERRIDEABLE_SETTING_KEYS',
    'cgfc-override-switch',
    '全部跟随系统',
    'data-cgfc-font-size',
    'data-cgfc-bold-weight',
]
for token in required:
    if token not in s:
        raise SystemExit(f'missing required token after patch: {token}')
if ':root {\n      --cgfc-latin-font:' in s:
    raise SystemExit('old static root defaults still present')

path.write_text(s, encoding='utf-8')
print('Patched userscript to v1.5.0 with per-setting overrides.')
