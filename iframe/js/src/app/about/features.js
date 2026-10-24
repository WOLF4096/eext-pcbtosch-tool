/**
 * @//module/ app/about/features
 * @//description/ 「关于」页的功能清单数据（4 条，纯数据、无逻辑）
 * @//exports/ featuresData
 * @//dependencies/ 无
 * @//example/ const { featuresData } = await import('./features.js')
 *            featuresData.length // 4
 *
 * 本仓只做「PCB 转原理图」这一件事，清单按菜单里的四个入口拆分：
 * PCB转原理图、创建导线（来自PCB / 来自网表 / 网表缓存）。
 *
 * 字段：
 *   - name         功能名（与菜单标题一致，子菜单用「·」连接）
 *   - shortcut     快捷键文案（本仓没有注册快捷键，一律空串）
 *   - shortcutType 快捷键标签配色：sch / pcb / global
 *   - brief        一句话说明，不超过 32 个字符
 *   - scope        适用范围：PCB / 原理图 / 符号 / 全局
 *   - version      适用版本
 *   - demoUrl      演示链接（可为空）
 *   - steps        使用方法，按步骤顺序列出（纯文本，渲染成有序列表）
 *   - note         注意事项（纯文本，没有则为空串）
 *
 * 约束：steps / note 一律按纯文本渲染（escapeHtml），**不要写 HTML 标签**。
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展
 */
export const featuresData = [
	{
		name: 'PCB转原理图',
		shortcut: '',
		shortcutType: '',
		brief: '拿 PCB 上的器件和位置，反向生成一张原理图',
		scope: ['原理图'],
		version: 'V2.2.45 ~ 4',
		demoUrl: 'https://www.jlc-bbs.com/platform/a/1221620',
		steps: [
			'新建一个已绑定目标 PCB 的空白原理图，并切到原理图页',
			'菜单「PCB转原理图 → 从PCB转原理图」，点「加载数据」',
			'选分类方式，必要时用「匹配符号」「指定符号」修正个别器件',
			'点「构建源码」，核对无误后点「写入文档」',
			'需要留档时可用「导出表格」「导出网络」',
		],
		note: '写入前请保持在原理图页。写完会清点器件数，为 0 时会明确提示，不会假报成功。一个引脚只画一条导线，多焊盘的引脚不会重复叠线。',
	},
	{
		name: '创建导线 · 来自PCB',
		shortcut: '',
		shortcutType: '',
		brief: '按 PCB 上已布的线，给原理图补导线',
		scope: ['原理图'],
		version: 'V2.2.45 ~ 4',
		demoUrl: 'https://www.jlc-bbs.com/platform/a/1221655',
		steps: [
			'确认要参照的 PCB 已打开（左右分屏会导致取不到数据）',
			'在原理图里选中要补线的器件',
			'菜单「创建导线 → 来自PCB」，按 PCB 上的连接关系补齐导线',
		],
		note: '一般配合「PCB转原理图」使用：先用它把符号摆出来，再补导线。',
	},
	{
		name: '创建导线 · 来自网表',
		shortcut: '',
		shortcutType: '',
		brief: '按网表缓存给原理图补导线，不用每次选文件',
		scope: ['原理图'],
		version: 'V2.2.45 ~ 4',
		demoUrl: 'https://www.jlc-bbs.com/platform/a/1221655',
		steps: [
			'先用「创建导线 → 从PCB更新网表缓存」或「从文件更新网表缓存」准备好网表',
			'在原理图里选中要补线的器件',
			'菜单「创建导线 → 来自网表」，按缓存里的网络补齐导线',
		],
		note: '缓存为空时会直接提示先去更新，不会弹一句看不懂的「导入网表文件失败」。',
	},
	{
		name: '创建导线 · 网表缓存',
		shortcut: '',
		shortcutType: '',
		brief: '把整块板的网表存下来，供补导线反复使用',
		scope: ['原理图'],
		version: 'V2.2.45 ~ 4',
		demoUrl: '',
		steps: [
			'「从PCB更新网表缓存」会自动切到 PCB 取整块板的网表，存好后自动切回原理图',
			'手上有 .enet 文件的，用「从文件更新网表缓存」选一下即可',
			'每次更新都会说明缓存里有多少器件、多少引脚、多少网络，以及来源和时间',
			'不再需要时用「清空网表缓存」',
		],
		note: '两个来源共用同一份缓存，后更新的覆盖前一份。清空一个本来就是空的缓存时也会明确提示。',
	},
];
