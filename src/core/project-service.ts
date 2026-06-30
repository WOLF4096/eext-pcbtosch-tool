import type { PcbComponent, SymbolPart } from './types';
import JSZip from 'jszip';

export class ProjectService {
	private zip: JSZip | null = null;
	private projectJson: any = null;

	async loadProject(eproFile: ArrayBuffer | Blob): Promise<any> {
		this.zip = await JSZip.loadAsync(eproFile);
		const projectJsonContent = await this.zip.file('project.json')?.async('string');
		if (!projectJsonContent) {
			throw new Error('project.json not found in project file');
		}
		this.projectJson = JSON.parse(projectJsonContent);
		return this.projectJson;
	}

	getProjectJson() {
		return this.projectJson;
	}

	getZip() {
		return this.zip;
	}

	findUuids(currentSheetUuid: string): { schematicUuid: string; pcbUuid: string } {
		if (!this.projectJson)
			throw new Error('Project not loaded');

		let schematicUuid: string | null = null;
		for (const [uuid, schematic] of Object.entries<any>(this.projectJson.schematics)) {
			const sheet = schematic.sheets.find((s: any) => s.uuid === currentSheetUuid);
			if (sheet) {
				schematicUuid = uuid;
				break;
			}
		}
		if (!schematicUuid)
			throw new Error('Schematic UUID not found');

		let pcbUuid: string | null = null;
		for (const board of Object.values<any>(this.projectJson.boards)) {
			if (board.schematic === schematicUuid) {
				pcbUuid = board.pcb;
				break;
			}
		}
		if (!pcbUuid)
			throw new Error('PCB UUID not found');

		return { schematicUuid, pcbUuid };
	}

	async getPcbContent(pcbUuid: string): Promise<string> {
		if (!this.zip)
			throw new Error('Project zip not loaded');
		const pcbFilePath = `PCB/${pcbUuid}.epcb`;
		const pcbFile = this.zip.file(pcbFilePath);
		if (!pcbFile) {
			throw new Error(`PCB file not found: ${pcbFilePath}`);
		}
		return await pcbFile.async('string');
	}

	enrichWithSymbol(components: PcbComponent[]) {
		if (!this.projectJson)
			return;

		for (const comp of components) {
			if (comp.deviceUuid && this.projectJson.devices[comp.deviceUuid]) {
				const device = this.projectJson.devices[comp.deviceUuid];
				comp.deviceName = device.title || '';
				comp.symbolUuid = device.attributes?.Symbol || '';
				if (comp.symbolUuid && this.projectJson.symbols[comp.symbolUuid]) {
					comp.symbolName = this.projectJson.symbols[comp.symbolUuid].title || '';
				}
			}

			if (comp.footprintUuid && this.projectJson.footprints[comp.footprintUuid]) {
				comp.footprintName = this.projectJson.footprints[comp.footprintUuid].title || '';
			}
		}
	}

	async parseSymbolFile(symbolUuid: string): Promise<SymbolPart[]> {
		if (!this.zip)
			return [];
		const symbolPath = `SYMBOL/${symbolUuid}.esym`;
		const symbolFile = this.zip.file(symbolPath);
		if (!symbolFile)
			return [];

		const content = await symbolFile.async('string');
		const lines = content.split('\n');
		const parts: SymbolPart[] = [];
		let currentPart: SymbolPart | null = null;
		let pinById: Record<string, any> = {};

		for (const line of lines) {
			if (!line.trim())
				continue;
			try {
				const data = JSON.parse(line);
				const type = data[0];

				if (type === 'PART') {
					if (currentPart) {
						this.finalizePart(currentPart, pinById);
						parts.push(currentPart);
					}
					currentPart = { name: data[1], pins: {}, pinBbox: [0, 0, 0, 0] };
					pinById = {};
				}
				else if (type === 'PIN' && currentPart) {
					pinById[data[1]] = { x: data[4], y: data[5], angle: data[7], number: null };
				}
				else if (type === 'ATTR' && currentPart) {
					if (data[3] === 'NUMBER' && pinById[data[2]]) {
						pinById[data[2]].number = data[4];
					}
				}
			}
			catch (e) {}
		}

		if (currentPart) {
			this.finalizePart(currentPart, pinById);
			parts.push(currentPart);
		}
		return parts;
	}

	private finalizePart(part: SymbolPart, pinById: Record<string, any>) {
		let minX = Infinity;
		let maxX = -Infinity;
		let minY = Infinity;
		let maxY = -Infinity;
		let hasPin = false;

		for (const pin of Object.values(pinById)) {
			if (pin.number) {
				part.pins[pin.number] = { x: pin.x, y: pin.y, angle: pin.angle };
				minX = Math.min(minX, pin.x);
				maxX = Math.max(maxX, pin.x);
				minY = Math.min(minY, pin.y);
				maxY = Math.max(maxY, pin.y);
				hasPin = true;
			}
		}

		if (hasPin) {
			part.pinBbox = [minX - 40, minY - 40, maxX + 40, maxY + 40];
		}
		else {
			part.pinBbox = [-20, -20, 20, 20];
		}
	}
}
