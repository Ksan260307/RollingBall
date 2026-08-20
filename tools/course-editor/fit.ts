/**
 * Making a branch come back to the course it left.
 *
 * This is the hard part of a fork. Two stretches of track only rejoin if the
 * second one ends in the same place, at the same height, pointing the same
 * way as the first — three things at once, which nobody hits by writing
 * numbers in by hand.
 *
 * Toy railways solve it by making every piece an exact fraction of a circle,
 * so a handful of curves is guaranteed to bring you back round. The courses
 * here are written in plain metres and degrees instead, which is far nicer
 * to author with and gives no such guarantee. So the guarantee is put back
 * by searching: the author draws the interesting part of the branch, and the
 * last one or two stretches are worked out to close it.
 *
 * A workshop tool. Nothing here ships with the game; the game only checks
 * that a branch does close and quietly ignores one that does not.
 */

import type { CoursePiece } from '../../src/core/course';
import {
  type BranchGap,
  branchClearance,
  branchCloses,
  branchGap,
  poseAfter,
} from '../../src/game/stages';

/** How the closing stretches are allowed to look. */
const TURN_RANGE = 120;
const LENGTH_LOW = 6;
const LENGTH_HIGH = 34;

/**
 * How much a stretch may turn per metre and still be drivable, by width.
 *
 * Taken from the courses that already work: five and a half metres wide
 * takes five degrees a metre quite happily, while under three metres wants
 * about half of that. A narrow chute simply cannot be swung round hard.
 */
function comfortableTurn(width: number): number {
  return 1 + width * 0.75;
}

export interface FitResult {
  /** The whole branch, the author's part with the closing part added. */
  pieces: CoursePiece[];
  /** What is left of the gap once it is closed as well as it can be. */
  gap: BranchGap;
  /**
   * How much daylight is left between the two ways down, at their closest.
   *
   * Not something the search can chase — working it out means building both
   * courses, and the search tries thousands of shapes. It is measured once
   * at the end and reported, because a branch that closes perfectly and
   * runs straight through the middle of the road it left is not a fork, and
   * the author is the one who can move it.
   */
  clearance: number;
}

/**
 * Finds one or two stretches that bring a branch back to the main line.
 *
 * Searched coarsely and then finely around whatever came out best. The
 * whole thing is a few thousand tries, which is nothing for a button in an
 * editor and saves an afternoon of nudging numbers by hand.
 *
 * @param pieces the whole main course
 * @param branch what the author has drawn of the branch so far
 * @param from the first stretch of the main course being replaced
 * @param to the first stretch that is not replaced
 */
export function fitBranch(
  pieces: CoursePiece[],
  branch: CoursePiece[],
  from: number,
  to: number,
): FitResult {
  const drawn = branch.length > 0 ? branch : [{ length: 12, drop: 10, width: 4, walls: true }];
  // The connecting stretches are ordinary road, whatever the branch was.
  // Bringing a narrow chute back to the main line through more narrow chute
  // is asking for a corner nobody can take.
  const width = Math.max(6, drawn[drawn.length - 1].width ?? 4);
  const limit = comfortableTurn(width);

  // The closing stretches start out sloping like the rest of the branch, so
  // that settling the height afterwards is a nudge rather than a rebuild.
  const drawnLength = drawn.reduce((sum, piece) => sum + piece.length, 0) || 1;
  const drawnSlope =
    drawn.reduce((sum, piece) => sum + (piece.drop ?? 0) * piece.length, 0) / drawnLength;

  // Pointing the wrong way matters as much as being in the wrong place: a
  // branch that arrives beside the main line facing across it is no use.
  const score = (gap: BranchGap): number =>
    gap.apart + gap.height * 0.7 + gap.facing * 0.55;

  /**
   * How hard a closing stretch would be to actually get round.
   *
   * Closing the gap is only half of it. The first thing this search found
   * was a hundred degrees of turn in fourteen metres on a track under three
   * metres wide, which shuts exactly as neatly as it is impossible to
   * drive. Anything tighter than a gentle sweep is charged for here.
   */
  const drivable = (closers: CoursePiece[], allow: number): boolean =>
    closers.every(
      (piece) => Math.abs(piece.turn ?? 0) / Math.max(1, piece.length) <= allow,
    );

  let best: FitResult | null = null;
  let bestWorth = Number.POSITIVE_INFINITY;
  // Raised only if nothing gentle enough can be made to close: a branch that
  // shuts is worth more than one that is comfortable and open.
  let allow = limit;
  const consider = (closers: CoursePiece[]): void => {
    if (!drivable(closers, allow)) return;
    const whole = [...drawn, ...closers];
    const gap = branchGap(pieces, whole, from, to);
    const worth = score(gap);
    if (!best || worth < bestWorth) {
      // Clearance is filled in once, at the end, on the one that wins.
      best = { pieces: whole, gap, clearance: Number.POSITIVE_INFINITY };
      bestWorth = worth;
    }
  };

  /** Tries a grid of closing pairs, at the given coarseness. */
  const sweep = (
    turnFrom: number,
    turnTo: number,
    turnStep: number,
    lengthStep: number,
  ): void => {
    for (let turnA = turnFrom; turnA <= turnTo; turnA += turnStep) {
      for (let lengthA = LENGTH_LOW; lengthA <= LENGTH_HIGH; lengthA += lengthStep) {
        for (let turnB = turnFrom; turnB <= turnTo; turnB += turnStep) {
          for (let lengthB = LENGTH_LOW; lengthB <= LENGTH_HIGH; lengthB += lengthStep) {
            consider([
              { length: lengthA, turn: turnA, drop: drawnSlope, width, walls: true },
              { length: lengthB, turn: turnB, drop: drawnSlope, width, walls: true },
            ]);
          }
        }
      }
    }
  };

  // Gently first. If nothing gentle reaches, ask for progressively more.
  for (const relaxed of [limit, limit * 1.5, limit * 2.2, 99]) {
    allow = relaxed;
    best = null;
    bestWorth = Number.POSITIVE_INFINITY;
    sweep(-TURN_RANGE, TURN_RANGE, 20, 8);
    if (best && branchCloses((best as FitResult).gap)) break;
  }
  if (best) {
    // Then again, closely, around whatever the coarse pass liked.
    const [a, b] = (best as FitResult).pieces.slice(-2);
    for (let turnA = (a.turn ?? 0) - 22; turnA <= (a.turn ?? 0) + 22; turnA += 3) {
      for (let lengthA = Math.max(LENGTH_LOW, a.length - 9); lengthA <= a.length + 9; lengthA += 2) {
        for (let turnB = (b.turn ?? 0) - 22; turnB <= (b.turn ?? 0) + 22; turnB += 3) {
          for (
            let lengthB = Math.max(LENGTH_LOW, b.length - 9);
            lengthB <= b.length + 9;
            lengthB += 2
          ) {
            consider([
              { length: lengthA, turn: turnA, drop: drawnSlope, width, walls: true },
              { length: lengthB, turn: turnB, drop: drawnSlope, width, walls: true },
            ]);
          }
        }
      }
    }
  }

  const found = best as FitResult | null;
  if (!found) {
    return {
      pieces: drawn,
      gap: branchGap(pieces, drawn, from, to),
      clearance: branchClearance(pieces, drawn, from, to),
    };
  }

  // The height is settled last and on its own: it does not affect where the
  // branch comes out on the ground. The gap is then measured again, because
  // reporting the one from before the height was fixed would be reporting a
  // number that is no longer true.
  const settled = matchHeight(pieces, found.pieces, from, to);
  return {
    pieces: settled,
    gap: branchGap(pieces, settled, from, to),
    clearance: branchClearance(pieces, settled, from, to),
  };
}

/**
 * Settles the branch at the right height without flattening its shape.
 *
 * The height has to come out where the main line does. The way this used to
 * be done — give every stretch of the branch the same slope — did close it,
 * and cost the branch everything that made it worth taking: a plunge drawn
 * at the top came out the same gentle gradient as the run-out at the bottom.
 *
 * So the whole branch is tipped by one common amount instead. Steep bits
 * stay steeper than gentle ones, the shape the author drew survives, and it
 * still lands exactly where it has to. Tipping rather than scaling matters:
 * scaling would flatten a branch that already nearly fits and steepen one
 * that barely drops at all, which is backwards.
 */
function matchHeight(
  pieces: CoursePiece[],
  whole: CoursePiece[],
  from: number,
  to: number,
): CoursePiece[] {
  const wanted = -poseAfter(pieces.slice(from, to)).y;
  const total = whole.reduce((sum, piece) => sum + piece.length, 0) || 1;

  // Tipped a little at a time rather than solved: a turning stretch covers
  // less ground than its length, so how far a given tip actually drops is
  // not something worth working out in closed form.
  for (let attempt = 0; attempt < 60; attempt++) {
    const missing = -poseAfter(whole).y - wanted;
    if (Math.abs(missing) < 0.05) break;
    const change = (Math.atan2(missing, total) * 180) / Math.PI;
    for (const piece of whole) {
      piece.drop = Math.max(-45, Math.min(45, (piece.drop ?? 0) - change));
    }
  }
  return whole;
}

/** Says plainly how far out a branch is, for the editor to show. */
export function describeGap(gap: BranchGap): string {
  return `ずれ ${gap.apart.toFixed(2)}m ／ 高さ ${gap.height.toFixed(2)}m ／ 向き ${gap.facing.toFixed(1)}°`;
}

/** Says plainly how far the two ways down keep away from each other. */
export function describeClearance(clearance: number): string {
  if (!Number.isFinite(clearance)) return 'はなれ ―';
  if (clearance < 0) return `かさなり ${(-clearance).toFixed(1)}m ぶん`;
  return `はなれ ${clearance.toFixed(1)}m`;
}
