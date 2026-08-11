/**
 * councilPanelStore - 群聊面板共享状态
 *
 * CouncilChatPanel 与 WorkspacePanel 之间的状态桥梁。
 * CouncilChatPanel 通过 syncState() 同步 useCouncilChat 状态，
 * WorkspacePanel 的"智能体"/"上下文" Tab 从此 store 读取。
 */

import { create } from "zustand";
import type {
  ForgekinRosterItem,
  CouncilMessage,
  CouncilConfig,
  ForgekinRole,
} from "@/lib/council-types";

interface CouncilPanelState {
  roster: ForgekinRosterItem[];
  messages: CouncilMessage[];
  config: CouncilConfig;
  mutedIds: string[];
  activeVoteQuestion: string | null;
  threadId: string | null;
  toggleParticipant: ((id: string) => void) | null;
  setForgekinRole: ((id: string, role: ForgekinRole) => void) | null;
  toggleMute: ((id: string) => void) | null;
  syncState: (partial: Partial<Omit<CouncilPanelState, "syncState" | "reset">>) => void;
  reset: () => void;
}

const emptyHandlers = {
  toggleParticipant: null,
  setForgekinRole: null,
  toggleMute: null,
};

export const useCouncilPanelStore = create<CouncilPanelState>((set) => ({
  roster: [],
  messages: [],
  config: { participantIds: [], roleAssignment: {}, maxRounds: 1, enableT7Audit: false },
  mutedIds: [],
  activeVoteQuestion: null,
  threadId: null,
  ...emptyHandlers,
  syncState: (partial) => set(partial),
  reset: () => set({ roster: [], messages: [], mutedIds: [], activeVoteQuestion: null, threadId: null, ...emptyHandlers }),
}));
