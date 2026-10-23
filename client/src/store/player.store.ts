import { create } from 'zustand';

export interface PlayerController {
  seek: (sourceTime: number, play?: boolean) => void;
  play: () => void;
  pause: () => void;
}

interface PlayerState {
  /** Current playback position on the source timeline (seconds). */
  sourceTime: number;
  playing: boolean;
  controller: PlayerController | null;
  setTime: (time: number) => void;
  setPlaying: (playing: boolean) => void;
  register: (controller: PlayerController | null) => void;
  seek: (sourceTime: number, play?: boolean) => void;
}

/** Bridges the video player with sibling panels (transcript, chapters, AI chat) that need to read or move the playhead. */
export const usePlayerStore = create<PlayerState>((set, get) => ({
  sourceTime: 0,
  playing: false,
  controller: null,
  setTime: (sourceTime) => set({ sourceTime }),
  setPlaying: (playing) => set({ playing }),
  register: (controller) => set({ controller }),
  seek: (sourceTime, play = true) => get().controller?.seek(sourceTime, play),
}));
