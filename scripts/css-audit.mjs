/**
 * CSS 裁剪前后「计算样式」对照工具（临时脚本，不参与构建）
 *
 * 做什么：把 iframe/css/common.css 内联进一个静态页面（= PcbToSch.html 的 DOM
 * + 动态类名的合成节点），用 headless Chrome 读回每个元素的计算样式快照。
 *
 * 为什么：CSS 裁剪只看 diff 不可靠，删掉一条被间接依赖的规则会让页面变形。
 * 同一份快照在裁剪前后各拍一次，逐属性比对即可确认「视觉零变化」。
 *
 * 用法：
 *   node scripts/css-audit.mjs snapshot baseline
 *   node scripts/css-audit.mjs snapshot pruned
 *   node scripts/css-audit.mjs compare baseline pruned
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = path.resolve(import.meta.dirname, '..');
const CSS_FILE = path.join(ROOT, 'iframe', 'css', 'common.css');
const OUT_DIR = path.join(ROOT, 'temp', 'css-audit');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

/** 需要追踪的计算属性（与视觉有关；排除 transition / animation 这类不改变静态外观的） */
const PROPS = [
	'display',
	'position',
	'flex-direction',
	'flex-wrap',
	'flex-grow',
	'flex-shrink',
	'flex-basis',
	'align-items',
	'align-self',
	'justify-content',
	'gap',
	'row-gap',
	'column-gap',
	'grid-template-columns',
	'grid-template-rows',
	'width',
	'height',
	'min-width',
	'min-height',
	'max-width',
	'max-height',
	'top',
	'right',
	'bottom',
	'left',
	'z-index',
	'overflow-x',
	'overflow-y',
	'margin-top',
	'margin-right',
	'margin-bottom',
	'margin-left',
	'padding-top',
	'padding-right',
	'padding-bottom',
	'padding-left',
	'border-top-width',
	'border-right-width',
	'border-bottom-width',
	'border-left-width',
	'border-top-style',
	'border-right-style',
	'border-bottom-style',
	'border-left-style',
	'border-top-color',
	'border-right-color',
	'border-bottom-color',
	'border-left-color',
	'border-top-left-radius',
	'border-top-right-radius',
	'border-bottom-left-radius',
	'border-bottom-right-radius',
	'background-color',
	'background-image',
	'color',
	'font-family',
	'font-size',
	'font-weight',
	'font-style',
	'line-height',
	'letter-spacing',
	'text-transform',
	'text-decoration-line',
	'text-align',
	'text-overflow',
	'white-space',
	'cursor',
	'box-shadow',
	'opacity',
	'visibility',
	'accent-color',
	'appearance',
	'box-sizing',
];

/** 参与快照的合成节点：覆盖 JS 动态加的类名与状态 */
const SYNTHETIC = `
<div class="p2s-rows" id="auditRows">
	<div class="grid-row" id="auditRow">
		<div class="row-cell" id="auditCell1">R1</div>
		<div class="row-cell" id="auditCell2">10k</div>
		<div class="row-cell" id="auditCell3">0603</div>
		<div class="row-cell" id="auditCell4">Resistor</div>
		<div class="row-cell" id="auditCell5">R.1</div>
		<div class="row-cell" id="auditCell6"><input class="manual-input" id="auditInput" type="text" placeholder="指定..." value=""></div>
	</div>
	<div class="grid-row row-error" id="auditRowError">
		<div class="row-cell">U1</div>
	</div>
	<div class="hidden" id="auditHidden">hidden</div>
</div>
<div class="status-bar accent" id="auditStatusBar">
	<div class="progress-bg accent" id="auditProgressBg"></div>
	<span class="status-text" id="auditStatusText">就绪</span>
</div>
<span class="status-text success" id="auditStatusTextOk">ok</span>
<span class="status-text error" id="auditStatusTextErr">err</span>
<span class="status-text warning" id="auditStatusTextWarn">warn</span>
<span class="status-text info" id="auditStatusTextInfo">info</span>
<div class="progress-bg error" id="auditProgressBgErr"></div>
<button class="btn-secondary" id="auditBtn2">次要</button>
<button id="auditBtn" disabled>主按钮</button>
<label class="p2s-item" id="auditLabel"><input type="checkbox" id="auditCheck" checked>勾选</label>
<input type="radio" id="auditRadio" name="auditRadio">
`;

/** 快照脚本（在页面里执行，结果写进 <pre id="audit-json">） */
const COLLECT_SCRIPT = `
(function () {
	const PROPS = ${JSON.stringify(PROPS)};
	const nodes = Array.from(document.querySelectorAll('[id], body, html')).filter(function (el) {
		return !el.closest('#audit-json-holder');
	});
	const out = {
		viewport: { w: window.innerWidth, h: window.innerHeight },
		nodes: {},
		cssVars: {},
	};
	const root = getComputedStyle(document.documentElement);
	for (const name of Array.from(root)) {
		if (name.startsWith('--vscode-')) out.cssVars[name] = root.getPropertyValue(name).trim();
	}
	for (const el of nodes) {
		const key = (el.tagName.toLowerCase()) + (el.id ? '#' + el.id : '') + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\\s+/).join('.') : '');
		const cs = getComputedStyle(el);
		const rec = {};
		for (const p of PROPS) rec[p] = cs.getPropertyValue(p);
		out.nodes[key] = rec;
	}
	const holder = document.createElement('pre');
	holder.id = 'audit-json';
	holder.textContent = JSON.stringify(out);
	document.body.appendChild(holder);
})();
`;

/**
 * 生成临时页面并抓取快照
 *
 * @param {string} label 快照名（用于文件名）
 * @param {string} [cssPath] 要用的样式文件（默认 iframe/css/common.css）
 * @returns {string} 快照文件路径
 */
function snapshot(label, cssPath = CSS_FILE) {
	fs.mkdirSync(OUT_DIR, { recursive: true });
	const css = fs.readFileSync(cssPath, 'utf8');
	const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="UTF-8">
<style>${css}</style>
</head>
<body class="app">
	<div class="p2s-header"><h1>PCB转原理图工具<span id="versionDisplay">v</span></h1></div>
	<div class="p2s-list">
		<div class="p2s-grid-head table-header" id="auditHead">
			<div class="header-cell">位号</div><div class="header-cell">名称</div><div class="header-cell">封装</div>
			<div class="header-cell">器件</div><div class="header-cell">匹配符号</div><div class="header-cell">指定符号</div>
		</div>
		<div class="p2s-rows" id="tableRows"></div>
	</div>
	<div class="p2s-bottom">
		<div class="p2s-options">
			<div class="p2s-option-group"><div class="p2s-group-title">分类</div>
				<div class="p2s-grid-2">
					<label class="p2s-item"><input type="radio" name="classify" value="device">按照器件分类</label>
					<label class="p2s-item"><input type="radio" name="classify" value="ref" checked>按照位号分类</label>
				</div>
			</div>
			<div class="p2s-option-group"><div class="p2s-group-title">更多选项</div>
				<div class="p2s-grid-2">
					<label class="p2s-item"><input type="checkbox" id="genTitle" checked>显示分类标题</label>
				</div>
			</div>
		</div>
		<div class="p2s-actions"><div class="p2s-buttons">
			<button class="btn-secondary" id="refreshListBtn">加载数据</button>
			<button id="writeBtn" disabled>写入文档</button>
		</div></div>
		<div class="status-bar accent" id="progressArea">
			<div class="progress-bg" id="progressFill"></div>
			<span class="status-text" id="progressText">就绪</span>
		</div>
	</div>
	${SYNTHETIC}
	<script>${COLLECT_SCRIPT}</script>
</body></html>`;
	const page = path.join(OUT_DIR, `page-${label}.html`);
	fs.writeFileSync(page, html, 'utf8');

	const dom = execFileSync(
		CHROME,
		['--headless=new', '--disable-gpu', '--no-sandbox', '--window-size=800,600', '--virtual-time-budget=3000', '--dump-dom', `file:///${page.replace(/\\/g, '/')}`],
		{ encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] },
	);
	const match = dom.match(/<pre id="audit-json">([\s\S]*?)<\/pre>/);
	if (!match)
		throw new Error('未取到快照：页面里没有 #audit-json');
	const json = match[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
	const parsed = JSON.parse(json);
	const out = path.join(OUT_DIR, `snapshot-${label}.json`);
	fs.writeFileSync(out, JSON.stringify(parsed, null, 1), 'utf8');
	console.log(`快照已写入 ${path.relative(ROOT, out)}（${Object.keys(parsed.nodes).length} 个节点，${Object.keys(parsed.cssVars).length} 个变量）`);
	return out;
}

/**
 * 比对两份快照
 *
 * @param {string} a 基线快照名
 * @param {string} b 对照快照名
 * @returns {void}
 */
function compare(a, b) {
	const A = JSON.parse(fs.readFileSync(path.join(OUT_DIR, `snapshot-${a}.json`), 'utf8'));
	const B = JSON.parse(fs.readFileSync(path.join(OUT_DIR, `snapshot-${b}.json`), 'utf8'));
	let diffCount = 0;
	const keys = new Set([...Object.keys(A.nodes), ...Object.keys(B.nodes)]);
	for (const key of keys) {
		const na = A.nodes[key];
		const nb = B.nodes[key];
		if (!na || !nb) {
			console.log(`✗ 节点差异：${key}（${a}: ${!!na} / ${b}: ${!!nb}）`);
			diffCount++;
			continue;
		}
		for (const p of PROPS) {
			if (na[p] !== nb[p]) {
				console.log(`✗ ${key} · ${p}: ${JSON.stringify(na[p])} → ${JSON.stringify(nb[p])}`);
				diffCount++;
			}
		}
	}
	console.log(diffCount === 0 ? `✓ 计算样式完全一致（${keys.size} 个节点 × ${PROPS.length} 条属性）` : `共 ${diffCount} 处差异`);
}

const [cmd, a, b] = process.argv.slice(2);
if (cmd === 'snapshot')
	snapshot(a, b);
else if (cmd === 'compare')
	compare(a, b);
else console.log('用法：node scripts/css-audit.mjs snapshot <label> [cssPath] | compare <a> <b>');
