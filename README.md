# LexiFlow 词典翻译（Zotero 9+）

一个从零实现的 Zotero 9+ PDF 选词翻译插件：

- 单词优先查询本机的多部 MDX/MDD 词典；
- 可将 MDX/MDD 一键复制到 Zotero 数据目录中的插件专用文件夹；
- 本地未命中时只显示“使用大模型翻译”按钮，不会静默产生 API 费用；
- 本地未命中时可以直接编辑单词原形并重新查询；
- 句子和段落默认使用 Responses API，译文按内容块实时显示，也可选择 Chat Completions 兼容协议；
- 可保存多个 API/模型配置，并在每次翻译时从选词卡片选择；
- 每个 API 的提示词、接口地址、API Key、模型、目标语言和 Temperature 均可配置；
- 正文采用欧路式词典排版：词头与音标位于来源标签上方，蓝色细边框标签切换词典，释义、词形和大模型解释使用可折叠分区；双语例句紧凑对应，长条目可展开；
- 翻译面板使用独立、可拖动的浮窗，固定在阅读器视口内；不跟随原生标记工具，也不随 PDF 滚动或内容增高重新定位；
- 顶部从“模型”“写入批注”开始，去掉图标和重复词头；单词使用大模型时给出完整词典式解释、用法和逐义双语例句；
- 可一键创建 Zotero 下划线，并把本次本地释义或大模型译文写入批注；超长选区会按 Zotero 的位置数据上限自动拆成连续下划线；
- MDD 发音可选启用，默认关闭；开启后点击发音时才读取同名的 .mdd、.1.mdd、.2.mdd 分卷；
- 只显示词典中实际解析出的音标，不再用词头冒充音标。

## 运行要求

- Zotero 9.0 及更新版本（兼容清单最低版本为 `9.0`，最高版本为 `*`；XPI 与自动更新清单使用相同范围）
- 从源码构建时需要 Node.js 22.8 或更新版本

插件本身是纯 JavaScript，生成的 XPI 与 x86_64/ARM64 架构无关。

本次 0.3.3 适配通过了 10 个回归测试套件，并在 Zotero 10.0.6 的独立测试资料库中完成实际安装、设置页加载、MDX 查词、PDF 原生选词弹窗、翻译下划线批注以及停用/重新启用验证。Zotero 9 的接口和停用监听器兼容性已做源码及回归检查，未另行运行 Zotero 9 客户端；后续尚未发布的版本仍需重新验证。PDF 弹窗检查通过真实 PDF 字符坐标和原生阅读器事件触发，未覆盖鼠标拖选交互。

0.3.4 的 Responses API 修改通过 12 个回归套件，并在 Zotero 10.0.6 中通过 11 项安装包验证，包括真实 PDF Reader 卡片逐帧显示、完成去重、停止、失败和截断处理、协议选择与 Chat 兼容。上游使用本机无密钥模拟 SSE 服务，未验证千问账号权限或实际模型推理。

0.3.5 的词典排版通过 15 个回归套件，并在 Zotero 10.0.6 / Gecko 140.17.0 的独立测试资料库中通过 13 项词典界面验证：两份实际 MDX 各查询七个词，检查中英释义和例句、标签切换、长条目展开、原生深浅主题、小窗口及底部选区的弹窗边界和下划线批注。相同安装包另通过 11 项本机模拟上游的 Responses/Chat 流式回归。真实词典文件及条目全文没有提交公开仓库；测试夹具使用自行编写的合成 HTML。验证覆盖上述两种导出格式的样本，未穷举词典中的所有条目，也未另行运行 Zotero 9 客户端。

0.3.6 的独立浮窗通过 18 个回归套件，并使用相同 XPI 在 Zotero 10.0.6 / Gecko 140.17.0 中通过 17 项集成检查：独立 body 浮层、头部控件、PointerEvent 拖动和 PDF 滚动位置、新选区复用位置、关闭取消及跨 PDF iframe 重选、小窗口/主题、词典式单词与句段提示词、Markdown 和两次真实下划线批注保存。拖动操作通过真实宿主 PointerEvent 驱动并量测布局，未使用物理鼠标人工测试；模型上游为本机无密钥模拟 SSE，未验证真实千问账号或模型内容质量。未另行运行 Zotero 9 客户端。

0.3.7 的欧路式排版通过 18 个回归套件、格式和类型检查，并使用最终 XPI 在 Zotero 10.0.6 / Gecko 140.17.0 中通过 22 项集成检查。新增验证包括公共词头位于来源标签上方、切换来源时音标同步且不借用缺失音标、折叠分区保持浮窗和 PDF 位置、大模型共同分区与首个重复词头标题去重、段落无大词头，以及深浅主题下真实 1px 分隔线。验证使用独立资料库、宿主 PointerEvent 和本机无密钥模拟 SSE；未验证实际千问推理，也未另行运行 Zotero 9 客户端。

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

PDF 阅读器选中文本时，插件会打开独立翻译浮窗。双击通常是选中单词最快的方式；拖动选择句子或段落也可以。拖动浮窗顶部控件之间的空白即可移动；模型下拉框、按钮和正文操作不会触发拖动。重新选择文本会复用同一浮窗及位置，关闭会取消进行中的请求；原生标记工具的重绘不会将其重新打开。重新选词可再次打开，窗口大小改变时会自动限制到可见范围。

翻译完成后点击“写入批注”，插件会为原始选中文本创建 Zotero 下划线，并把当前词典释义或大模型译文写入其原生批注内容。PDF 长选区可能包含数百个矩形坐标；当位置数据超过 Zotero 单条批注的限制时，插件会自动拆成多条相邻下划线，并在每条中保留同一份译文。原有触发方式不变，不会自动修改已经保存的高亮。

## 配置本地 MDX/MDD

推荐在设置页点击“＋ 添加词典”。插件会把词典复制到：

```text
<Zotero 数据目录>/lexiflow-dict-translator/dictionaries/
```

同名 MDD 和编号分卷会自动一并复制。词典二进制文件不会写进 `zotero.sqlite`，数据库/首选项只保存路径；这样不会让 Zotero 数据库异常膨胀。该目录适合随整个 Zotero 数据目录备份，但不会被 Zotero 附件同步自动传到其他设备。

也可以点击“添加外部词典”，直接使用原位置文件。每部词典会作为独立标签显示，可单独命名、启用、停用或删除；右上角的“＋”用于继续增加词典，不再把所有路径堆在一个文本框内。

只填写 MDX 也可以。在“本地词典”设置中勾选“启用词典发音”，重新查词后会显示发音按钮；点击时才扫描 MDX 所在目录、关联同名 MDD 与编号分卷并加载音频。默认关闭，关闭时查词不扫描或读取 MDD，不影响音标和文字释义，也不会删除已导入的 MDD。导入操作仍按原有规则复制关联文件。

MDX 按词典分别缓存，索引按块建立并让出界面线程，不再反复拼接或整体排序全部词头。多部词典逐项显示命中结果，重复查询复用解析结果；重命名或新增词典不会丢弃未变词典的索引。首次使用大型词典仍需要解压和读取索引，并不保证零等待。索引适配器固定使用 `js-mdict 7.0.0`，升级该依赖前需要运行 MDX/MDD 回归测试。

当前实现不会执行词典内的脚本，也不会加载词典自带 CSS，而是将词典 HTML 安全解析为统一卡片。牛津高阶第七版双解与柯林斯 COBUILD 双解有专门适配，保留原词性、义项编号、习语/短语、语法提示、用法说明及英中例句。牛津的音标与 sound 资源按原条目对应，未标明地区的音标不猜测英音或美音；柯林斯缺少音标时不补造。长条目初始显示六个义项，展开后显示该适配器保留的全部义项；“写入批注”仍沿用最多 12,000 字符的上限。卡片支持键盘切换词典和 Zotero 深色主题。0.3.7 的正文参考[欧路](https://dict.eudic.net/dicts/en/apple)：共用词头和音标位于来源标签上方，切换来源同步更新该词典实际提供的音标；蓝色细边框标签下使用紧凑、可折叠的释义和词形分区。大模型单词结果采用相同分区，段落使用译文分区；折叠只隐藏显示内容，不会删减复制或写入批注的原文。不同来源的 MDX 标记并没有统一标准，因此少数高度定制词典可能只显示纯文本释义。加密 MDX/MDD 暂不支持。

## 配置 OpenAI-compatible API

设置页的“＋ 添加 API”可保存多个 OpenAI-compatible 服务。每个服务独立保存名称、Base URL、API 协议、API Key、模型、目标语言、Temperature 和提示词；选词卡片顶部的“模型”下拉框决定本次翻译使用哪个配置。模型名称需填写当前服务和账号支持的模型，插件不会自动选择模型。

新配置默认使用 Responses API，并预填千问 Token Plan 的 Base URL：

```http
POST /compatible-mode/v1/responses
Content-Type: application/json
Authorization: Bearer YOUR_KEY
```

请求体包含 `model`、`input`、`temperature`、`stream: true` 和 `store: false`。按 SSE 事件 `response.output_text.delta` 实时追加译文，完成快照去重；思考过程和工具事件不会混入译文。`response.completed` 确认完成，失败、未完成、拒绝和流中断会显示错误，不会将截断译文当作翻译成功。

Base URL 只需填写到版本路径，插件会自动补齐 `/responses`，例如：

```text
https://token-plan.maas.qianwenaiapi.com/compatible-mode/v1
https://api.openai.com/v1
http://127.0.0.1:8000/v1
```

完整 `/responses` 或 `/chat/completions` 地址也可填写，不会重复追加后缀。旧配置中的完整 Chat Completions 地址会自动保留该协议；如需迁移，修改其“API 协议”为 Responses API 即可。仅支持 Chat Completions 的服务可选择兼容协议，此时自动补齐 `/chat/completions`，请求使用 `messages` 并解析 `choices[0].delta.content`。

千问 Token Plan 的 Key 必须搭配 Token Plan 域名，插件不会自动切换到按量付费地址。接口格式依据 [千问 Token Plan 文档](https://platform.qianwenai.com/docs/token-plan/team/token-plan-team-quickstart)和 [OpenAI Responses 流式事件文档](https://developers.openai.com/api/docs/guides/streaming-responses)。本地兼容服务不需要鉴权时，API Key 可以留空。提示词支持两个变量：

- ${sourceText}：当前选中的文本
- ${targetLanguage}：设置的目标语言

如果自定义提示词没有 ${sourceText}，插件会自动把选中文本追加到提示词末尾。

插件根据当前查询内容统一判断单词和句段，支持边界标点、软连字符、连字符词、撇号和 Unicode；无空格的中日文通过词边界分段避免将整句当作单词。单词大模型模式会额外加入词典编纂指令：按词性列出主要义项、每义至少一条双语例句且全条目至少两例、常见搭配及适用词形/辨析，不编造未知音标。用户自定义术语、目标语言和风格仍保留，“仅给简明释义”等限制让位于完整词条要求。修改查询为短语后会重新判断并恢复句段翻译。完成后的词条使用安全的标题、列表和粗体节点显示；流式接收时实时显示原始文本，HTML 始终作为文本处理。

兼容服务如果忽略流式参数并返回普通 JSON，插件也会自动回退读取完整响应。API Key 以普通 Zotero 首选项保存在本机。只有触发大模型翻译或点击“测试连接”时，选中文本才会发送到当前所选接口。

## 从源码构建

```bash
npm install
npm test
npm run build
npm run verify:package
```

`verify:package` 会核对 XPI 与 `update.json` 的版本、Zotero 9+ 兼容范围、下载地址、完整资源和 SHA-512，避免安装包允许新版本而自动更新清单仍锁定在 9.x。

构建产物位于 build/。如果 Node 18 报 node:util 没有 styleText，请升级到 Node 22：

```bash
nvm install 22
nvm use 22
```

## GitHub 自动构建与发布

仓库包含两个 GitHub Actions 工作流：

- `build.yml`：向任意分支推送、创建 Pull Request 或手动运行时，执行格式检查、回归测试、TypeScript 检查和 XPI 构建及兼容性校验，并上传构建产物；
- `release.yml`：推送形如 `v0.3.7` 的标签时，校验标签与 `package.json` 版本一致，构建正式 XPI，生成源码 ZIP、`update.json` 和 SHA-256 校验文件，然后创建 GitHub Release。

首次发布：

```bash
git add .
git commit -m "chore: add GitHub build and release workflows"
git push
git tag v0.3.7
git push origin v0.3.7
```

发布工作流使用仓库自带的 `GITHUB_TOKEN`，并已声明 `contents: write`，通常不需要配置额外 Secret。如果组织策略强制工作流只读，需要由仓库管理员允许 GitHub Actions 写入 Releases。

默认上游仓库是 `edwardlewis35/zotero-translate`。CI 也会根据 `GITHUB_REPOSITORY` 校验当前仓库，正式 XPI 中的更新地址为：

```text
https://github.com/edwardlewis35/zotero-translate/releases/latest/download/update.json
```

如果需要让 Zotero 在未登录 GitHub 的情况下自动更新，仓库及 Release 必须公开；私有仓库仍可运行构建和发布，但 Zotero 无法匿名下载更新文件。

以后发布新版本时，先同步修改 `package.json` 与 `package-lock.json` 中的版本，再推送同名 `v<版本>` 标签。带连字符的版本（例如 `0.3.3-beta.1`）会自动发布为 GitHub Pre-release。

## 项目结构

```text
addon/                         Zotero 清单、默认首选项和样式
src/addon.ts                   生命周期与设置菜单
src/reader.ts                  PDF 选词事件
src/ui/card.ts                 翻译卡片渲染
src/ui/floating-window.ts      独立浮窗拖动、视口边界与清理
src/selection.ts               单词和句段判定
src/prompts.ts                 词典式单词提示词与句段翻译提示词
src/annotation.ts              创建下划线并写入翻译批注
src/dictionary/               MDX/MDD 导入、加载、结构化解析与缓存
src/api-endpoint.ts            Base URL 与 API 协议
src/openai.ts                  Responses / Chat Completions 流式翻译
src/preferences.ts             Zotero 设置页逻辑
src/shims/                     js-mdict 的 Zotero 文件与解压适配层
.github/workflows/build.yml    GitHub 持续集成构建
.github/workflows/release.yml  标签触发的 GitHub Release 发布
```

## 许可证

AGPL-3.0-or-later。js-mdict 也采用 AGPL-3.0。
