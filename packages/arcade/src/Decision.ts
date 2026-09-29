/** Quorum, revised votes, ties, revotes, and people leaving mid-decision. */

export type VoterId = string | number;
export type TiePolicy = 'revote';

export interface DecisionOptions<Option extends string> {
  readonly eligible: readonly VoterId[];
  readonly options: readonly Option[];
  readonly quorum: number;
  readonly tie: TiePolicy;
}

export type DecisionResult<Option extends string> =
  | { readonly status: 'awaiting'; readonly votes: number; readonly quorum: number }
  | { readonly status: 'decided'; readonly option: Option; readonly votes: number; readonly quorum: number }
  | { readonly status: 'revote'; readonly options: readonly Option[]; readonly votes: number; readonly quorum: number }
  | { readonly status: 'empty'; readonly votes: 0; readonly quorum: 0 };

export interface Decision<Option extends string> {
  cast(voter: VoterId, option: Option): DecisionResult<Option>;
  leave(voter: VoterId): DecisionResult<Option>;
  join(voter: VoterId): DecisionResult<Option>;
  beginRevote(): DecisionResult<Option>;
  result(): DecisionResult<Option>;
  readonly votes: ReadonlyMap<VoterId, Option>;
}

export function openDecision<Option extends string>(options: DecisionOptions<Option>): Decision<Option> {
  if (options.options.length < 2 || new Set(options.options).size !== options.options.length) {
    throw new Error('decision.open: at least two unique options are required');
  }
  if (!Number.isInteger(options.quorum) || options.quorum < 1) {
    throw new Error('decision.open: quorum must be a positive integer');
  }
  if (options.tie !== 'revote') throw new Error(`decision.open: unknown tie policy ${JSON.stringify(options.tie)}`);

  const eligible = new Set(options.eligible);
  const votes = new Map<VoterId, Option>();
  let roundOptions = [...options.options];

  const result = (): DecisionResult<Option> => {
    const quorum = Math.min(options.quorum, eligible.size);
    if (quorum === 0) return { status: 'empty', votes: 0, quorum: 0 };
    if (votes.size < quorum) return { status: 'awaiting', votes: votes.size, quorum };
    const counts = new Map<Option, number>(roundOptions.map((option) => [option, 0]));
    for (const option of votes.values()) counts.set(option, (counts.get(option) ?? 0) + 1);
    const best = Math.max(...counts.values());
    const tied = roundOptions.filter((option) => counts.get(option) === best);
    if (tied.length > 1) return { status: 'revote', options: tied, votes: votes.size, quorum };
    return { status: 'decided', option: tied[0]!, votes: votes.size, quorum };
  };

  return {
    cast(voter, option) {
      if (!eligible.has(voter)) throw new Error(`decision.open: ${JSON.stringify(voter)} is not eligible`);
      if (!roundOptions.includes(option)) throw new Error(`decision.open: ${JSON.stringify(option)} is not in this round`);
      votes.set(voter, option);
      return result();
    },
    leave(voter) {
      eligible.delete(voter);
      votes.delete(voter);
      return result();
    },
    join(voter) {
      eligible.add(voter);
      return result();
    },
    beginRevote() {
      const current = result();
      if (current.status !== 'revote') return current;
      roundOptions = [...current.options];
      votes.clear();
      return result();
    },
    result,
    votes,
  };
}
