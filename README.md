# ChatGPT 长对话统一工具箱

一个面向 `chatgpt.com` 的 Tampermonkey 用户脚本，将长对话性能优化、双层导航、自适应大纲、提示词库、会话导出、字体排版和滚动修复整合在一个脚本中。

## 安装

[点击安装最新版 userscript](https://raw.githubusercontent.com/zjc1772665101-source/chatgpt-unified-long-chat-toolkit/main/chatgpt-unified-long-chat-toolkit.user.js)

也可以下载仓库中的 `chatgpt-unified-long-chat-toolkit.user.js`，在 Tampermonkey 中新建脚本并粘贴完整内容。

安装后请停用功能重叠的旧脚本，避免重复目录、滚动钩子或提示词面板互相冲突。

## 功能

- 长对话性能优化：根据页面压力动态停放较早轮次，需要时可恢复。
- 问答导航：按用户提问生成目录，保留已停放轮次的索引；尚未加载的序号也会显示并可尝试加载。
- 回答大纲：章节只来自当前回答，完整读取 H1-H6；语义标题较少时，结合回答开头、分隔线、真正位于段首的加粗标题和结构化段落自适应补足。
- 提示词库：创建、编辑、删除、置顶、自由拖拽排序、搜索、分类、变量替换和 JSON 导入/导出。
- 一键输入：点击提示词卡片主体，将内容写入当前可见的 ChatGPT 输入框，不自动发送。
- 会话导出：Markdown、JSON、TXT 下载以及复制完整 Markdown。
- 字体与排版：中文、拉丁、粗体、代码和数学排版设置，本地字体检测及 KaTeX/残余 LaTeX 修复。
- 滚动协同：生成期间阻止非用户触发的自动沉底，同时允许问答和章节导航正常跳转。

## 使用说明

提示词变量写作 `{{变量名}}`。点击提示词卡片时会依次询问变量值，再把替换后的文本写入 ChatGPT 输入框。

拖动整张提示词卡片可调整顺序；顺序会写入提示词本地数据，并随 JSON 导入/导出保留。卡片右上角只保留“置顶”和“编辑”两个图标，默认隐藏，鼠标悬停或键盘聚焦时显示；触摸设备上始终显示。删除入口位于编辑弹窗中，避免误触。过长标题会自动省略，悬停标题可查看全文。

## 隐私与安全

- 不包含 API Key、访问令牌、Cookie、账号凭据、私钥、本机用户名或绝对用户目录。
- 不包含作者机器的完整字体清单；本地字体在浏览器中运行时检测。
- 提示词和脚本设置保存在用户脚本管理器或浏览器本地存储中。
- 会话导出在浏览器本地生成并下载，不会由本脚本上传到第三方服务。
- 脚本不包含遥测或统计上报。
- KaTeX 运行时和样式由 userscript 元数据中声明的 jsDelivr 地址加载。

## 兼容性

- 目标站点：`https://chatgpt.com/*`、`https://chat.openai.com/*`
- 推荐：最新版 Chromium 浏览器、Tampermonkey
- ChatGPT 页面结构可能随时变化；若导航或输入功能失效，请附浏览器版本、脚本版本和截图提交 Issue。

## 开发与验证

最终发布文件是：

```text
chatgpt-unified-long-chat-toolkit.user.js
```

发布前执行的验证包括 JavaScript 语法检查、原有模块保留检查、导航/提示词/导出静态检查，以及轻量运行时冒烟测试。当前版本通过 61 项检查。

## 许可证与致谢

本项目按 [GPL-3.0-or-later](LICENSE) 发布。

性能模块包含并修改了 Alex S Hamilton 的 [ChatGPT Lazy Chat++](https://github.com/AlexSHamilton/chatgpt-lazy-chat-plusplus)，保留原作者版权和 GPL 声明。详情见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

本项目与 OpenAI 没有隶属或官方合作关系；ChatGPT 是其各自权利人的商标。
