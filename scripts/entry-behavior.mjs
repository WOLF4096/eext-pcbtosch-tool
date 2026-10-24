/**
 * 入口产物行为对照（临时脚本，不参与构建）
 *
 * 做什么：在 Node 的 vm 里用一套 mock `eda` 真实跑 `dist/index.js` 导出的菜单函数，
 * 记录「提示文案 / 日志 / 写盘内容 / 用户配置读写」四类可观测输出。
 *
 * 为什么：子仓的 `创建导线` 是从主仓整目录拷来的，只比对源码文本不足以说明
 * 「更新后功能一致」——同一份输入喂给两边的产物，输出逐项相同才算数。
 *
 * 用法：
 *   node scripts/entry-behavior.mjs <dist/index.js 路径> <输出 json 路径>
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import vm from 'node:vm';

const distPath = path.resolve(process.argv[2]);
const outPath = path.resolve(process.argv[3]);

/** 构造一套记录调用的 mock eda；每个场景前重建，避免互相污染 */
function makeEda(state) {
	const rec = state.rec;
	const storage = state.storage;

	/** 记录一次调用 */
	const log = (name, detail) => rec.push({ call: name, detail });

	const fileOf = (text, name = 'board.enet') => ({
		name,
		text: async () => text,
	});

	return {
		sys_Environment: { getEditorCurrentVersion: () => 'V4.1.78' },
		sys_Message: {
			showToastMessage: async (msg, level) => log('toast', { msg, level }),
		},
		sys_Log: { add: (msg, level) => log('log', { msg, level }) },
		sys_PanelControl: { openBottomPanel: name => log('openBottomPanel', name) },
		sys_IFrame: { openIFrame: (...args) => log('openIFrame', args) },
		sys_Storage: {
			getExtensionUserConfig: async (key) => {
				log('storage.get', key);
				return storage[key];
			},
			setExtensionUserConfig: async (key, value) => {
				log('storage.set', { key, length: String(value).length, head: String(value).slice(0, 24) });
				storage[key] = value;
				return true;
			},
			deleteExtensionUserConfig: async (key) => {
				log('storage.delete', key);
				delete storage[key];
				return true;
			},
		},
		sys_FileSystem: {
			openReadFileDialog: async (exts, multi) => {
				log('openReadFileDialog', { exts, multi });
				return fileOf(state.fileText);
			},
		},
		sys_FileManager: {
			getDocumentSource: async () => {
				log('getDocumentSource', null);
				return state.documentSource;
			},
			setDocumentSource: async (src) => {
				log('setDocumentSource', src);
				return true;
			},
		},
		sch_ManufactureData: {
			getNetlistFile: async (type) => {
				log('sch.getNetlistFile', type);
				return fileOf(state.schematicNetlist);
			},
		},
		pcb_ManufactureData: {
			getNetlistFile: async (type) => {
				log('pcb.getNetlistFile', type);
				return fileOf(state.pcbNetlist);
			},
		},
		sch_SelectControl: {
			getAllSelectedPrimitives: async () => {
				log('sch.getAllSelectedPrimitives', null);
				return state.selected;
			},
		},
		pcb_SelectControl: {
			getAllSelectedPrimitives: async () => {
				log('pcb.getAllSelectedPrimitives', null);
				return state.pcbSelected;
			},
		},
		sch_PrimitiveComponent: {
			getAllPinsByPrimitiveId: async (id) => {
				log('getAllPinsByPrimitiveId', id);
				return state.pins;
			},
		},
		dmt_SelectControl: {
			getCurrentDocumentInfo: async () => {
				log('getCurrentDocumentInfo', null);
				return { documentType: state.documentType, uuid: 'schuuid', parentProjectUuid: 'proj' };
			},
		},
		// 主仓入口在模块加载时注册快捷键，子仓没有这段；两边都要能跑，故一并 mock
		sys_ShortcutKey: {
			unregisterShortcutKey: () => log('unregisterShortcutKey', null),
			registerShortcutKey: async (...args) => log('registerShortcutKey', String(args[0])),
		},
		dmt_Board: { getCurrentBoardInfo: async () => ({ pcb: { uuid: 'pcbuuid' } }) },
		dmt_EditorControl: {
			getSplitScreenTree: async () => ({ tabs: [{ tabId: 'pcbuuid@proj' }, { tabId: 'schuuid@proj' }] }),
			activateDocument: async tabId => log('activateDocument', tabId),
		},
	};
}

/** V4 网表（带 components / pinInfoMap） */
const NET_V4 = JSON.stringify({
	version: '2.0.0',
	components: {
		uR1: { props: { Designator: 'R1' }, pinInfoMap: { 1: { net: 'GND' }, 2: { net: 'VCC' } } },
	},
});

/** 空白原理图源码（V4 头部 + 一行器件；签名只要求非空） */
const DOC_SOURCE = '{"version":"2.0.0","maxId":42}||';

/** 原理图侧：pin1 已有网络 GND，pin2 空着 → 只该补 pin2 的导线 */
const SCH_NET_V4 = JSON.stringify({
	version: '2.0.0',
	components: {
		uR1: { props: { Designator: 'R1' }, pinInfoMap: { 1: { net: 'GND' }, 2: { net: '' } } },
	},
});

const SCENARIOS = {
	'NET-缓存为空': {
		run: api => api.AutoWirePlacerNET(),
	},
	'NET-按缓存补导线': {
		storage: { AUTOWIRE_NETLIST_CACHE: NET_V4 },
		schematicNetlist: SCH_NET_V4,
		run: api => api.AutoWirePlacerNET(),
	},
	'PCB-按选中器件补导线': {
		schematicNetlist: SCH_NET_V4,
		pcbSelected: [{ primitiveType: 'Component', uniqueId: 'uR1', designator: 'R1', pads: [{ num: '1', net: 'GND' }, { num: '2', net: 'VCC' }] }],
		run: api => api.AutoWirePlacerPCB(),
	},
	'缓存-从文件更新': {
		fileText: NET_V4,
		run: api => api.UpdateNetlistCacheFromFile(),
	},
	'缓存-从PCB更新': {
		pcbNetlist: NET_V4,
		run: api => api.UpdateNetlistCacheFromPCB(),
	},
	'缓存-清空': {
		run: api => api.ClearNetlistCache(),
	},
	'打开页面-从PCB转原理图': {
		run: api => api.PcbToSch(),
	},
};

/** 默认场景状态 */
function defaultState(overrides) {
	const base = {
		rec: [],
		storage: {},
		fileText: NET_V4,
		schematicNetlist: SCH_NET_V4,
		pcbNetlist: NET_V4,
		documentSource: DOC_SOURCE,
		selected: [{ primitiveType: 'Component', uniqueId: 'uR1', designator: 'R1', primitiveId: 'e10' }],
		pcbSelected: [],
		pins: [
			{ pinNumber: '1', pinName: 'A', x: 100, y: 200, rotation: 0 },
			{ pinNumber: '2', pinName: 'B', x: 100, y: 300, rotation: 180 },
		],
		documentType: 1,
	};
	// rec 与 storage 不能共用：每个场景独立记录、独立存储
	return { ...base, ...overrides, rec: [], storage: { ...(overrides.storage || {}) } };
}

const results = {};
for (const [name, scenario] of Object.entries(SCENARIOS)) {
	const state = defaultState(scenario);
	const sandbox = { eda: makeEda(state), console: { log() {}, warn() {}, error() {} }, setTimeout, clearTimeout, Promise, performance, FileReader: class {} };
	sandbox.globalThis = sandbox;
	vm.createContext(sandbox);
	const code = fs.readFileSync(distPath, 'utf8');
	vm.runInContext(code, sandbox, { filename: 'dist/index.js' });
	const api = sandbox.edaEsbuildExportName;
	// 模块加载期的初始化（主仓会启动「工作时间」后台记录）不计入本场景
	state.rec.length = 0;

	let returned;
	try {
		returned = await scenario.run(api);
	}
	catch (error) {
		returned = { threw: String((error && error.message) || error) };
	}
	const plain = returned === undefined ? null : JSON.parse(JSON.stringify(returned));
	// 性能耗时因人而异，比对时剔除
	if (plain && plain.performance) {
		plain.performance = Object.keys(plain.performance).sort();
	}
	results[name] = { returned: plain, rec: state.rec, storageAfter: state.storage };
}

fs.writeFileSync(outPath, JSON.stringify(results, null, 1), 'utf8');
console.log(`已记录 ${Object.keys(results).length} 个场景 → ${outPath}`);
