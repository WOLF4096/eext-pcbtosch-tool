/**
 * 行为记录对照（临时脚本，不参与构建）
 *
 * 比对 `scripts/entry-behavior.mjs` 为「主仓产物」与「子仓产物」记录的调用序列。
 *
 * 归一化掉的噪声（与功能无关，每次运行必然不同）：
 *   - 日志里的耗时数字（`总耗时: 1.01s，平均一条导线耗时: 1011.06ms`）；
 *   - 网表缓存元信息里的 `savedAt` 时间戳；
 *   - 主仓入口独有的快捷键注册、以及主仓其它功能写的用户配置。
 *
 * 用法：node scripts/compare-behavior.mjs <主仓记录.json> <子仓记录.json>
 */
import fs from 'node:fs';
import process from 'node:process';

const [parentPath, childPath] = process.argv.slice(2);
const A = JSON.parse(fs.readFileSync(parentPath, 'utf8'));
const B = JSON.parse(fs.readFileSync(childPath, 'utf8'));

/** 只保留「创建导线 / PCB 转原理图」相关的用户配置键 */
const CACHE_KEYS = new Set(['AUTOWIRE_NETLIST_CACHE', 'AUTOWIRE_NETLIST_CACHE_META']);

/**
 * 归一化一条调用记录
 *
 * @param {object} entry 原始记录
 * @returns {object|null} 归一化后的记录；null 表示与本功能无关、丢弃
 */
function normalize(entry) {
	if (entry.call === 'unregisterShortcutKey' || entry.call === 'registerShortcutKey')
		return null;
	if (['storage.get', 'storage.set', 'storage.delete'].includes(entry.call)) {
		const key = entry.detail && entry.detail.key !== undefined ? entry.detail.key : entry.detail;
		return CACHE_KEYS.has(key) ? entry : null;
	}
	if (entry.call === 'log') {
		const msg = entry.detail && entry.detail.msg;
		if (typeof msg !== 'string' || !/导线|网表/.test(msg))
			return null;
		return { call: 'log', detail: { msg: msg.replace(/\d+(\.\d+)?\s*(ms|s)\b/g, '<耗时>'), level: entry.detail.level } };
	}
	return entry;
}

/**
 * 归一化整个场景
 *
 * @param {object} scenario 场景记录
 * @returns {object} 可比较的场景记录
 */
function normalizeScenario(scenario) {
	const rec = scenario.rec.map(normalize).filter(Boolean);
	const storage = { ...scenario.storageAfter };
	if (storage.AUTOWIRE_NETLIST_CACHE_META) {
		const meta = JSON.parse(storage.AUTOWIRE_NETLIST_CACHE_META);
		meta.savedAt = '<时间戳>';
		storage.AUTOWIRE_NETLIST_CACHE_META = JSON.stringify(meta);
	}
	return { rec, storage };
}

let diffs = 0;
for (const name of Object.keys(A)) {
	const a = normalizeScenario(A[name]);
	const b = normalizeScenario(B[name]);
	const sameRec = JSON.stringify(a.rec) === JSON.stringify(b.rec);
	const sameStorage = JSON.stringify(a.storage) === JSON.stringify(b.storage);
	if (sameRec && sameStorage) {
		console.log(`✓ ${name}（${a.rec.length} 条调用）`);
		continue;
	}
	diffs++;
	console.log(`✗ ${name}`);
	if (!sameRec) {
		const len = Math.max(a.rec.length, b.rec.length);
		for (let i = 0; i < len; i++) {
			const ja = JSON.stringify(a.rec[i]);
			const jb = JSON.stringify(b.rec[i]);
			if (ja !== jb) {
				console.log(`  首处差异 #${i}\n    主仓: ${ja}\n    子仓: ${jb}`);
				break;
			}
		}
	}
	if (!sameStorage)
		console.log(`  存储差异\n    主仓: ${JSON.stringify(a.storage)}\n    子仓: ${JSON.stringify(b.storage)}`);
}
console.log(diffs === 0 ? '\n全部场景行为一致' : `\n共 ${diffs} 处差异`);
process.exitCode = diffs === 0 ? 0 : 1;
