import type { BuildOptions, PcbComponent, SymbolPart } from './types';

export function buildSchSource(
	components: PcbComponent[],
	version: string,
	symbolPinsDatabase: Record<string, SymbolPart[]>,
	options: BuildOptions = {},
): string {
	const {
		classify = 'ref',
		genTitle = false,
		genFrame = false,
		genWire = false,
		yvalue = false,
		startX = 100,
		startY = -200,
		wireLength = 40,
	} = options;

	const lines: string[] = [];
	let idCounter = 1;

	// Grouping and sorting logic
	let groups: { name: string; items: PcbComponent[] }[] = [];

	if (classify === 'ref') {
		const refGroups: Record<string, PcbComponent[]> = {};
		components.forEach((comp) => {
			const match = comp.designator.match(/^([A-Za-z]+)/);
			const prefix = match ? match[1] : '其他';
			if (!refGroups[prefix])
				refGroups[prefix] = [];
			refGroups[prefix].push(comp);
		});
		Object.keys(refGroups).sort().forEach((prefix) => {
			refGroups[prefix].sort((a, b) => {
				const numA = parseInt((a.designator.match(/\d+/) || ['0'])[0]) || 0;
				const numB = parseInt((b.designator.match(/\d+/) || ['0'])[0]) || 0;
				return numA - numB;
			});
			groups.push({ name: prefix, items: refGroups[prefix] });
		});
	}
	else if (classify === 'device') {
		const deviceGroups: Record<string, PcbComponent[]> = {};
		components.forEach((comp) => {
			const deviceName = comp.deviceName || '未知器件';
			if (!deviceGroups[deviceName])
				deviceGroups[deviceName] = [];
			deviceGroups[deviceName].push(comp);
		});
		Object.keys(deviceGroups).sort().forEach((name) => {
			groups.push({ name, items: deviceGroups[name] });
		});
	}
	else if (classify === 'pkg') {
		const pkgGroups: Record<string, PcbComponent[]> = {};
		components.forEach((comp) => {
			const pkgName = comp.footprintName || '未知封装';
			if (!pkgGroups[pkgName])
				pkgGroups[pkgName] = [];
			pkgGroups[pkgName].push(comp);
		});
		Object.keys(pkgGroups).sort().forEach((name) => {
			groups.push({ name, items: pkgGroups[name] });
		});
	}
	else if (classify === 'coord') {
		groups = [{ name: '坐标布局', items: components }];
	}

	let currentTopY = startY;

	if (version.startsWith('2.2.')) {
		lines.push('["DOCTYPE","SCH","1.1"]');
		lines.push('["HEAD",{"originX":0,"originY":0,"version":"2","maxId":11517}]');
		lines.push('["FONTSTYLE","st1",null,null,null,null,null,null,null,null,null,null]');
		lines.push('["FONTSTYLE","st2",null,null,null,60,null,null,null,null,1,0]');
		lines.push('["LINESTYLE","st3",null,null,null,2,null]');
		lines.push('["LINESTYLE","st4",null,null,null,null,null]');

		groups.forEach((group) => {
			const items = group.items;
			if (items.length === 0)
				return;

			let minX = Infinity;
			let maxX = -Infinity;
			let minY = Infinity;
			let maxY = -Infinity;

			if (classify === 'coord') {
				items.forEach((comp) => {
					const partCount = comp.partCount || 1;
					for (let partIdx = 0; partIdx < partCount; partIdx++) {
						const compId = `e${idCounter++}`;
						const compName = symbolPinsDatabase[comp.symbolUuid]?.[partIdx]?.name || 'Part';
						const adjustedY = comp.y + 10 * partIdx;
						const outY = yvalue ? -adjustedY : adjustedY;
						lines.push(`["COMPONENT","${compId}","${compName}",${comp.x},${outY},0,0,{},0]`);

						lines.push(`["ATTR","e${idCounter++}","${compId}","Device","${comp.deviceUuid || ''}",0,0,null,null,null,"st1",0]`);
						lines.push(`["ATTR","e${idCounter++}","${compId}","Symbol","${comp.symbolUuid || ''}",0,0,null,null,null,"st1",0]`);
						lines.push(`["ATTR","e${idCounter++}","${compId}","Designator","${comp.designator || ''}",null,0,null,null,null,"st1",0]`);
						lines.push(`["ATTR","e${idCounter++}","${compId}","Name","${comp.name || ''}",null,0,null,null,null,"st1",0]`);
						lines.push(`["ATTR","e${idCounter++}","${compId}","Unique ID","${comp.uniqueId || ''}",0,0,null,null,null,"st1",0]`);

						if (genWire) {
							lines.push(...generateWires(comp, compId, comp.x, outY, version, wireLength, symbolPinsDatabase, partIdx));
						}
						minX = Math.min(minX, comp.x);
						maxX = Math.max(maxX, comp.x);
						minY = Math.min(minY, comp.y);
						maxY = Math.max(maxY, comp.y);
					}
				});
			}
			else {
				let lastRight: number | null = null;
				let minYThisRow = currentTopY;

				const partsList: { comp: PcbComponent; partIdx: number }[] = [];
				items.forEach((comp) => {
					const partCount = comp.partCount || 1;
					for (let partIdx = 0; partIdx < partCount; partIdx++) {
						partsList.push({ comp, partIdx });
					}
				});

				for (const item of partsList) {
					const { comp, partIdx } = item;
					const bbox = symbolPinsDatabase[comp.symbolUuid]?.[partIdx]?.pinBbox || [-20, -20, 20, 20];
					const [xmin, ymin, xmax, ymax] = bbox;

					let compX: number;
					if (lastRight === null) {
						compX = startX - xmin;
					}
					else {
						compX = lastRight + 40 - xmin;
					}
					const right = compX + xmax;

					if (right > 2560) {
						currentTopY = minYThisRow - 40;
						compX = startX - xmin;
						lastRight = compX + xmax;
						minYThisRow = currentTopY;
					}
					else {
						lastRight = right;
					}

					const compY = currentTopY - ymax;
					const absoluteBottomY = compY + ymin;
					if (absoluteBottomY < minYThisRow) {
						minYThisRow = absoluteBottomY;
					}

					const compId = `e${idCounter++}`;
					const compName = symbolPinsDatabase[comp.symbolUuid]?.[partIdx]?.name || 'Part';
					const outY = yvalue ? -compY : compY;

					lines.push(`["COMPONENT","${compId}","${compName}",${compX},${outY},0,0,{},0]`);
					lines.push(`["ATTR","e${idCounter++}","${compId}","Device","${comp.deviceUuid || ''}",0,0,null,null,null,"st1",0]`);
					lines.push(`["ATTR","e${idCounter++}","${compId}","Symbol","${comp.symbolUuid || ''}",0,0,null,null,null,"st1",0]`);
					lines.push(`["ATTR","e${idCounter++}","${compId}","Designator","${comp.designator || ''}",null,0,null,null,null,"st1",0]`);
					lines.push(`["ATTR","e${idCounter++}","${compId}","Name","${comp.name || ''}",null,0,null,null,null,"st1",0]`);
					lines.push(`["ATTR","e${idCounter++}","${compId}","Unique ID","${comp.uniqueId || ''}",0,0,null,null,null,"st1",0]`);

					if (genWire) {
						lines.push(...generateWires(comp, compId, compX, outY, version, wireLength, symbolPinsDatabase, partIdx));
					}

					minX = Math.min(minX, compX + xmin);
					maxX = Math.max(maxX, compX + xmax);
					minY = Math.min(minY, compY + ymin);
					maxY = Math.max(maxY, compY + ymax);
				}
			}

			const padding = 120;
			if (genFrame && minX !== Infinity) {
				const labelY = yvalue ? (-maxY - padding + 30) : (maxY + padding - 30);
				lines.push(`["TEXT","e${idCounter++}",${minX - padding + 10},${labelY},0,"${group.name}","st2",0]`);
			}

			if (classify !== 'coord') {
				currentTopY = minY - 200;
			}
		});
	}
	else if (version.startsWith('3.')) {
		const uniqueClient = `client_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;
		const uniqueUuid = `uuid_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;
		const timestamp = Date.now();

		lines.push(`{"type":"DOCHEAD"}||{"docType":"SCH_PAGE","client":"${uniqueClient}","uuid":"${uniqueUuid}","updateTime":${timestamp},"version":${timestamp}}|`);
		lines.push(`{"type":"CANVAS","ticket":${idCounter++},"id":"CANVAS"}||{"originX":0,"originY":0}|`);

		groups.forEach((group) => {
			const items = group.items;
			if (items.length === 0)
				return;

			let minX = Infinity;
			let maxX = -Infinity;
			let minY = Infinity;
			let maxY = -Infinity;

			if (classify === 'coord') {
				items.forEach((comp) => {
					const partCount = comp.partCount || 1;
					for (let partIdx = 0; partIdx < partCount; partIdx++) {
						const compTicket = idCounter++;
						const compId = `e${compTicket}`;
						const compName = symbolPinsDatabase[comp.symbolUuid]?.[partIdx]?.name || 'Part';
						const adjustedY = comp.y + 10 * partIdx;
						const outY = yvalue ? -adjustedY : adjustedY;

						lines.push(`{"type":"COMPONENT","ticket":${compTicket},"id":"${compId}"}||{"partId":"${compName}","x":${comp.x},"y":${outY},"rotation":0}|`);
						lines.push(`{"type":"ATTR","ticket":${idCounter++},"id":"e${idCounter - 1}"}||{"parentId":"${compId}","key":"Device","value":"${comp.deviceUuid || ''}"}|`);
						lines.push(`{"type":"ATTR","ticket":${idCounter++},"id":"e${idCounter - 1}"}||{"parentId":"${compId}","key":"Symbol","value":"${comp.symbolUuid || ''}"}|`);
						lines.push(`{"type":"ATTR","ticket":${idCounter++},"id":"e${idCounter - 1}"}||{"parentId":"${compId}","key":"Unique ID","value":"${comp.uniqueId || ''}"}|`);
						lines.push(`{"type":"ATTR","ticket":${idCounter++},"id":"e${idCounter - 1}"}||{"parentId":"${compId}","key":"Designator","value":"${comp.designator || ''}","rotation":0}|`);
						lines.push(`{"type":"ATTR","ticket":${idCounter++},"id":"e${idCounter - 1}"}||{"parentId":"${compId}","key":"Name","value":"${comp.name || ''}","rotation":0}|`);

						if (genWire) {
							lines.push(...generateWires(comp, compId, comp.x, outY, version, wireLength, symbolPinsDatabase, partIdx));
						}

						minX = Math.min(minX, comp.x);
						maxX = Math.max(maxX, comp.x);
						minY = Math.min(minY, comp.y);
						maxY = Math.max(maxY, comp.y);
					}
				});
			}
			else {
				let lastRight: number | null = null;
				let minYThisRow = currentTopY;

				const partsList: { comp: PcbComponent; partIdx: number }[] = [];
				items.forEach((comp) => {
					const partCount = comp.partCount || 1;
					for (let partIdx = 0; partIdx < partCount; partIdx++) {
						partsList.push({ comp, partIdx });
					}
				});

				for (const item of partsList) {
					const { comp, partIdx } = item;
					const bbox = symbolPinsDatabase[comp.symbolUuid]?.[partIdx]?.pinBbox || [-20, -20, 20, 20];
					const [xmin, ymin, xmax, ymax] = bbox;

					let compX: number;
					if (lastRight === null) {
						compX = startX - xmin;
					}
					else {
						compX = lastRight + 40 - xmin;
					}
					const right = compX + xmax;

					if (right > 2560) {
						currentTopY = minYThisRow - 40;
						compX = startX - xmin;
						lastRight = compX + xmax;
						minYThisRow = currentTopY;
					}
					else {
						lastRight = right;
					}

					const compY = currentTopY - ymax;
					const absoluteBottomY = compY + ymin;
					if (absoluteBottomY < minYThisRow) {
						minYThisRow = absoluteBottomY;
					}

					const compTicket = idCounter++;
					const compId = `e${compTicket}`;
					const compName = symbolPinsDatabase[comp.symbolUuid]?.[partIdx]?.name || 'Part';
					const outY = yvalue ? -compY : compY;

					lines.push(`{"type":"COMPONENT","ticket":${compTicket},"id":"${compId}"}||{"partId":"${compName}","x":${compX},"y":${outY},"rotation":0}|`);
					lines.push(`{"type":"ATTR","ticket":${idCounter++},"id":"e${idCounter - 1}"}||{"parentId":"${compId}","key":"Device","value":"${comp.deviceUuid || ''}"}|`);
					lines.push(`{"type":"ATTR","ticket":${idCounter++},"id":"e${idCounter - 1}"}||{"parentId":"${compId}","key":"Symbol","value":"${comp.symbolUuid || ''}"}|`);
					lines.push(`{"type":"ATTR","ticket":${idCounter++},"id":"e${idCounter - 1}"}||{"parentId":"${compId}","key":"Unique ID","value":"${comp.uniqueId || ''}"}|`);
					lines.push(`{"type":"ATTR","ticket":${idCounter++},"id":"e${idCounter - 1}"}||{"parentId":"${compId}","key":"Designator","value":"${comp.designator || ''}","rotation":0}|`);
					lines.push(`{"type":"ATTR","ticket":${idCounter++},"id":"e${idCounter - 1}"}||{"parentId":"${compId}","key":"Name","value":"${comp.name || ''}","rotation":0}|`);

					if (genWire) {
						lines.push(...generateWires(comp, compId, compX, outY, version, wireLength, symbolPinsDatabase, partIdx));
					}

					minX = Math.min(minX, compX + xmin);
					maxX = Math.max(maxX, compX + xmax);
					minY = Math.min(minY, compY + ymin);
					maxY = Math.max(maxY, compY + ymax);
				}
			}

			const padding = 120;
			if (genFrame && minX !== Infinity) {
				const titleTicket = idCounter++;
				const titleY = yvalue ? (-maxY - padding + 30) : (maxY + padding - 30);
				lines.push(`{"type":"TEXT","ticket":${titleTicket},"id":"e${titleTicket}"}||{"x":${minX - padding + 10},"y":${titleY},"value":"${group.name}","fontSize":60,"align":"LEFT_MIDDLE","rotation":0}|`);
			}

			if (classify !== 'coord') {
				currentTopY = minY - 200;
			}
		});

		if (lines.length > 0 && lines[lines.length - 1].endsWith('|')) {
			lines[lines.length - 1] = lines[lines.length - 1].slice(0, -1);
		}
	}

	return lines.join('\n');
}

function generateWires(
	comp: PcbComponent,
	compId: string,
	compX: number,
	compY: number,
	version: string,
	wireLength: number,
	symbolPinsDatabase: Record<string, SymbolPart[]>,
	partIdx = 0,
): string[] {
	const wireLines: string[] = [];
	const symbolParts = symbolPinsDatabase[comp.symbolUuid] || [];
	const symbolPart = symbolParts[partIdx] || symbolParts[0] || { pins: {} };
	const symbolPins = symbolPart.pins || {};

	let idCounter = 1000; // Local counter for wires, though in a real refactor we'd pass a global one

	Object.entries(comp.pins || {}).forEach(([pinNumber, netName]) => {
		if (!netName)
			return;
		const pinInfo = symbolPins[pinNumber];
		if (!pinInfo)
			return;

		const pinX = compX + pinInfo.x;
		let rawPinY: number;
		let y_sign = 1;

		if (version.startsWith('2.2.')) {
			rawPinY = compY + pinInfo.y;
			y_sign = 1;
		}
		else if (version.startsWith('3.')) {
			rawPinY = compY - pinInfo.y;
			y_sign = -1;
		}
		else {
			rawPinY = compY + pinInfo.y;
		}

		let endX = pinX;
		let rawEndY = rawPinY;
		let netT = 0;

		switch (pinInfo.angle) {
			case 0:
				endX = pinX - wireLength;
				rawEndY = rawPinY;
				netT = 0;
				break;
			case 90:
				endX = pinX;
				rawEndY = rawPinY - wireLength * y_sign;
				netT = 90;
				break;
			case 180:
				endX = pinX + wireLength;
				rawEndY = rawPinY;
				netT = 0;
				break;
			case 270:
				endX = pinX;
				rawEndY = rawPinY + wireLength * y_sign;
				netT = 90;
				break;
			default:
				endX = pinX - wireLength;
				rawEndY = rawPinY;
				netT = 0;
		}

		const centerX = (pinX + endX) / 2;
		const outCenterY = (rawPinY + rawEndY) / 2;

		if (version.startsWith('2.2.')) {
			const wireId = `ew${idCounter++}`;
			wireLines.push(`["WIRE","${wireId}",[[${pinX},${rawPinY},${endX},${rawEndY}]],"st1",0]`);
			wireLines.push(`["ATTR","ea${idCounter++}","${wireId}","NET","${netName}",0,1,${centerX},${outCenterY},${netT},"st1",0]`);
		}
		else if (version.startsWith('3.')) {
			const wireTicket = idCounter++;
			const lineTicket = idCounter++;
			const attrTicket = idCounter++;
			const wireId = `ew${wireTicket}`;

			wireLines.push(`{"type":"WIRE","ticket":${wireTicket},"id":"${wireId}"}||{"zIndex":1}|`);
			wireLines.push(`{"type":"LINE","ticket":${lineTicket},"id":"el${lineTicket}"}||{"lineGroup":"${wireId}","startX":${pinX},"startY":${rawPinY},"endX":${endX},"endY":${rawEndY}}|`);
			wireLines.push(`{"type":"ATTR","ticket":${attrTicket},"id":"ea${attrTicket}"}||{"parentId":"${wireId}","key":"NET","value":"${netName}","x":${centerX},"y":${outCenterY},"rotation":${netT},"keyVisible":false,"valueVisible":true}|`);
		}
	});
	return wireLines;
}
