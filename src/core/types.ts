/**
 * PCB Component structure
 */
export interface PcbComponent {
	compId?: string;
	uniqueId: string;
	supplierPart: string;
	designator: string;
	name: string;
	deviceUuid: string;
	footprintUuid: string;
	layer: string;
	x: number;
	y: number;
	rotation: number;
	deviceName: string;
	symbolUuid: string;
	symbolName: string;
	footprintName: string;
	pins: Record<string, string>; // pinNumber -> netName
	partCount?: number;
}

/**
 * Merged row for UI display
 */
export interface MergedComponentGroup {
	key: string;
	footprintName: string;
	deviceName: string;
	symbolName: string;
	designators: string[];
	names: string[];
	supplierParts: string[];
	componentIndices: number[];
	designatorDisplay: string;
	nameDisplay: string;
}

/**
 * Symbol Part information
 */
export interface SymbolPart {
	name: string;
	pins: Record<string, PinInfo>;
	pinBbox: [number, number, number, number]; // [minX, minY, maxX, maxY]
}

export interface PinInfo {
	x: number;
	y: number;
	angle: number;
}

/**
 * Builder options
 */
export interface BuildOptions {
	classify?: 'ref' | 'device' | 'pkg' | 'coord';
	genTitle?: boolean;
	genFrame?: boolean;
	genWire?: boolean;
	yvalue?: boolean;
	startX?: number;
	startY?: number;
	colSpacing?: number;
	rowSpacing?: number;
	perRow?: number;
	wireLength?: number;
}
