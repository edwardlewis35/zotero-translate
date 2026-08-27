# LexiFlow 词典翻译（Zotero 9）

一个从零实现的 Zotero 9 PDF 选词翻译插件：

- 单词优先查询本机的多部 MDX/MDD 词典；
- 可将 MDX/MDD 一键复制到 Zotero 数据目录中的插件专用文件夹；
- 本地未命中时只显示“使用大模型翻译”按钮，不会静默产生 API 费用；
- 本地未命中时可以直接编辑单词原形并重新查询；
- 句子和段落使用 OpenAI-compatible Chat Completions 接口，译文按内容块实时显示；
- 可保存多个 API/模型配置，并在每次翻译时从选词卡片选择；
- 每个 API 的提示词、接口地址、API Key、模型、目标语言和 Temperature 均可配置；
- 译文按段落或句子分行，词典结果按“发音、词性释义、标签、词形、来源”显示；
- 翻译卡片直接嵌入 Zotero 原生选词标记弹窗，并位于颜色/批注工具栏下方；
- 可一键创建 Zotero 高亮，并把本次本地释义或大模型译文写入批注；
- 支持 MDD 发音资源，以及同名的 .mdd、.1.mdd、.2.mdd 分卷；
- 只显示词典中实际解析出的音标，不再用词头冒充音标。

## 运行要求

- Zotero 9.x（兼容清单范围为 9.0 到 9.0.*）
- 从源码构建时需要 Node.js 22.8 或更新版本

插件本身是纯 JavaScript，生成的 XPI 与 x86_64/ARM64 架构无关。

## 安装

1. 在 Zotero 中打开“工具 → 插件”。
2. 点击右上角齿轮，选择“Install Add-on From File…”。
3. 选择构建产物中的 XPI 文件。
4. 打开“编辑 → 设置 → LexiFlow 词典翻译”，或使用“工具 → LexiFlow 词典翻译设置…”。

## 使用逻辑

| 选中内容  | 自动设置               | 行为                                 |
| --------- | ---------------------- | ------------------------------------ |
| 单个单词  | 开启“自动查询本地词典” | 自动查询所有已配置 MDX               |
| 单个单词  | 本地未命中             | 可编辑单词原形后重查，或使用大模型   |
| 单个单词  | 关闭自动查询           | 显示“查询本地词典”和“大模型翻译”按钮 |
| 句子/段落 | 开启自动在线翻译       | 自动调用所选 API，并实时显示内容块   |
| 句子/段落 | 关闭自动在线翻译       | 等待点击“大模型翻译”                 |

PDF 阅读器出现文本选择弹窗时，插件会把翻译卡片插入弹窗。双击通常是选中单词最快的方式；拖动选择句子或段落也可以。

翻译完成后点击“写入批注”，插件会为原始选中文本创建 Zotero 高亮，并把当前词典释义或大模型译文写入该高亮的批注内容。

## 配置本地 MDX/MDD

推荐在设置页点击“＋ 添加词典”。插件会把词典复制到：

```text
<Zotero 数据目录>/lexiflow-dict-translator/dictionaries/
```

同名 MDD 和编号分卷会自动一并复制。词典二进制文件不会写进 `zotero.sqlite`，数据库/首选项只保存路径；这样不会让 Zotero 数据库异常膨胀。该目录适合随整个 Zotero 数据目录备份，但不会被 Zotero 附件同步自动传到其他设备。

也可以点击“添加外部词典”，直接使用原位置文件。每部词典会作为独立卡片显示，可单独命名、启用、停用或删除；右上角的“＋”用于继续增加词典，不再把所有路径堆在一个文本框内。

只填写 MDX 也可以。插件会扫描 MDX 所在目录并自动关联同名 MDD 与编号分卷。首次使用大型词典时需要建立索引，可能短暂占用 CPU。

当前实现不会执行词典内的脚本，也不会加载词典自带 CSS，而是将常见词典 HTML 安全解析为通用结构。不同来源的 MDX 标记并没有统一标准，因此少数高度定制词典可能只显示纯文本释义。加密 MDX/MDD 暂不支持。

## 配置 OpenAI-compatible API

设置页的“＋ 添加 API”可保存多个 OpenAI-compatible 服务。每个服务独立保存名称、接口、API Key、模型、目标语言、Temperature 和提示词；选词卡片顶部的“模型”下拉框决定本次翻译使用哪个配置。

插件实现标准流式 Chat Completions 请求：

```http
POST /v1/chat/completions
Content-Type: application/json
Authorization: Bearer YOUR_KEY
```

请求体包含 model、messages、temperature 和 `stream: true`，实时解析 SSE 内容块：

```text
choices[0].delta.content
```

接口地址必须填写完整路径，例如：

```text
https://api.openai.com/v1/chat/completions
http://127.0.0.1:8000/v1/chat/completions
```

本地兼容服务不需要鉴权时，API Key 可以留空。提示词支持两个变量：

- ${sourceText}：当前选中的文本
- ${targetLanguage}：设置的目标语言

如果自定义提示词没有 ${sourceText}，插件会自动把选中文本追加到提示词末尾。

兼容服务如果忽略流式参数并返回普通 JSON，插件也会自动回退读取完整响应。API Key 以普通 Zotero 首选项保存在本机。只有触发大模型翻译或点击“测试连接”时，选中文本才会发送到当前所选接口。

## 从源码构建

```bash
npm install
npm run build
```

构建产物位于 build/。如果 Node 18 报 node:util 没有 styleText，请升级到 Node 22：

```bash
nvm install 22
nvm use 22
```

## GitHub 自动构建与发布

仓库包含两个 GitHub Actions 工作流：

- `build.yml`：向任意分支推送、创建 Pull Request 或手动运行时，执行格式检查、TypeScript 检查和 XPI 构建，并上传构建产物；
- `release.yml`：推送形如 `v0.3.0` 的标签时，校验标签与 `package.json` 版本一致，构建正式 XPI，生成源码 ZIP、`update.json` 和 SHA-256 校验文件，然后创建 GitHub Release。

首次发布：

```bash
git add .
git commit -m "chore: add GitHub build and release workflows"
git push
git tag v0.3.0
git push origin v0.3.0
```

发布工作流使用仓库自带的 `GITHUB_TOKEN`，并已声明 `contents: write`，通常不需要配置额外 Secret。如果组织策略强制工作流只读，需要由仓库管理员允许 GitHub Actions 写入 Releases。

默认上游仓库是 `edwardlewis35/zotero-translate`。CI 也会根据 `GITHUB_REPOSITORY` 校验当前仓库，正式 XPI 中的更新地址为：

```text
https://github.com/edwardlewis35/zotero-translate/releases/latest/download/update.json
```

如果需要让 Zotero 在未登录 GitHub 的情况下自动更新，仓库及 Release 必须公开；私有仓库仍可运行构建和发布，但 Zotero 无法匿名下载更新文件。

以后发布新版本时，先同步修改 `package.json` 与 `package-lock.json` 中的版本，再推送同名 `v<版本>` 标签。带连字符的版本（例如 `0.3.0-beta.1`）会自动发布为 GitHub Pre-release。

## 项目结构

```text
addon/                         Zotero 清单、默认首选项和样式
src/addon.ts                   生命周期与设置菜单
src/reader.ts                  PDF 选词事件
src/ui/card.ts                 翻译卡片渲染
src/annotation.ts              创建高亮并写入翻译批注
src/dictionary/               MDX/MDD 导入、加载、结构化解析与缓存
src/openai.ts                  OpenAI-compatible Chat Completions
src/preferences.ts             Zotero 设置页逻辑
src/shims/                     js-mdict 的 Zotero 文件与解压适配层
.github/workflows/build.yml    GitHub 持续集成构建
.github/workflows/release.yml  标签触发的 GitHub Release 发布
```

## 许可证

AGPL-3.0-or-later。js-mdict 也采用 AGPL-3.0。
