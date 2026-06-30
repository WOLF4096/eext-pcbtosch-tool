import { ProjectService } from './core/project-service';
import { parsePcbContent } from './core/pcb-parser';
import { buildSchSource } from './core/sch-builder';
import type { BuildOptions, MergedComponentGroup, PcbComponent, SymbolPart } from './core/types';

// Expose core functions to the global scope for the iframe
(window as any).PcbToSchCore = {
	ProjectService,
	parsePcbContent,
	buildSchSource,
	mergeComponentsForDisplay(components: PcbComponent[]): MergedComponentGroup[] {
		const groups = new Map<string, MergedComponentGroup>();
		components.forEach((comp, index) => {
			const key = `${comp.footprintUuid}|${comp.deviceUuid}`;
			if (!groups.has(key)) {
				groups.set(key, {
					key,
					footprintName: comp.footprintName,
					deviceName: comp.deviceName,
					symbolName: comp.symbolName,
					designators: [],
					names: [],
					supplierParts: [],
					componentIndices: [],
					designatorDisplay: '',
					nameDisplay: '',
				});
			}
			const group = groups.get(key)!;
			group.designators.push(comp.designator);
			group.names.push(comp.name);
			group.supplierParts.push(comp.supplierPart);
			group.componentIndices.push(index);
		});

		return Array.from(groups.values()).map((group) => {
			group.designatorDisplay = group.designators.join(',');
			group.nameDisplay = Array.from(new Set(group.names)).join(',');
			return group;
		}).sort((a, b) => {
			const nameA = (a.footprintName || '').toLowerCase();
			const nameB = (b.footprintName || '').toLowerCase();
			return nameA.localeCompare(nameB);
		});
	},
};
