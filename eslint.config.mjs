import antfu from '@antfu/eslint-config';

/*
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展
 *
 * ignores 里那两个例外目录是有意为之：
 *   - `iframe/js/**`：页面源码与产物来自「狼黑工具」主仓（ESM + 4 空格缩进的 prettier 风格），
 *     本仓保持**逐字节一致**，才能靠整目录拷贝同步；一旦按本仓规则重排，diff 就永远对不上。
 *   - `src/js/**`：同上（autoWire / common 两个模块）。
 * 因此这两个目录不做 lint，需要检查时回主仓跑。
 */
export default antfu({
	stylistic: {
		indent: 'tab',
		quotes: 'single',
		semi: true,
	},

	typescript: true,

	ignores: [
		'build/dist/',
		'coverage/',
		'dist/',
		'node_modules/',
		'.eslintcache',
		'debug.log',
		// 与主仓保持一致的移植代码 / 构建产物 / 第三方库
		'iframe/js/**',
		'src/js/**',
	],
});
