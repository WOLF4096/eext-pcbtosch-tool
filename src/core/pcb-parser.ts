import type { PcbComponent } from './types';

/**
 * Parses PCB content from an .epcb file string
 */
export function parsePcbContent(pcbContent: string): PcbComponent[] {
	const components = new Map<string, PcbComponent>();
	const lines = pcbContent.split('\n');

	for (const line of lines) {
		if (!line.trim())
			continue;
		try {
			const data = JSON.parse(line);
			const type = data[0];

			if (type === 'COMPONENT') {
				const compId = data[1];
				const props = data[7] || {};
				const uniqueId = props['Unique ID'] || '';
				const supplierPart = props['Supplier Part'] || '';
				const layer = data[3];
				const x = data[4];
				const y = data[5];
				const rotation = data[6];

				components.set(compId, {
					compId,
					uniqueId,
					supplierPart,
					designator: '',
					name: '',
					deviceUuid: '',
					footprintUuid: '',
					layer,
					x,
					y,
					rotation,
					deviceName: '',
					symbolUuid: '',
					symbolName: '',
					footprintName: '',
					pins: {},
				});
			}
			else if (type === 'ATTR') {
				const compId = data[3];
				const attrName = data[7];
				const attrValue = data[8];
				const comp = components.get(compId);
				if (comp) {
					switch (attrName) {
						case 'Designator':
							comp.designator = attrValue;
							break;
						case 'Name':
							comp.name = attrValue;
							break;
						case 'Device':
							comp.deviceUuid = attrValue;
							break;
						case 'Footprint':
							comp.footprintUuid = attrValue;
							break;
					}
				}
			}
			else if (type === 'PAD_NET') {
				const compId = data[1];
				const pinNumber = data[2];
				const netName = data[3];
				const comp = components.get(compId);
				if (comp) {
					comp.pins[pinNumber] = netName;
				}
			}
		}
		catch (e) {
			// Ignore parse errors for individual lines
		}
	}
	return Array.from(components.values());
}
