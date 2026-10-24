# 开发者文档 · PCB 转原理图

嘉立创EDA（专业版）扩展 `eext-pcbtosch-tool` 的开发、构建与维护说明。

面向对象：要改功能、修 bug、重新打包发版，或把这套代码同步回「狼黑工具」主仓（`pro-api-sdk`）的人。

> 普通用户请读 [README.md](README.md)。

---

## 目录

- [1. 运行时形态（先看这个）](#1-运行时形态先看这个)
- [2. 环境与快速开始](#2-环境与快速开始)
- [3. 目录结构与文件职责](#3-目录结构与文件职责)
- [4. 构建流水线](#4-构建流水线)
- [5. 菜单注册与入口契约](#5-菜单注册与入口契约)
- [6. 页面功能：模块地图](#6-页面功能模块地图)
- [7. 数据流：一次「从 PCB 转原理图」](#7-数据流一次从-pcb-转原理图)
- [8. 原理图源码格式（V2 / V3-V4）](#8-原理图源码格式v2--v3-v4)
- [9. 布局算法与常量](#9-布局算法与常量)
- [10. 导线源码发射：两份必须一致的实现](#10-导线源码发射两份必须一致的实现)
- [11. 创建导线子系统](#11-创建导线子系统)
- [12. 版本适配](#12-版本适配)
- [13. 存储键与运行期状态](#13-存储键与运行期状态)
- [14. 调试与排障](#14-调试与排障)
- [15. 校验脚本](#15-校验脚本)
- [16. 代码风格与 lint 例外](#16-代码风格与-lint-例外)
- [17. 与主仓的同步](#17-与主仓的同步)
- [18. 发版清单](#18-发版清单)
- [19. 设计决策与已知坑](#19-设计决策与已知坑)

---

## 1. 运行时形态（先看这个）

扩展跑在嘉立创EDA 专业版的扩展宿主里，代码分成**三条互不相通的 bundle**，理解这一点是读代码的前提：

| bundle | 源 | 产物 | 运行位置 | 通信方式 |
| --- | --- | --- | --- | --- |
| 扩展入口 | `src/index.ts` + `src/js/**` | `dist/index.js`（IIFE，`globalName: edaEsbuildExportName`） | 宿主扩展环境 | 直接调全局 `eda.*` |
| 工具页面 | `iframe/js/src/**` | `iframe/js/app/PcbToSch.js`（单文件 IIFE） | iframe 内 | 调 `window.eda`（经 `core/eda.js` 兼容 `parent.eda`） |
| 第三方库 | `iframe/js/jszip.min.js` | 原样拷贝 | iframe 内 | 暴露全局 `JSZip` |

三条 bundle **不能共享模块**，只能靠「约定 + 校验脚本」保持一致。这解释了几处看起来奇怪的设计：

- 入口侧和页面侧各有一份 `logger`、各有一份「生成一根导线源码行」的实现，是镜像而不是复用；
- 页面侧不能写 `import`，必须打成 IIFE（原因见 [4.1](#41-为什么页面必须打成单文件-iife)）；
- 一次「从 PCB 转原理图」实际是两个进程边界之间来回：菜单 → iframe → `eda.*` API。

```
菜单点击
  └─ dist/index.js  PcbToSch()
       └─ eda.sys_IFrame.openIFrame('/iframe/PcbToSch.html', 640, 540, 'tosch')
            └─ PcbToSch.js（页面）
                 ├─ eda.sys_FileManager.getProjectFile('project', undefined, '.epro')
                 ├─ JSZip 解包 → project.json / PCB 源码 / 符号源码
                 ├─ 纯函数：解析 → 排布 → 拼源码
                 └─ eda.sys_FileManager.setDocumentSource(src)  ← 写回画布
```

---

## 2. 环境与快速开始

- **Node** ≥ 20.17.0（`package.json` 的 `engines`；`scripts/build-iframe.mjs` 用到了 `import.meta.dirname`，需要 20.11+）。
- **OS**：Windows 下已验证。`scripts/css-audit.mjs` 硬编码了 Chrome 路径，非 Windows 或非默认安装位置需自行改。
- **不需要**全局安装任何 CLI，`npm` 脚本自带 `esbuild` / `ts-node`。

```bash
npm install
npm run build        # 全量：页面 → 入口 → 打 .eext
```

产物：

```
dist/index.js                                  扩展入口
iframe/js/app/PcbToSch.js                      页面（构建产物，勿手改）
build/dist/eext-pcbtosch-tool_v<version>.eext  可安装包
```

开发时的推荐循环：

```bash
npm run watch:iframe   # 改 iframe/js/src 自动重打包页面
npm run compile        # 改了 src/** 之后单独重打入口
npm run build          # 要出 .eext 时
```

装扩展后需要**重开客户端**，宿主才会加载新的 `dist/index.js`；页面 iframe 每次打开都是新加载，改完页面只需关掉工具窗口重开。

---

## 3. 目录结构与文件职责

```
extension.json                 扩展清单：uuid / version / 菜单注册 / entry
package.json                   依赖与构建脚本；version 供构建注入
.edaignore                     打包黑名单（决定哪些文件进 .eext）
tsconfig.json                  TS 配置（仅覆盖 src/**、config/**、build/**）
eslint.config.mjs              ESLint（有意忽略两份移植代码，见 §16）

src/
  index.ts                     扩展入口：menu registerFn 的实现 + 按需 import
  js/
    autoWire/
      index.js                 「创建导线」编排：选器件 → 取网表 → 比对 → 写导线（所有 eda 调用集中在此）
      netlistParser.js         网表解析与比对（纯函数，无 eda 依赖）
      docSwitch.js             原理图 ⇄ PCB 页签切换，记住来路页签
      netlistCache.js          网表缓存读写（存储层，只有字符串进出）
      netlistSync.js           三个缓存维护菜单的实现（切页 / 选文件 / 提示）
      performanceMonitor.js    批量写导线的耗时与成功率统计
    common/
      logger.js                宿主侧日志（debug/info/warn/error，默认 info）
      sourceEmitter.js         「一根导线 = WIRE + LINE + NET」源码拼装（纯函数）

iframe/
  PcbToSch.html                工具页面骨架，只引 jszip.min.js / common.css / app/PcbToSch.js
  css/common.css               深色主题样式（本页专用裁剪版，592 → 477 行）
  js/
    jszip.min.js               第三方：解包 .epro
    app/PcbToSch.js            页面构建产物（IIFE，勿手改）
    src/
      app/pcb-to-sch/
        index.js               页面入口：DOM 绑定、流程编排、四个出口
        model.js               工程模型：定位 uuid、解析 PCB、补符号、合并显示行（纯函数）
        symbolParser.js        解析 .esym，按 PART 取引脚坐标与包围盒（纯函数）
        layout.js              自动排布：按包围盒逐行摆放、超边界换行（纯函数）
        wirePlan.js            引脚朝向 → 导线终点；同一引脚位置只出一条（纯函数）
        sourceBuilder.js       器件列表 → 原理图源码（V2 / V3-V4 两套）
      core/
        eda.js                 取宿主对象（window.eda / parent.eda / null）
        version.js             版本号读取（带缓存）与版本族判定
        log.js                 页面侧日志
        util.js                escapeHtml 等杂项
      ui/
        statusBar.js           状态条（宽度 + 文案）
        progressTicker.js      假进度推进（给不可测时长的步骤用）
        download.js            触发浏览器下载（带 BOM 的文本）
        toast.js               轻提示
        rewardPrompt.js        「用一次记一次」的调用计数（失败静默）
        rewardDialog.js        打赏/反馈弹窗（本仓唯一与主仓产物不同的文件：issues 地址）

config/
  esbuild.common.ts            入口打包配置（IIFE + globalName + banner）
  esbuild.prod.ts              编译入口（支持 --watch）

build/
  packaged.ts                  按 .edaignore 过滤 → JSZip 压缩 → 生成 .eext
  dist/                        历史 .eext 产物

scripts/
  build-iframe.mjs             页面 ESM → 单文件 IIFE
  css-audit.mjs                CSS 裁剪前后的计算样式比对（headless Chrome）
  entry-behavior.mjs           用 mock eda 跑 dist/index.js 的七个场景，记录可观测输出
  compare-behavior.mjs         比对两份行为记录（归一化耗时与时间戳）
```

**约定**：`iframe/js/src/**` 与 `src/js/**` 里的注释统一带 `@//module/` 头（描述 / 导出 / 依赖 / 示例），这是主仓的代码规范，同步时不要删。

---

## 4. 构建流水线

`npm run build` = `build:iframe` → `compile` → `ts-node build/packaged.ts`，三步彼此独立，可以单独跑。

### 4.1 为什么页面必须打成单文件 IIFE

EDA 宿主在加载 iframe 页时，会把每个 `<script src>` 的内容**内联成 blob URL**，且这些 blob 的基址无法用于相对解析。结果是：

- `import './x.js'` 解析不到（无 MIME、无基址）；
- 多个 `<script>` 之间的 ESM 依赖图完全失效。

所以源码用 ESM 写（可读性、可测性），构建期由 `scripts/build-iframe.mjs` 用 esbuild 合成一个 IIFE，HTML 只保留一行 `<script src="/iframe/js/app/PcbToSch.js">`。

同一条约束也解释了为什么 `jszip.min.js` 是全局脚本而不是 `import JSZip`。

### 4.2 页面打包（`scripts/build-iframe.mjs`）

| 配置项 | 值 | 备注 |
| --- | --- | --- |
| `format` | `iife` | 见 §4.1 |
| `target` | `chrome100` | 宿主内核基线 |
| `minify` | `false` | 便于在宿主 DevTools 里断点 |
| `entryNames` | `[name]` | 产物名 = `PAGES` 的键 = `PcbToSch` |
| `define` | `__APP_VERSION__` | 注入 `v<package.json version>`，页面可读版本号 |
| `banner` | 署名 + 「请勿直接修改」 | 构建物必须留痕 |

页面 → 源码的映射写在文件顶部：

```js
const PAGES = { PcbToSch: 'app/pcb-to-sch/index.js' };
```

- **键不能随便改**：它就是 HTML 里的文件名。
- 值指向的入口缺失时会直接抛错（避免「构建成功但产物没更新」的假象）。
- `--watch` 用 esbuild context，改源码即重打。

### 4.3 入口打包（`config/esbuild.common.ts`）

`entryPoints: { index: './src/index' }`，`format: 'iife'`、`globalName: 'edaEsbuildExportName'`、`treeShaking: true`。

`format` / `globalName` / `platform` / `bundle` 这几项是**扩展宿主约定**，注释里标了「请勿修改」。`src/js/autoWire/**` 用动态 `import()` 引入，esbuild 会拆成同目录 chunk —— 这就是「菜单点开才加载导线功能」的实现方式，不要改成静态 import。

### 4.4 打包 `.eext`（`build/packaged.ts`）

1. 校验 `extension.json` 的 `uuid`（32 位小写十六进制）；不合法就生成一个新的并写回文件。
2. 递归列出仓库文件，用 `.edaignore`（gitignore 语法，`ignore` 包解析）过滤。
3. `JSZip` 以 `DEFLATE level 9` 压缩，输出 `build/dist/<name>_v<version>.eext`。

**进包的文件** = 全部文件 − `.edaignore`。当前排除：`.git/`、`node_modules/`、`src/`、`iframe/js/src/`、`scripts/`、`config/`、`build/`、`locales/`、`temp/`、`docs/`、各类配置与锁文件。

> 新增源码目录时**必须同步加到 `.edaignore`**，否则源码会跟着扩展一起发出去。反过来，新增运行期必需的文件（图片、字体、额外 JS）不要误加。

`extension.json` 的 `version` 是平台读取的权威值；`package.json` 的 `version` 用于构建注入（页面 `__APP_VERSION__`）和产物文件名。**两处必须一起改**。

---

## 5. 菜单注册与入口契约

`extension.json` 的 `headerMenus.sch[].menuItems[].registerFn` 是**字符串**，宿主按名字到 `dist/index.js` 的导出里找函数。因此：

- `src/index.ts` 里导出的函数名 = `registerFn` 的值，**改名/删除必须同步改 `extension.json`，否则菜单点了没反应且不报错**。
- `activationEvents: {}` 表示不随启动激活，只在点菜单时激活；因此 `activate()` 是空实现，但必须导出。

| 菜单路径 | `registerFn` | 实现 |
| --- | --- | --- |
| 原理图 → PCB转原理图 → 从PCB转原理图 | `PcbToSch` | 打开 iframe（640×540，id `tosch`） |
| → 创建导线 → 来自PCB | `AutoWirePlacerPCB` | `placeWires('PCB')` |
| → 创建导线 → 来自网表 | `AutoWirePlacerNET` | `placeWires('NET')` |
| → 创建导线 → 从PCB更新网表缓存 | `UpdateNetlistCacheFromPCB` | `updateCachedNetlistFromPCB()` |
| → 创建导线 → 从文件更新网表缓存 | `UpdateNetlistCacheFromFile` | `updateCachedNetlistFromFile()` |
| → 创建导线 → 清空网表缓存 | `ClearNetlistCache` | `clearCachedNetlist()` |

iframe 的 `id` 沿用历史的 `'tosch'`（宿主用它标识这个浮窗，重复打开同一 id 不会叠出两个）。不要随手改名：一旦宿主侧或后续代码按 id 定位页面，改了就找不到。窗口尺寸（640×540）可以调，与 id 无关。

---

## 6. 页面功能：模块地图

依赖方向严格单向，下层不反向 import 上层：

```
index.js
 ├─ model.js ─────────────┐
 ├─ symbolParser.js       │ 纯数据变换，无 eda / 无 DOM / 无 zip
 ├─ layout.js ────────────┤ （model 例外：不碰 DOM，但要 zip 产出的字符串）
 ├─ wirePlan.js → sch/emitter.js
 ├─ sourceBuilder.js ─────┘
 ├─ core/{version,log,util,eda}
 └─ ui/{statusBar,progressTicker,download,toast,rewardPrompt}
```

| 模块 | 导出 | 职责与边界 |
| --- | --- | --- |
| `model.js` | `findUuids`、`parsePcbContent`、`enrichWithSymbol`、`mergeComponentsForDisplay`、`projectTitleOf`、`pcbFilePath`、`symbolFilePath` | 数据 → 数据。不读 zip、不碰 DOM、不写文档，所以能脱离宿主直接测。`findUuids(sheetUuid)` 找不到原理图时抛「未找到对应原理图UUID」，文案会直接显示给用户 |
| `symbolParser.js` | `parseSymbolSource`、`PIN_MARGIN`、`DEFAULT_BBOX` | 解析 `.esym`：一个文件可含多个 PART；`PIN` 行先按 id 存，再由 `ATTR` 补 `NUMBER`/`NAME`，最后按引脚号归并。包围盒 = 引脚坐标外扩 40mil，无引脚时用 `[-20,-20,20,20]` |
| `layout.js` | `splitParts`、`bboxOfPart`、`planFlowLayout`、`planCoordLayout`、`layoutGroup` + 常量 | 排布算法。**V2 与 V3/V4 共用同一份坐标计算**（历史上两套分支各写 90 行、改一边忘一边，已合并） |
| `wirePlan.js` | `planWires` | 引脚朝向 → 导线终点；**按引脚绝对坐标去重**，一个位置只出一条线（否则 1~4 号焊盘同位置会叠 4 条重合导线） |
| `sourceBuilder.js` | `classifyGroups`、`buildSchSource` | 唯一决定**整页源码结构**的地方：分组、调布局、调 `planWires`、拼行（单条导线行的格式差异在 `sch/emitter.js`） |
| `sch/emitter.js` | `createSchWireLines` | 「一根导线 = WIRE + LINE + NET 属性」的唯一实现；id/ticket 由调用方提供 |
| `core/version.js` | `getEditorVersion`、`getVersionFamily`、`isV2`、`isV3`、`isV4`、`isModern`、`classifyVersionSupport`、`resetVersionCache` | 版本号**必须缓存**：`getEditorCurrentVersion()` 是同步跨 iframe 调用，逐行判断会把上万行源码变成上万次调用 |
| `core/eda.js` | `getEda`、`hasEda`、`NETLIST_KEY` | 兼容 `window.eda` / `parent.eda` / 无宿主；全部 try/catch，跨域访问 `parent` 会抛 SecurityError |
| `ui/progressTicker.js` | `createProgressTicker` | 给「取工程包」这类时长不可知的步骤造一个从 X% 缓慢爬到 Y% 的假进度 |
| `ui/download.js` | `downloadText` | Blob 下载；CSV 需要 `bom: true`，否则 Excel 打开中文乱码 |

**常量集中点**（改之前先看谁在用）：

| 常量 | 值 | 位置 |
| --- | --- | --- |
| 原理图右边界 | 2560 mil | `layout.js` `RIGHT_LIMIT` |
| 同排部件间距 / 换行行距 | 40 / 40 mil | `PART_GAP` / `ROW_GAP` |
| 分组间距 | 200 mil | `GROUP_GAP` |
| 坐标布局多部件竖向偏移 | 10 mil | `PART_COORD_STEP` |
| 引脚包围盒外扩 | 40 mil | `symbolParser.js` `PIN_MARGIN` |
| 起始坐标 / 组内间距（页面传入） | `startX=200`、`startY=-200`、`colSpacing=150`、`rowSpacing=150`、`perRow=20`、`wireLength=40` | `app/pcb-to-sch/index.js` `onBuild()` |

---

## 7. 数据流：一次「从 PCB 转原理图」

`onRefresh()`：

1. `eda.dmt_SelectControl.getCurrentDocumentInfo()` → 当前页 uuid。
2. `eda.sys_FileManager.getProjectFile('project', undefined, '.epro')` → 整个工程包（最慢的一步，期间用 `progressTicker` 伪装进度）。
3. `JSZip.loadAsync` → `project.json`（`schematics` / `boards` / `symbols` / 标题）。
4. `findUuids(projectJson, sheetUuid)` → `{ schematicUuid, pcbUuid }`；找不到就抛错。
5. `zip.file(pcbFilePath(pcbUuid))` → PCB 源码字符串；`parsePcbContent` 抽 `COMPONENT` 的位号 / 名称 / 封装 / 器件 / uuid / 坐标 / 引脚网络。
6. `enrichWithSymbol` 用 `projectJson.symbols` 把器件绑到符号 uuid + 标题。
7. `mergeComponentsForDisplay` 按「封装 + 器件」合并成显示行，一行可含多个位号，`componentIndices` 指回原始数组。

`onBuild()`：

1. 再次 `enrichWithSymbol`（用户可能刚补了标准化）。
2. `applyManualSymbols`：把「指定符号」列的值落到 `components[*].symbolUuid` —— 先查关键词表（`电阻`/`无极电容`/`电感` → 硬编码 uuid），否则按符号标题**精确匹配**；都找不到就静默忽略（该行仍会被判为缺符号）。
3. `checkMissingSymbols` → 缺符号的**分组**标红；未勾「忽略符号错误」则抛错中止。
4. `enrichPartCounts`：读每个符号的 `.esym`，缓存到 `symbolPinsDatabase[symbolUuid]`（引脚表 + 包围盒），顺手写 `comp.partCount`。
5. `buildSchSource({ format: isV2() ? 'v2' : 'modern', ... })` → 字符串。
6. 结果只存进 `candidateSource`，**不动画布**，所以可以反复构建。

`onWrite()`：

1. 门禁：重新取一次 `getCurrentDocumentInfo()`，`documentType !== 1`（非原理图页）直接中止 + toast。这个 iframe 是浮窗，用户完全可能在构建期间切走。
2. `eda.sys_FileManager.setDocumentSource(candidateSource)`。
3. **写入自检**：`eda.sch_PrimitiveComponent.getAll()` 数一遍器件数。V4 存在「返回 true 但器件没生成」的情况，只看返回值会假报成功。
4. 成功且 `placedCount > 0` 才算成功；`isSuccess` 为真但 `placedCount === 0` 时给出「页面上可能有旧内容，建议新建空白页」的提示。

`onExportProject()`：把源码写回**内存里那份 zip** 的 `SHEET/<schematicUuid>/1.esch`，其余条目原样保留，`generateAsync` 后触发下载，文件名取工程标题。**固定第 1 页**，这是已知限制。

`onExportCsv()` 直接读 DOM（导出的就是用户看到的，含手填值）；`onExportNet()` 依赖 §7.4 的 `symbolPinsDatabase`，所以必须先构建。

---

## 8. 原理图源码格式（V2 / V3-V4）

格式按编辑器主版本自动切换（页面用 `isV2()` 选 `format`），`sourceBuilder.js` 决定整页结构，单条导线行由 `sch/emitter.js` 按 `isModern` 生成。

| 版本族 | 格式标识 | 形态 |
| --- | --- | --- |
| 2.x（含 2.2） | `v2` | 每行一个 JSON 数组，无行尾标记 |
| 3.x / 4.x | `modern` | 头段 + 实体段，`\|\|` 分隔，行尾带 `\|`（最后一行不带） |

```text
V2  : ["COMPONENT","e1","R.1",100,-200,0,0,{},0]
V3/4: {"type":"COMPONENT","ticket":2,"id":"e2"}||{"partId":"R.1","x":120,"y":-220,"rotation":0,...}|
```

### 8.1 V3/V4 的三条硬约束

写错任何一条，症状都是「符号凭空消失」，且**不一定报错**：

| # | 约束 | 违反后的表现 |
| --- | --- | --- |
| 1 | `COMPONENT` 行必须带 `attrs`，且七个键齐全：`Footprints`、`Devices`、`DeviceName`、`FootprintName`、`pinClass`、`differentialPairClass`、`Symbols` | `setDocumentSource` 仍返回 `true`，但器件被静默丢弃 → 只剩导线没有符号 |
| 2 | `ATTR` 行必须字段齐全（`x`/`y`/`rotation`/`color`/…/`zIndex` 全写） | 只写 `parentId`/`key`/`value` 会导致**整份**源码写入返回 `false` |
| 3 | 每个器件必须有一条 `Channel ID` 属性（值可为空串） | 整份拒写 |

正因为约束集中在「整页一致性」上，插件采用**整页重新生成**而不是往现有文档追加几行 —— 这也是用户必须用空白页的根本原因。

### 8.2 其它格式细节

- 字符串（器件名、网络名）必须 JSON 转义，否则含 `"` 时整份源码非法（1.2.0 修过）。
- `id` / `ticket` 由页面自增分配（`nextId`），不要复用宿主已有编号。
- 多部件符号的 `partId` 形如 `R.1`；部件名取不到时曾写出字面量 `undefined`（1.2.0 修过）。

---

## 9. 布局算法与常量

`layoutGroup(group, opts, symbolDb)` 有两条路径：

**流式布局（默认，按位号 / 器件 / 封装）**：把分组内器件展开成「器件 × 部件」，按包围盒宽度逐行排；累计宽度超过 `RIGHT_LIMIT`（2560mil）就换行，行高取该行最高部件 + `ROW_GAP`。分组的起始 Y 递减 `GROUP_GAP`。

**坐标布局（按元件坐标）**：按 PCB 坐标 1:1 换算，同器件多部件用 `PART_COORD_STEP` 微错开，避免完全重叠。不做紧凑排布，整页会比较散 —— 这是为了「对着 PCB 核对」而不是「好看」。

**分层**：画布 X/Y 正方向与 Y 轴朝向因版本而异，`yvalue`（页面复选框「启用 Y 值翻转」）参与坐标符号计算，默认值由 `initVersion()` 按 `isV2()` 反推。V2 电气坐标向上为正，V3/V4 向下为正。

**组标题与边框**：页面只有一个 `genTitle` 复选框，但它同时决定「写组名」和「画框线」（`genFrame`）—— 历史上是两个变量指向同一元素，合并时保留了这一行为。

---

## 10. 导线源码发射：两份必须一致的实现

| 副本 | 路径 | 使用者 |
| --- | --- | --- |
| 页面侧 | `iframe/js/src/sch/emitter.js` | `wirePlan.js` → 转原理图时给每个引脚拉短线 |
| 入口侧 | `src/js/common/sourceEmitter.js` | `autoWire/index.js` → 补画导线 |

两份必须**逐字节一致**（`test/sourceEmitter.test.mjs` 在主仓会逐字节比对）。原因：一个打包成 IIFE、一个是 ESM，无法共享模块；字段名或行尾 `|` 一旦漂移，就会出现「某个版本写进去打不开」这类最难查的问题。

改这里之前先确认两件事：
1. 两处都改，且逻辑一致；
2. 先拿真实工程文件核对格式（主仓用 `测试样本/` 与 `npm run test:samples`；**本仓没有携带这套用例**，源码注释里对 `test/**` 的引用都指向主仓）。

id/ticket 的分配策略两边不同，所以由调用方通过 `nextRow()` 注入：
- 转原理图：id 与 ticket 共用一个自增计数器；
- 创建导线：id 从 `maxId+1` 起、ticket 从 `maxTicket+1` 起，两个独立计数器（必须避开画布上已有图元的编号）。

---

## 11. 创建导线子系统

### 11.1 分层

| 层 | 文件 | 是否碰 `eda` | 是否可测 |
| --- | --- | --- | --- |
| 编排 + EDA 调用 | `autoWire/index.js` | 全部集中在此 | 不测，由 `scripts/entry-behavior.mjs` 间接覆盖 |
| 纯解析 / 比对 | `autoWire/netlistParser.js` | 不碰 | 可直测 |
| 存储 | `autoWire/netlistCache.js` | 仅 `sys_Storage` | 可 mock |
| 页签切换 | `autoWire/docSwitch.js` | 是 | — |
| 菜单交互 | `autoWire/netlistSync.js` | 是（切页 / 选文件 / 提示） | — |
| 统计 | `autoWire/performanceMonitor.js` | 不碰 | — |

### 11.2 两条取数路径

`placeWires('PCB' | 'NET')`：

- `'PCB'`：`switchToPCB()` → 读**选中器件**的焊盘网络 → `switchToSchematic()` → 比对 → 只补原理图还缺的连线。
- `'NET'`：`loadNetlistCache()` → 解析 → 比对 → 补线。不切页、不弹框。

比对逻辑：以「器件 uniqueId + 引脚号」为键，原理图已有的连接不再重复画。

### 11.3 网表格式差异（已收敛）

| 差异点 | V3 | V2 |
| --- | --- | --- |
| 组件容器 | `{ components: { … } }` | 裸对象 `{ [uniqueId]: { … } }` |
| 引脚结构 | `pinInfoMap: { pin: { net } }` | `pins: { pin: netName }` |

器件在网表中缺失、或缺少 `props` / 引脚数据时**只告警跳过，不抛错**（整块板缺几个器件不该让补线全废）。

### 11.4 缓存语义

- 两个来源（PCB / 文件）**共用同一个键，只存一份**，后写的覆盖前一份。
- 正文**原样存储**（不包 JSON），避免大文本二次转义；来源/时间/文件名/摘要另存元信息键。
- 元信息写失败不影响正文可用（`loadNetlistCache()` 允许 `meta === null`，此时描述为「来源未知」）。
- `deleteExtensionUserConfig` 不是所有版本都有：删除失败则回退为写空串，保证「清空」一定生效。

### 11.5 页签切换的契约

- `switchToPCB()` **不抛错**，返回 `false` 表示没定位到 PCB，由调用方决定是否中止。
- `switchToSchematic()` **会抛错**：拿不到原理图页签必须拦住后续写盘，否则会把导线行拼进 PCB 源码（宿主报「格式错误」，甚至写坏文档）。
- 分屏 / 多窗口时 `switchToPCB()` 找不到 PCB 页签 —— 这是「来自PCB」失效的最常见原因，提示文案要引导用户改走「来自网表」。

### 11.6 从 PCB 取整份网表

`eda.sch_ManufactureData.getNetlistFile('JLCEDA')` 在 **PCB 文档下**同样可用，返回的 `File` 就是整块板的 `.enet`（含全部器件与引脚网络），**不需要选中任何器件**。刚切页时可能还没加载完，`netlistSync.js` 内置一次 400ms 重取。

---

## 12. 版本适配

`core/version.js`：

| 函数 | 语义 | 用在哪 |
| --- | --- | --- |
| `getEditorVersion()` | 版本号字符串，带穿透缓存，永不抛错 | 界面显示 |
| `getVersionFamily()` | `V2` / `V2.2` / `V3` / `V4` / `''` | — |
| `isModern()` | V3 或 V4 | **所有「用哪套源码格式」的分支都必须用它** |
| `isV2()` | V2 或 V2.2 | Y 轴默认值、`format` 选择 |
| `isV3()` / `isV4()` | 精确族 | 只在确实只对单一版本成立时用 |
| `classifyVersionSupport(v)` | `tooOld` / `supported` / `tooNew` / `''` | 顶部提示三档 |
| `resetVersionCache()` | 清缓存 | 测试、宿主重连后 |

区间：`MIN_SUPPORTED_VERSION = '2.2.45'`（之前缺 `sch_ManufactureData.getNetlistFile` 等 API），`MAX_SUPPORTED_MAJOR = 4`。

**不要用 `isV3()` 判断格式**：V3 与 V4 的文件格式同构，用 `isV3()` 会把 V4 当 V2，按数组格式写入直接写坏文档（1.2.0 修的就是这个）。

版本缓存只缓存**非空值**：取不到（不在宿主环境）时不缓存，等环境就绪还能再取。

---

## 13. 存储键与运行期状态

宿主用户配置（`eda.sys_Storage.get/setExtensionUserConfig`）：

| 键 | 内容 | 写入方 |
| --- | --- | --- |
| `AUTOWIRE_NETLIST_CACHE` | 网表正文（`.enet` 原文） | `netlistSync.js` / `netlistCache.js` |
| `AUTOWIRE_NETLIST_CACHE_META` | JSON：`{ source, sourceLabel, fileName, savedAt, bytes, summary }` | 同上 |

页面内模块级状态（`app/pcb-to-sch/index.js`）：`zip`、`projectJson`、`components`、`mergedRows`、`candidateSource`、`currentPcbUuid`、`currentSchematicUuid`、`symbolPinsDatabase`。窗口关闭即丢，不做持久化 —— 这是有意的：工程内容不进用户配置。

---

## 14. 调试与排障

### 14.1 打开日志

- 页面侧：`core/log.js`，`logger.setLevel('debug')` 后刷新 iframe；或直接在宿主 DevTools 里对 iframe 上下文执行。
- 入口侧：`src/js/common/logger.js`，默认 `info`，`debug` 静默。排查「创建导线」时先调到 `debug`，能看到网表条数、切页结果、逐批写入情况。

### 14.2 常见故障 → 实际原因

| 现象 | 真实原因 | 定位位置 |
| --- | --- | --- |
| 界面正常，点菜单没反应 | `registerFn` 名字与 `src/index.ts` 导出不一致 | §5 |
| 页面白屏，控制台 `JSZip is not defined` | `PcbToSch.html` 里 `jszip.min.js` 被移走或排到产物之后 | `iframe/PcbToSch.html` |
| 页面白屏，控制台 `Unexpected token 'export'` 之类 | 直接引了 ESM 源码，没走 `build:iframe` | §4.1 |
| 「未找到对应原理图UUID」 | 当前页所属原理图未绑定 PCB | `model.js#findUuids` |
| 「部分元件没有符号」 | 器件未标准化，且未手填 / 未勾忽略 | `index.js#checkMissingSymbols` |
| 写入成功但无器件 | 页面非空白（V3/V4 新旧图元冲突），或 `COMPONENT` 缺 `attrs` | §8.1 / §7 `onWrite` |
| 写入被拒（`false`） | `ATTR` 字段不全 / 缺 `Channel ID` / 当前不是原理图页 | §8.1 |
| 符号上下颠倒、导线跑偏 | `yvalue` 与实际版本反了 | §9 |
| 上千元件卡死 / OOM | 一次性写入源码过大 | 改「导出文件」 |
| 「来自PCB」提示未选中器件 | 原理图里没有选中 | §11.2 |
| 「来自PCB」取不到 PCB | 分屏 / 多窗口 | §11.5 |
| 「来自网表」说缓存为空 | 从未更新缓存，或刚清空 | §11.4 |
| CSV 中文乱码 | 下载缺 UTF-8 BOM | `ui/download.js` `bom: true` |

### 14.3 在浏览器里直接调试页面

`core/eda.js` 在没有宿主时返回 `null`，`initVersion()` 会捕获并把按钮全禁用、顶部显示「当前不在EDA环境」。所以可以单独打开 `iframe/PcbToSch.html` 调样式，但**调不了数据流程** —— 那部分只能装扩展实测。

---

## 15. 校验脚本

三个脚本都**不参与构建**，是维护期的验伪工具。

### 15.1 `scripts/css-audit.mjs` — CSS 裁剪前后视觉零变化

```bash
node scripts/css-audit.mjs snapshot baseline
node scripts/css-audit.mjs snapshot pruned
node scripts/css-audit.mjs compare  baseline pruned
```

做法：把 `common.css` 内联进一个静态页（= `PcbToSch.html` 的 DOM + 动态类名的合成节点），用 headless Chrome 读回每个元素的计算样式，逐节点逐属性比对。当前基线是 35 个节点 × 73 条属性。

- 需要本机 Chrome，路径硬编码为 `C:/Program Files/Google/Chrome/Application/chrome.exe`。
- 快照落在 `temp/css-audit/`。

### 15.2 `scripts/entry-behavior.mjs` — 入口产物行为对照

```bash
node scripts/entry-behavior.mjs dist/index.js temp/behavior-child.json
```

在 Node `vm` 里塞一套会记录调用的 mock `eda`，真实执行 `dist/index.js` 导出的菜单函数，记录四类可观测输出：提示文案 / 日志 / 写盘内容 / 用户配置读写。

覆盖七个场景：缓存为空、按缓存补线、按 PCB 补线、三个缓存维护、打开页面。

### 15.3 `scripts/compare-behavior.mjs` — 两份记录比对

```bash
node scripts/compare-behavior.mjs temp/behavior-parent.json temp/behavior-child.json
```

归一化掉的噪声：日志里的耗时数字、缓存元信息的 `savedAt`、主仓独有的快捷键注册、主仓其它功能写的用户配置。

> 只比源码文本不足以证明「同步后功能一致」—— 同一份输入喂给两边产物、输出逐项相同才算数。

---

## 16. 代码风格与 lint 例外

- 本仓规则（`eslint.config.mjs`）：`@antfu/eslint-config`，**tab 缩进、单引号、分号**。
- `iframe/js/**` 与 `src/js/**` **有意排除 lint**。这两块是从主仓整目录拷来的（4 空格缩进的 prettier 风格），本仓要保持**逐字节一致**才能靠拷贝同步；一旦按本仓规则重排，diff 就永远对不上。需要检查时回主仓跑。
- 提交钩子：`simple-git-hooks` 的 `pre-commit` → `lint-staged` → `eslint --fix`。
- 注释规范：模块头 `@//module/`、`@//description/`、`@//exports/`、`@//dependencies/`、`@//example/`；构建产物与源文件都保留开发者署名 banner（源码注释会被 esbuild 丢掉，所以 banner 在配置里补）。

---

## 17. 与主仓的同步

本仓是从「狼黑工具」（`pro-api-sdk`）拆出的独立功能仓，相关代码**逐字节一致**。同步方式是**整目录拷贝**，不是手工改。

### 17.1 拷贝清单

```
iframe/js/src/app/pcb-to-sch/     → 整目录
iframe/js/src/core/               → 整目录
iframe/js/src/ui/                 → 整目录
iframe/js/src/sch/                → 整目录
iframe/PcbToSch.html
iframe/js/jszip.min.js
src/js/autoWire/                  → 整目录
src/js/common/                    → 整目录
```

**例外**：`iframe/css/common.css` 是本页专用的**裁剪版**，不整份覆盖。主仓调整样式时，手工挑出本页用到的规则搬过来，改完用 §15.1 验一遍。

### 17.2 步骤

1. 按上表拷贝。
2. `npm run build:iframe`（页面有改动时）+ `npm run compile`，或直接 `npm run build`。
3. 校验：
   - `cmp iframe/js/app/PcbToSch.js <主仓同路径>` —— 应逐字节相同；**唯一允许的差异**是 `rewardDialog` 里的 issues 地址（本仓指向自己的 GitHub issues）。
   - 改过 CSS：按 §15.1 拍快照比对。
   - 改过 `src/js/autoWire/**`：按 §15.2 / §15.3 跑主仓与本仓的 `dist/index.js`，比对七场景调用序列。
4. 同步 `CHANGELOG.md`（写清同步自主仓哪个版本）。

### 17.3 注意

- 不要「顺手优化」移植过来的文件（格式、命名、注释都不要动），否则下次整目录拷贝会产生大量无关 diff。
- 主仓的一份代码可能同时服务多个页面，拷贝时不要带过来本仓用不到的部分（`common.css` 就是这么裁的）。

---

## 18. 发版清单

1. 改 `extension.json` 的 `version` **和** `package.json` 的 `version`（两处必须一致）。
2. 更新 `CHANGELOG.md`（按「新增 / 变更 / 修复 / 文档」分节）。
3. `npm run lint`；若有改动涉及移植代码，回主仓跑。
4. `npm run build`。
5. 验证产物：
   - `build/dist/eext-pcbtosch-tool_v<version>.eext` 存在且体积正常（1.4.0 约 180KB）；
   - 解压（`.eext` 其实就是 zip）确认 **不含** `src/`、`iframe/js/src/`、`scripts/`、`node_modules/`；
   - 含 `extension.json`、`dist/index.js`、`iframe/PcbToSch.html`、`iframe/js/app/PcbToSch.js`、`iframe/js/jszip.min.js`、`iframe/css/common.css`、`images/`。
6. 实机装一次：三个菜单能打开、加载数据能出表、写入/导出各跑一遍。
7. 打 tag、传 Releases。

---

## 19. 设计决策与已知坑

**为什么整页重写，而不是增量追加**
宿主对同一文档内新旧图元的冲突处理不可控（V3/V4 下常表现为「写入成功但器件不生成」）。整页重写把不确定性关在一个可控范围内，代价是要求用户用空白页。

**为什么要写入后清点器件数**
`setDocumentSource` 的返回值在 V4 上不代表成功。`sch_PrimitiveComponent.getAll()` 的计数是唯一可信证据，也是「没有生成器件」这条提示的来源。

**为什么版本号要缓存**
`getEditorCurrentVersion()` 同步穿透到宿主。历史上 `GenerateNet` 逐行判断版本，上万行就是上万次跨 iframe 调用。

**为什么 V2 与 V3/V4 的布局合并成一份**
原本两套分支各 90 行几乎逐字相同，只有「写哪版源码行」不同，已经出现过改一边忘一边。现在坐标计算只有一份，格式差异集中在 `sourceBuilder.js` 的发射部分。

**为什么导线要按坐标去重**
PCB 上一个引脚对应多个焊盘（编号 1~4）、符号里也画了 4 个同位置引脚时，`comp.pins` 有 4 个键，逐键画线会在同一点叠 4 条完全重合的导线 —— 视觉上像一条，实际是 4 条，后续编辑会很难受。

**为什么 CSS 单独裁**
主仓的 `common.css` 服务多个页面，含下拉框、滑块、取色器、日期/搜索/密码框等本页没有的控件。整份搬过来会让本页的样式表大一倍且难以维护，所以裁剪后用计算样式快照证明「视觉零变化」。

**为什么要用假进度**
取工程包（`getProjectFile`）耗时随工程大小变化且无回调。没有进度用户会以为卡死；`progressTicker` 让进度从 10% 缓慢爬到 40%，真取到后再跳到 45%。

**已知限制（不改，属设计取舍）**

- 导出文件固定写 `SHEET/<schematicUuid>/1.esch`，即原理图第 1 页。
- 「按元件坐标」不做紧凑排布，整页会散。
- 「创建导线」要求原理图与 PCB 同窗口（宿主 API 限制）。
- 元件数上千时直接写入可能 OOM，请走「导出文件」。
- 本仓不带单元测试；源码注释中对 `test/**`、`npm run test:samples` 的引用均指向主仓。

---

## 20. 许可

Apache License 2.0，见 [LICENSE](LICENSE)。

本工具为非官方第三方开源扩展，与嘉立创 / EasyEDA 官方无隶属关系。

开发者：WOLF4096 · 辅助开发：DeepSeek-V4.1-Flash
