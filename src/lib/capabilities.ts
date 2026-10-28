import type { Capability, Equipment, Profile, SupportEquipment } from '../types';

const EQUIPMENT_CAPABILITY: Record<Equipment, Capability | null> = {
  Barbell: 'barbell',
  Dumbbell: 'dumbbell',
  Machine: 'machine',
  Cable: 'cable',
  Kettlebell: 'kettlebell',
  Bodyweight: null,
};

const SUPPORT_CAPABILITY: Record<SupportEquipment, Capability> = {
  Bench: 'bench',
  Rack: 'rack',
  'Pull-up bar': 'pull-up-bar',
  'Dip bars': 'dip-bars',
  Box: 'box',
  'Ab wheel': 'ab-wheel',
};

const CAPABILITY_SUPPORT: Partial<Record<Capability, SupportEquipment>> = {
  bench: 'Bench',
  rack: 'Rack',
  'pull-up-bar': 'Pull-up bar',
  'dip-bars': 'Dip bars',
  box: 'Box',
  'ab-wheel': 'Ab wheel',
};

const CAPABILITY_EQUIPMENT: Partial<Record<Capability, Equipment>> = {
  barbell: 'Barbell',
  dumbbell: 'Dumbbell',
  machine: 'Machine',
  cable: 'Cable',
  kettlebell: 'Kettlebell',
};

const CAPABILITY_LABEL: Record<Capability, string> = {
  barbell: 'Barbell',
  dumbbell: 'Dumbbell',
  machine: 'Machine',
  cable: 'Cable',
  kettlebell: 'Kettlebell',
  bench: 'Bench',
  rack: 'Rack',
  'pull-up-bar': 'Pull-up bar',
  'dip-bars': 'Dip bars',
  box: 'Box',
  'ab-wheel': 'Ab wheel',
};

export function supportForCapability(capability: Capability): SupportEquipment | undefined {
  return CAPABILITY_SUPPORT[capability];
}

export function equipmentForCapability(capability: Capability): Equipment | undefined {
  return CAPABILITY_EQUIPMENT[capability];
}

export function capabilityLabel(capability: Capability): string {
  return CAPABILITY_LABEL[capability];
}

/** Resolve everything the profile can actually provide. */
export function capabilitiesFor(profile: Profile): Set<Capability> {
  const caps = new Set<Capability>();
  for (const item of profile.equipment) {
    const cap = EQUIPMENT_CAPABILITY[item];
    if (cap) caps.add(cap);
  }
  for (const item of profile.support) {
    caps.add(SUPPORT_CAPABILITY[item]);
  }
  return caps;
}

export function provides(caps: Set<Capability>, needs: Capability[]): boolean {
  return needs.every((need) => caps.has(need));
}

export function missingCapabilities(caps: Set<Capability>, needs: Capability[]): Capability[] {
  return needs.filter((need) => !caps.has(need));
}
