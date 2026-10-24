/*
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展
 *
 * 只打包扩展入口（`dist/index.js`）。界面页面的源码在 `iframe/js/src/`，
 * 由独立的 `npm run build:iframe` 打包成 `iframe/js/app/PcbToSch.js`，不走这里。
 */

import type esbuild from 'esbuild';

export default {
	entryPoints: {
		index: './src/index',
	},
	entryNames: '[name]',
	assetNames: '[name]',
	bundle: true, // 用于内部方法调用，请勿修改
	minify: false, // 用于内部方法调用，请勿修改
	loader: {},
	outdir: './dist/',
	sourcemap: undefined,
	platform: 'browser', // 用于内部方法调用，请勿修改
	format: 'iife', // 用于内部方法调用，请勿修改
	globalName: 'edaEsbuildExportName', // 用于内部方法调用，请勿修改
	treeShaking: true,
	ignoreAnnotations: true,
	// 产物首行保留开发者署名（源码注释会被打包过程丢掉，必须在这里补）
	banner: {
		js: `/*!
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展
 */`,
	},
	define: {},
	external: [],
} satisfies Parameters<(typeof esbuild)['build']>[0];
