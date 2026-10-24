import fs from 'node:fs';
import path from 'node:path';

/**
 * 打包内容校验：既不能多，也不能少
 *
 * 五类「少」的检查，每一类都对应一种真实故障：
 *   1. 核心文件缺失 → 扩展装不上 / 广场详情页空白；
 *   2. `extension.json` 注册的函数在 `dist/index.js` 里找不到 → 菜单点下去没反应；
 *   3. `src/index.ts` 里 `openPage('X')` 但包里没有 `iframe/X.html` → 点开是空白窗口；
 *   4. HTML 引用的 js / css / png 不在包里 → 页面半残（图片 404、脚本不执行）；
 *   5. README / CHANGELOG 里的相对链接指向包外 → 广场详情页死链。
 *
 * 另有两条：包内不得出现白名单之外的无关文件；版本号必须与 `package.json` 一致。
 *
 * 为什么要有这个门禁：页面产物 `iframe/js/app/` 已不入库，只能由 `build:iframe` 生成。
 * 少跑一步就打出「能装但白屏」的坏包，而 zip 本身不会报错。
 */

/** 少了就是坏包。本仓没有 PRIVACY.md，故不列；界面只有一个 HTML，所以点名它 */
const CORE_REQUIRED = [
	'extension.json',
	'dist/index.js',
	'LICENSE',
	'README.md',
	'CHANGELOG.md',
	'iframe/PcbToSch.html',
	'iframe/js/app/PcbToSch.js',
	'iframe/css/common.css',
];

/** 由 JS 运行时拼路径引用，静态扫描不到，只能显式点名 */
const REQUIRED_IMAGES = ['images/logo.png', 'images/reward_qrcode.png', 'images/wx.png'];

/** 允许进入 .eext 的类别；一条都命不中的一律算「无关内容」 */
const ALLOW_RULES: Array<{ name: string; test: (rel: string) => boolean }> = [
	{ name: '扩展清单', test: rel => rel === 'extension.json' },
	{ name: '广场展示资源', test: rel => /^(?:LICENSE|README\.md|CHANGELOG\.md|PRIVACY\.md)$/.test(rel) },
	{ name: '扩展入口', test: rel => rel === 'dist/index.js' },
	{ name: '详情图片', test: rel => /^images\/[^/]+\.png$/.test(rel) },
	{ name: '多语言', test: rel => /^locales\/.+\.json$/.test(rel) },
	{ name: '页面', test: rel => /^iframe\/[^/]+\.html$/.test(rel) },
	{ name: '页面样式', test: rel => rel === 'iframe/css/common.css' },
	{ name: '页面产物', test: rel => /^iframe\/js\/app\/[^/]+\.js$/.test(rel) },
	{ name: '第三方库', test: rel => /^iframe\/js\/[^/]+\.js$/.test(rel) },
];

/** 只有这些后缀才需要校验文件是否存在 */
const ASSET_EXT = /\.(?:js|css|png|json)$/i;

/**
 * 路径统一成正斜杠（zip 内一律用 `/`）
 *
 * @param p - 任意路径
 * @returns 正斜杠形式
 */
function toPosix(p: string): string {
	return p.replaceAll('\\', '/');
}

/**
 * 把 HTML 里的资源引用解析成包内相对路径
 *
 * 支持三种形式：绝对（`/iframe/js/app/X.js`）、相对（`../images/wx.png`）、
 * 以及需要跳过的锚点 / data: / 外链。
 *
 * @param ref - 引用原文
 * @param htmlRel - HTML 在包内的相对路径
 * @returns 包内相对路径；不需要校验时返回 null
 */
function resolveRef(ref: string, htmlRel: string): string | null {
	const value = ref.trim();
	if (!value || value.startsWith('#') || value.startsWith('data:'))
		return null;
	if (/^[a-z][a-z0-9+.-]*:/i.test(value))
		return null;
	if (value.startsWith('/'))
		return value.slice(1);
	return toPosix(path.posix.normalize(path.posix.join(path.posix.dirname(htmlRel), value)));
}

/**
 * 取 HTML 里的全部静态资源引用
 *
 * @param html - HTML 原文
 * @returns 引用原文
 */
function refsOf(html: string): Array<string> {
	const out: Array<string> = [];
	const re = /(?:src|href|data-img)="([^"]+)"/g;
	let match = re.exec(html);
	while (match) {
		out.push(match[1]);
		match = re.exec(html);
	}
	return out;
}

/**
 * 取 `extension.json` 里注册的全部菜单函数名
 *
 * @param text - extension.json 原文
 * @returns 去重后的函数名
 */
function registerFnsOf(text: string): Array<string> {
	const out = new Set<string>();
	const re = /"registerFn"\s*:\s*"([^"]+)"/g;
	let match = re.exec(text);
	while (match) {
		out.add(match[1]);
		match = re.exec(text);
	}
	return [...out];
}

/**
 * 取入口源码里 `openPage('X')` 打开的全部页面名
 *
 * @param text - src/index.ts 原文
 * @returns 去重后的页面名
 */
function openPagesOf(text: string): Array<string> {
	const out = new Set<string>();
	const re = /openPage\(\s*['"]([^'"]+)['"]/g;
	let match = re.exec(text);
	while (match) {
		out.add(match[1]);
		match = re.exec(text);
	}
	return [...out];
}

/**
 * 文档里的相对链接 / 图片是否都能在包内解析
 *
 * @param doc - 文档在包内的相对路径
 * @param text - 文档原文
 * @param present - 包内文件集合
 * @returns 问题描述列表
 */
function docLinkProblems(doc: string, text: string, present: Set<string>): Array<string> {
	const problems: Array<string> = [];
	const re = /!?\[[^\]]*\]\(([^)\s]+)\)/g;
	let match = re.exec(text);
	while (match) {
		const ref = match[1].replace(/^\.\//, '');
		if (!/^[a-z][a-z0-9+.-]*:/i.test(ref) && !ref.startsWith('#') && !present.has(ref)) {
			problems.push(`${doc} 里的相对链接指向包外：${ref}`);
		}
		match = re.exec(text);
	}
	return problems;
}

/**
 * 校验打包清单，有问题直接抛错（`packaged` 阶段失败即不写 zip）
 *
 * @param files - 待打包文件清单（POSIX 相对路径）
 * @param root - 项目根目录，用于读 extension.json / src/index.ts / HTML / README 原文
 * @throws 存在任何「多打」或「少打」时抛出，消息里逐条列出
 */
export function assertPackContent(files: Array<string>, root: string): void {
	const problems: Array<string> = [];
	const present = new Set(files);

	// ---- 1. 无关内容 / 核心文件与必需图片缺失 ----
	const kinds = new Map<string, number>();
	for (const rel of files) {
		const kind = ALLOW_RULES.find(rule => rule.test(rel));
		if (kind)
			kinds.set(kind.name, (kinds.get(kind.name) || 0) + 1);
		else problems.push(`无关内容入包：${rel}`);
	}
	for (const rel of [...CORE_REQUIRED, ...REQUIRED_IMAGES]) {
		if (!present.has(rel))
			problems.push(`缺少必需文件：${rel}`);
	}

	// ---- 2. 菜单函数漏导出（改了名没同步，或忘了 export）----
	const extText = fs.readFileSync(path.join(root, 'extension.json'), 'utf8');
	const entryPath = path.join(root, 'dist', 'index.js');
	if (fs.existsSync(entryPath)) {
		const entryText = fs.readFileSync(entryPath, 'utf8');
		for (const fn of registerFnsOf(extText)) {
			if (!entryText.includes(fn))
				problems.push(`extension.json 注册了 ${fn}，但 dist/index.js 里找不到它`);
		}
	}

	// ---- 3. 打开的页面不在包里 ----
	const pageSrcPath = path.join(root, 'src', 'index.ts');
	if (fs.existsSync(pageSrcPath)) {
		const pageSrc = fs.readFileSync(pageSrcPath, 'utf8');
		for (const page of openPagesOf(pageSrc)) {
			if (!present.has(`iframe/${page}.html`))
				problems.push(`入口打开了 ${page}，但包里没有 iframe/${page}.html`);
		}
	}

	// ---- 4. 页面引用的静态资源不在包里 ----
	for (const rel of files) {
		if (!rel.startsWith('iframe/') || !rel.endsWith('.html'))
			continue;
		const html = fs.readFileSync(path.join(root, rel), 'utf8');
		for (const ref of refsOf(html)) {
			const target = resolveRef(ref, rel);
			if (!target || !ASSET_EXT.test(target))
				continue;
			if (!present.has(target))
				problems.push(`${rel} 引用了 ${ref}，但包里没有 ${target}`);
		}
	}

	// ---- 5. 文档里的相对链接指向包外 ----
	for (const doc of ['README.md', 'CHANGELOG.md']) {
		if (!present.has(doc))
			continue;
		problems.push(...docLinkProblems(doc, fs.readFileSync(path.join(root, doc), 'utf8'), present));
	}

	// ---- 6. 版本号必须与 package.json 一致（zip 名用的是 extension.json 的版本）----
	const pkgText = fs.readFileSync(path.join(root, 'package.json'), 'utf8');
	const pkgVersion = (JSON.parse(pkgText) as { version?: string }).version;
	const extVersion = (JSON.parse(extText) as { version?: string }).version;
	if (pkgVersion !== extVersion) {
		problems.push(`版本不一致：package.json=${String(pkgVersion)} / extension.json=${String(extVersion)}`);
	}

	if (problems.length > 0) {
		throw new Error(`打包内容校验未通过（${problems.length} 项）：\n${problems.map(p => `  - ${p}`).join('\n')}`);
	}

	const summary = [...kinds.entries()].map(([name, count]) => `${name} ${count}`).join(' / ');
	// eslint-disable-next-line no-console
	console.log(`check:eext — ${files.length} 个文件通过（${summary}）`);
}
