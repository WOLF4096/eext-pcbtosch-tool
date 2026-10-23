/**
 * 狼黑工具 · PCB 转原理图（独立版）扩展入口
 *
 * 本文件只做两件事，**功能实现都不在这里**：
 *   1. 导出函数，供 `extension.json` 的 `headerMenus[].registerFn` 按名字引用
 *      （函数名 = 菜单项，改名/删除必须同步改 `extension.json`，否则菜单点了没反应）；
 *   2. 打开功能页面 / 按需加载无界面功能。
 *
 * 功能代码的位置：
 *   - 有界面：`iframe/PcbToSch.html` + `iframe/js/src/app/pcb-to-sch/**`（源码用 ESM 写，
 *     `npm run build:iframe` 打包成 `iframe/js/app/PcbToSch.js`，HTML 只引产物）；
 *   - 无界面：`src/js/autoWire/**`，**按需 `import()`** —— 不要在入口静态引入，
 *     否则每次打开 EDA 都要先把导线功能加载进内存。
 *
 * 开发文档：https://prodocs.lceda.cn/cn/api/guide/
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展，与嘉立创 / EasyEDA 官方无隶属关系
 */

/* ===== 一、公共工具 ===== */

/**
 * 打开功能页面
 *
 * @param name - 页面名，对应 `iframe/<name>.html`
 * @param width - 宽（px）
 * @param height - 高（px）
 * @param id - iframe 标识（页面内部按此标识关闭自己）
 */
function openPage(name: string, width: number, height: number, id: string = name): void {
	eda.sys_IFrame.openIFrame(`/iframe/${name}.html`, width, height, id);
}

/* ===== 二、生命周期 ===== */

/**
 * 扩展激活钩子（由 EDA 调用）
 *
 * `extension.json` 的 `activationEvents` 为空，表示不随启动自动激活，只在用户点菜单时激活，
 * 因此这里不需要做任何事；保留空实现是因为入口必须导出它。
 */
// eslint-disable-next-line unused-imports/no-unused-vars
export function activate(status?: 'onStartupFinished', arg?: string): void {}

/* ===== 三、有界面的功能 ===== */

/**
 * 从 PCB 转原理图
 *
 * 该页面的 iframe 标识沿用历史的 `'tosch'`（页面内部按此标识关闭自己）。
 */
export function PcbToSch(): void {
	openPage('PcbToSch', 640, 540, 'tosch');
}

/* ===== 四、无界面的功能（按需加载） ===== */

/**
 * 从 PCB 创建导线
 *
 * 在原理图中选中器件后执行：按 PCB 网表在符号引脚上自动拉导线。
 * 模块在调用时才加载，避免常驻内存。
 */
export async function AutoWirePlacerPCB(): Promise<void> {
	const { placeWires } = await import('./js/autoWire/index.js');
	await placeWires('PCB');
}
