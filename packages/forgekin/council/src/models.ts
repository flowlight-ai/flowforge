/**
 * @flowforge/forgekin-council — 阶段7 T7.5 MindCouncil 跨厂商审议域
 *
 * 对齐 Python `forgemind/council.py`：CouncilChannel 跨厂商审议，含 push-back 权利。
 * 召集时机：高价值产出（≥0.85 质量线）、高风险域动作、跨厂商分歧仲裁。
 * 核心规则：同厂商一致意见折扣（防 groupthink），PASS 需 ≥2 个不同厂商。
 */
import { randomUUID } from 'node:crypto';

/** 审议裁决（对齐 council.py CouncilVerdict） */
export enum CouncilVerdict {
  PASS = 'pass',
  FAIL = 'fail',
  NEEDS_REVISION = 'needs_revision',
  ESCALATE = 'escalate',
}

/** 参与审议的 Forgekin 最小契约（对齐 council.py Forgekin.forgekin_id/vendor/name） */
export interface CouncilReviewer {
  readonly forgekinId: string;
  readonly vendor: string;
  readonly name?: string | undefined;
}

/** 单条审议意见（对齐 council.py CouncilReview） */
export interface CouncilReview {
  readonly reviewerId: string;
  readonly reviewerVendor: string;
  readonly verdict: CouncilVerdict;
  /** 0.0..1.0 */
  readonly score: number;
  readonly notes: string;
  readonly pushBackPoints: string[];
  readonly reviewedAt: string;
}

/** 审议会期（对齐 council.py CouncilSession） */
export interface CouncilSession {
  readonly sessionId: string;
  readonly artifact: string;
  readonly reviews: CouncilReview[];
  readonly finalVerdict: CouncilVerdict | undefined;
  readonly finalScore: number;
  readonly convenedAt: string;
  readonly closedAt: string | undefined;
}

/** 审议回调：reviewer 对 artifact 给出意见（reviewFn 契约） */
export type CouncilReviewFn = (reviewer: CouncilReviewer, artifact: string) => CouncilReview;

const hex12 = (): string => randomUUID().replaceAll('-', '').slice(0, 12);

export function makeCouncilReview(init: Partial<Omit<CouncilReview, 'reviewedAt'>> & Pick<CouncilReview, 'reviewerId' | 'reviewerVendor' | 'verdict' | 'score'>): CouncilReview {
  return {
    notes: '',
    pushBackPoints: [],
    reviewedAt: new Date().toISOString(),
    ...init,
  };
}

export function makeCouncilSession(init: Partial<Omit<CouncilSession, 'sessionId' | 'convenedAt'>> = {}): CouncilSession {
  return {
    sessionId: `cs-${hex12()}`,
    artifact: '',
    reviews: [],
    finalVerdict: undefined,
    finalScore: 0.0,
    convenedAt: new Date().toISOString(),
    closedAt: undefined,
    ...init,
  };
}
