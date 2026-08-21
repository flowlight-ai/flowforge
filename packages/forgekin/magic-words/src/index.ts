/**
 * @flowforge/forgekin-magic-words — 阶段7 T7.14 魔法词域 Cordis 插件
 *
 * 挂载 `ctx.forgeMagicWords`：CVO 最小带宽人类中断协议（4 条魔法短语 →
 * stop-and-audit 触发动作），对齐 Python `forgemind/magic_words.py`。
 */
import { Context, Service } from '@flowforge/cordis';
import {
  allPhrases,
  detectMagicWord,
  MAGIC_WORDS,
  MagicWord,
} from './magic-words.js';

export * from './magic-words.js';

declare module '@flowforge/cordis' {
  interface Context {
    /** 魔法词域：CVO 人类中断协议 */
    forgeMagicWords: MagicWordsService;
  }
}

export class MagicWordsService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'forgeMagicWords');
  }

  /** 内置魔法词只读列表 */
  get words(): readonly MagicWord[] {
    return MAGIC_WORDS;
  }

  /** 检测当前指令中的第一个魔法词（无则 null） */
  detect(instruction: string): MagicWord | null {
    return detectMagicWord(instruction);
  }

  /** 全部魔法词短语 */
  phrases(): string[] {
    return allPhrases();
  }

  /** 快照（trace 日志） */
  snapshot(): { count: number; phrases: string[] } {
    return { count: MAGIC_WORDS.length, phrases: allPhrases() };
  }
}

export default function Plugin(ctx: Context) {
  return ctx.plugin(MagicWordsService);
}
