export const BEAT_STEPS = 16;
export const BEAT_LANES = ["kick", "snare", "hat"] as const;
export const BEAT_PRESET_IDS = ["boom-bap", "stutter-trap", "double-time", "custom"] as const;
export const ROOM_MODES = ["talk", "cypher"] as const;

export type BeatLane = (typeof BEAT_LANES)[number];
export type BeatPresetId = (typeof BEAT_PRESET_IDS)[number];
export type RoomMode = (typeof ROOM_MODES)[number];
export type BeatGrid = Record<BeatLane, boolean[]>;

export interface BeatRoomState {
  mode: RoomMode;
  bpm: number;
  steps: BeatGrid;
  isPlaying: boolean;
  startedAtMs: number | null;
  updatedAtMs: number;
  updatedBy: string | null;
  presetId: BeatPresetId;
}

export interface BeatPreset {
  id: BeatPresetId;
  label: string;
  description: string;
  bpm: number;
  steps: BeatGrid;
}

const createEmptyLane = () => Array.from({ length: BEAT_STEPS }, () => false);

export const cloneBeatGrid = (grid: BeatGrid): BeatGrid => ({
  kick: [...grid.kick],
  snare: [...grid.snare],
  hat: [...grid.hat],
});

export const createEmptyBeatGrid = (): BeatGrid => ({
  kick: createEmptyLane(),
  snare: createEmptyLane(),
  hat: createEmptyLane(),
});

const withHits = (hits: Partial<Record<BeatLane, number[]>>): BeatGrid => {
  const grid = createEmptyBeatGrid();

  for (const lane of BEAT_LANES) {
    for (const step of hits[lane] ?? []) {
      if (step >= 0 && step < BEAT_STEPS) {
        grid[lane][step] = true;
      }
    }
  }

  return grid;
};

export const BEAT_PRESETS: BeatPreset[] = [
  {
    id: "boom-bap",
    label: "Boom Bap",
    description: "Classic head-nod pocket with a steady hat.",
    bpm: 92,
    steps: withHits({
      kick: [0, 7, 10],
      snare: [4, 12],
      hat: [0, 2, 4, 6, 8, 10, 12, 14],
    }),
  },
  {
    id: "stutter-trap",
    label: "Trap Stutter",
    description: "Sparse kick with busier hats for faster pockets.",
    bpm: 136,
    steps: withHits({
      kick: [0, 6, 10],
      snare: [4, 12],
      hat: [0, 2, 3, 5, 6, 8, 10, 11, 13, 14, 15],
    }),
  },
  {
    id: "double-time",
    label: "Double Time",
    description: "Tighter kick grid with a driving top line.",
    bpm: 160,
    steps: withHits({
      kick: [0, 3, 8, 11],
      snare: [4, 12],
      hat: [0, 1, 2, 3, 4, 6, 8, 9, 10, 11, 12, 14],
    }),
  },
];

export const DEFAULT_BEAT_PRESET = BEAT_PRESETS[0];

export const getBeatPreset = (presetId: BeatPresetId) =>
  BEAT_PRESETS.find((preset) => preset.id === presetId) ?? DEFAULT_BEAT_PRESET;

export const createDefaultBeatState = (): BeatRoomState => ({
  mode: "talk",
  bpm: DEFAULT_BEAT_PRESET.bpm,
  steps: cloneBeatGrid(DEFAULT_BEAT_PRESET.steps),
  isPlaying: false,
  startedAtMs: null,
  updatedAtMs: 0,
  updatedBy: null,
  presetId: DEFAULT_BEAT_PRESET.id,
});
