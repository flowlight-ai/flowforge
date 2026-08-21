/**
 * @flowforge/forgekin-magic-words — 魔法词最小带宽人类中断协议
 *
 * 对齐 Python `forgemind/magic_words.py`（roleagent.md Ch.3）：CVO 用一句
 * 短语即可中断 agent 的错误轨迹。仅当魔法词出现在「当前指令」中才触发，
 * 引用或历史提及不触发（调用方需保证只传当前指令）。
 */

/** 魔法词触发动作（对齐 MagicWordTrigger 枚举） */
export const MagicWordTrigger = {
  STOP_AND_AUDIT: 'stop_and_audit',
  STOP_AND_READ_SOURCE: 'stop_and_read_source',
  STOP_AND_SIGNOFF: 'stop_and_signoff',
  STOP_ALL_SIDE_EFFECTS: 'stop_all_side_effects',
  NONE: 'none',
} as const;

export type MagicWordTrigger = (typeof MagicWordTrigger)[keyof typeof MagicWordTrigger];

/** 一条魔法词定义（对齐 MagicWord frozen dataclass） */
export interface MagicWord {
  readonly phrase: string;
  readonly trigger: MagicWordTrigger;
  readonly description: string;
}

/** 内置魔法词表（对齐 MAGIC_WORDS） */
export const MAGIC_WORDS: readonly MagicWord[] = [
  {
    phrase: '第一性原理',
    trigger: MagicWordTrigger.STOP_AND_AUDIT,
    description: 'Stop and check if we are using complexity to compensate for ignorance.',
  },
  {
    phrase: '我能猜出来',
    trigger: MagicWordTrigger.STOP_AND_READ_SOURCE,
    description: 'Stop and read the source of truth; do not substitute inference for query.',
  },
  {
    phrase: '下次一定',
    trigger: MagicWordTrigger.STOP_AND_SIGNOFF,
    description: "Stop. Either do it now or sign off explicitly; no 'next time'.",
  },
  {
    phrase: '星星罐子',
    trigger: MagicWordTrigger.STOP_ALL_SIDE_EFFECTS,
    description: 'P0 irreversible risk. Immediately stop adding side effects.',
  },
];

/**
 * 检测当前指令中的第一个魔法词（对齐 detect_magic_word）。
 *
 * 有意采用简单子串匹配——调用方必须只传当前指令（非拼接历史），
 * 以免引用/历史提及误触发。
 */
export function detectMagicWord(instruction: string): MagicWord | null {
  if (!instruction) {
    return null;
  }
  for (const mw of MAGIC_WORDS) {
    if (instruction.includes(mw.phrase)) {
      return mw;
    }
  }
  return null;
}

/** 返回全部魔法词短语（对齐 all_phrases） */
export function allPhrases(): string[] {
  return MAGIC_WORDS.map((mw) => mw.phrase);
}
