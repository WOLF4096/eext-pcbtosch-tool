import path from 'node:path';
import fs from 'fs-extra';
import ignore from 'ignore';
import JSZip from 'jszip';

import * as extensionConfig from '../extension.json';
import { assertPackContent } from './assert-content';

/**
 * 将多行字符串拆分成字符串数组
 *
 * @param str - 多行字符串
 * @returns 字符串数组
 */
function multiLineStrToArray(str: string): Array<string> {
	return str.split(/[\r\n]+/);
}

/**
 * 检查 UUID 是否合法
 *
 * @param uuid - UUID
 * @returns 是否合法
 */
function testUuid(uuid?: string): uuid is string {
	const regExp = /^[a-z0-9]{32}$/;
	if (uuid && uuid !== '00000000000000000000000000000000') {
		return regExp.test(uuid.trim());
	}
	else {
		return false;
	}
}

/**
 * 获取正确的 UUID
 *
 * @param uuid - UUID
 * @returns UUID
 */
function fixUuid(uuid?: string): string {
	uuid = uuid?.trim() || undefined;
	if (testUuid(uuid)) {
		return uuid.trim();
	}
	else {
		return crypto.randomUUID().replaceAll('-', '');
	}
}

/**
 * 主逻辑方法
 */
function main() {
	if (!testUuid(extensionConfig.uuid)) {
		const newExtensionConfig = { ...extensionConfig };
		// @ts-expect-error - Removing default property from extension config
		delete newExtensionConfig.default;
		newExtensionConfig.uuid = fixUuid(extensionConfig.uuid);
		fs.writeJsonSync(path.join(__dirname, '../extension.json'), newExtensionConfig, { spaces: '\t', EOL: '\n', encoding: 'utf-8' });
	}
	const filepathListWithoutFilter = fs.readdirSync(path.join(__dirname, '../'), { encoding: 'utf-8', recursive: true });
	const edaignoreListWithoutResolve = multiLineStrToArray(fs.readFileSync(path.join(__dirname, '../.edaignore'), { encoding: 'utf-8' }));
	const edaignoreList: Array<string> = [];
	for (const edaignoreLine of edaignoreListWithoutResolve) {
		if (edaignoreLine.endsWith('/') || edaignoreLine.endsWith('\\')) {
			edaignoreList.push(edaignoreLine.slice(0, edaignoreLine.length - 1));
		}
		else {
			edaignoreList.push(edaignoreLine);
		}
	}
	const edaignore = ignore().add(edaignoreList);
	const filepathListWithoutResolve = edaignore.filter(filepathListWithoutFilter);
	const fileList: Array<string> = [];
	const folderList: Array<string> = []; // 无用数据
	for (const filepath of filepathListWithoutResolve) {
		if (fs.lstatSync(filepath).isFile()) {
			fileList.push(filepath.replace(/\\/g, '/'));
		}
		else {
			folderList.push(filepath.replace(/\\/g, '/'));
		}
	}

	// 写 zip 之前先校验清单：少了产物 / 多了无关文件都会在这里失败，
	// 避免打出「能装但白屏」的坏包。详见 assert-content.ts。
	assertPackContent(fileList, path.join(__dirname, '..'));

	const zip = new JSZip();
	for (const file of fileList) {
		zip.file(file, fs.createReadStream(path.join(__dirname, '..', file)));
	}

	// 压缩等级：1 (速度最快) 到 9 (压缩率最高)
	zip.generateNodeStream({
		type: 'nodebuffer',
		streamFiles: true,
		compression: 'DEFLATE',
		compressionOptions: {
			level: 9,
		},
	}).pipe(
		fs.createWriteStream(path.join(__dirname, 'dist', `${extensionConfig.name}_v${extensionConfig.version}.eext`)),
	);
}

main();
