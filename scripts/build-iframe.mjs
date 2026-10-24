/**
 * @//module/ scripts/build-iframe
 * @//description/ 把 iframe/js/src 下的 ESM 源码打包成 iframe/js/app/PcbToSch.js（单文件 IIFE）
 * @//exports/ 无（构建脚本）
 * @//dependencies/ esbuild, node:fs, node:path
 * @//example/ npm run build:iframe
 *            npm run watch:iframe
 *
 * 为什么必须打包：EDA 宿主把 iframe 页面的每个 <script src> 内联成**无 MIME 的 blob URL**，
 * 且 blob 基址无法做相对解析 —— 原生 ESM（`import './x.js'`）在这个环境里不可用。
 * 所以源码用 ESM 写、构建期合并成单文件 IIFE，HTML 里只需要一行 <script src>。
 *
 * 产物文件名 = 页面名（`iframe/js/app/PcbToSch.js`），HTML 不需要跟着改。
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import esbuild from 'esbuild';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC_DIR = path.join(ROOT, 'iframe', 'js', 'src');
const OUT_DIR = path.join(ROOT, 'iframe', 'js', 'app');

/**
 * 页面 → 源码入口映射
 *
 * 键 = 产物文件名（= HTML 里 `<script src="/iframe/js/app/<键>.js">` 的名字，不能改）；
 * 值 = `iframe/js/src/` 下的页面编排入口。
 */
const PAGES = {
	PcbToSch: 'app/pcb-to-sch/index.js',
	About: 'app/about/index.js',
};

/** 产物首行横幅：开发者署名 + 提醒这是生成物 */
const BANNER = `/*!
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展
 *
 * 由 npm run build:iframe 从 iframe/js/src 生成，请勿直接修改本文件
 */`;

/** 扩展版本号（构建期常量，页面需要时可读 `__APP_VERSION__`） */
const PKG_VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;

/**
 * 两种模式共用的 esbuild 配置
 *
 * @param {Record<string, string>} entryPoints 入口表
 * @param {import('esbuild').LogLevel} logLevel 日志级别
 * @returns {import('esbuild').BuildOptions} 配置
 */
function sharedOptions(entryPoints, logLevel) {
	return {
		entryPoints,
		outdir: OUT_DIR,
		entryNames: '[name]',
		bundle: true,
		format: 'iife',
		platform: 'browser',
		target: ['chrome100'],
		minify: false,
		sourcemap: false,
		charset: 'utf8',
		logLevel,
		banner: { js: BANNER },
		define: { __APP_VERSION__: JSON.stringify(`v${PKG_VERSION}`) },
	};
}

/**
 * 收集本次要构建的入口
 *
 * @returns {Record<string, string>} esbuild 入口表
 * @throws {Error} 入口源码缺失时抛出（避免"构建成功但产物没更新"的假象）
 * @sideEffects 读文件系统
 */
function collectEntries() {
	const entryPoints = {};
	for (const [page, rel] of Object.entries(PAGES)) {
		const abs = path.join(SRC_DIR, rel);
		if (!fs.existsSync(abs)) {
			throw new Error(`build:iframe — 入口源码缺失：${abs}`);
		}
		entryPoints[page] = abs;
	}
	return entryPoints;
}

/** 主流程 */
async function main() {
	const watch = process.argv.includes('--watch');
	const entryPoints = collectEntries();
	const names = Object.keys(entryPoints);

	if (watch) {
		const ctx = await esbuild.context(sharedOptions(entryPoints, 'info'));
		await ctx.watch();
		process.stdout.write(`build:iframe --watch 已启动（${names.join(', ')}）\n`);
		return;
	}

	await esbuild.build(sharedOptions(entryPoints, 'warning'));
	const sizes = names.map((name) => {
		const file = path.join(OUT_DIR, `${name}.js`);
		const kb = fs.existsSync(file) ? (fs.statSync(file).size / 1024).toFixed(0) : '?';
		return `${name}(${kb}KB)`;
	});
	process.stdout.write(`build:iframe — 已构建 ${names.length} 个：${sizes.join(' ')}\n`);
}

await main();
