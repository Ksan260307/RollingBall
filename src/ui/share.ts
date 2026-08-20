/**
 * Keeping a ball, and handing one to somebody else.
 *
 * Two things live here. The shelf is a list of balls put away under names,
 * kept on this device. Sharing turns the ball into a web address and draws
 * that address as a square somebody else can point a camera at, so a ball
 * can cross the gap between two phones without either of them signing in
 * anywhere or sending anything to anybody.
 *
 * The square is drawn from the address itself. Nothing is uploaded and no
 * service is involved: what is on the screen is the ball.
 */

import qrcode from 'qrcode-generator';
import { button, clear, el } from './dom';
import { TEXT } from './text';
import { recipeLink, writeRecipe } from '../game/recipe';
import { type KeptBall, SHELF_LIMIT, dropBall, keepBall, loadShelf } from '../game/storage';
import type { BallDesign } from '../game/storage';

/** How many squares across the picture is drawn, at most. */
const PICTURE_SIZE = 260;

export interface ShareActions {
  /** The ball as it stands right now. */
  current(): BallDesign;
  /** Puts a ball on the workbench, having been chosen or pasted. */
  use(recipe: string): void;
}

export class SharePanel {
  readonly root: HTMLElement;

  private readonly shelfList: HTMLElement;
  private readonly codeBox: HTMLTextAreaElement;
  private readonly picture: HTMLElement;
  private readonly notice: HTMLElement;
  private readonly nameBox: HTMLInputElement;
  private readonly actions: ShareActions;
  private shelf: KeptBall[] = [];

  constructor(actions: ShareActions) {
    this.actions = actions;
    this.shelfList = el('div', { class: 'shelf-list' });
    this.picture = el('div', { class: 'share-picture' });
    this.notice = el('p', { class: 'share-notice' });
    this.nameBox = el('input', {
      class: 'share-name',
      attrs: { type: 'text', maxlength: '24', placeholder: TEXT.recipeName },
    }) as HTMLInputElement;
    this.codeBox = el('textarea', {
      class: 'share-code',
      attrs: { rows: '3', spellcheck: 'false', 'aria-label': TEXT.recipeCode },
    }) as HTMLTextAreaElement;

    this.root = el(
      'div',
      { class: 'share-panel is-hidden' },
      el(
        'div',
        { class: 'share-inner' },
        el(
          'div',
          { class: 'share-head' },
          el('h2', { text: TEXT.recipeTitle }),
          button(TEXT.close, () => this.close(), 'ghost'),
        ),
        el('p', { class: 'share-hint', text: TEXT.recipeHint }),
        el(
          'div',
          { class: 'share-row' },
          this.nameBox,
          button(TEXT.recipeKeep, () => this.keep()),
        ),
        this.shelfList,
        el('h3', { text: TEXT.recipeShare }),
        this.picture,
        this.codeBox,
        el(
          'div',
          { class: 'share-row' },
          button(TEXT.recipeCopy, () => void this.copy()),
          button(TEXT.recipeUse, () => this.usePasted(), 'primary'),
        ),
        this.notice,
      ),
    );
  }

  /** Opens the panel, showing the ball as it stands. */
  open(): void {
    this.shelf = loadShelf();
    this.notice.textContent = '';
    this.nameBox.value = '';
    this.buildShelf();
    void this.showCurrent();
    this.root.classList.remove('is-hidden');
  }

  close(): void {
    this.root.classList.add('is-hidden');
  }

  get showing(): boolean {
    return !this.root.classList.contains('is-hidden');
  }

  /** Draws the square and fills the box with the address it stands for. */
  private async showCurrent(): Promise<void> {
    const design = this.actions.current();
    const link = await recipeLink(design, window.location.href);
    this.codeBox.value = link;
    this.drawPicture(link);
  }

  /**
   * Draws the address as a square of black and white cells.
   *
   * The size is chosen to fit the address: the more there is to carry, the
   * finer the cells. If it will not fit at all the square is left out and
   * the address is still there to be copied, which is the honest answer
   * rather than a picture nobody's camera can read.
   */
  private drawPicture(link: string): void {
    clear(this.picture);
    try {
      const code = qrcode(0, 'M');
      code.addData(link);
      code.make();
      const across = code.getModuleCount();
      const cell = Math.max(2, Math.floor(PICTURE_SIZE / (across + 2)));
      const edge = cell;
      const size = across * cell + edge * 2;

      const canvas = el('canvas', { attrs: { width: String(size), height: String(size) } });
      const paper = (canvas as HTMLCanvasElement).getContext('2d');
      if (!paper) throw new Error('nothing to draw on');
      // White all over first: the quiet border round the outside is part of
      // the pattern, not decoration, and a camera needs it.
      paper.fillStyle = '#ffffff';
      paper.fillRect(0, 0, size, size);
      paper.fillStyle = '#000000';
      for (let row = 0; row < across; row++) {
        for (let column = 0; column < across; column++) {
          if (code.isDark(row, column)) {
            paper.fillRect(edge + column * cell, edge + row * cell, cell, cell);
          }
        }
      }
      this.picture.append(canvas);
    } catch {
      this.picture.append(el('p', { class: 'share-notice', text: TEXT.recipeTooBig }));
    }
  }

  /** The list of balls put away, with a way to bring each one back. */
  private buildShelf(): void {
    clear(this.shelfList);
    if (this.shelf.length === 0) {
      this.shelfList.append(el('p', { class: 'share-notice', text: TEXT.recipeShelfEmpty }));
      return;
    }
    for (const kept of this.shelf) {
      this.shelfList.append(
        el(
          'div',
          { class: 'shelf-row' },
          el('span', { class: 'shelf-name', text: kept.name }),
          button(TEXT.recipeOpen, () => {
            this.actions.use(kept.recipe);
            this.close();
          }),
          button(TEXT.recipeDrop, () => {
            this.shelf = dropBall(kept.name);
            this.buildShelf();
          }, 'ghost'),
        ),
      );
    }
  }

  /** Puts the ball on the workbench away under whatever it has been called. */
  private keep(): void {
    void (async () => {
      const recipe = await writeRecipe(this.actions.current());
      const name = this.nameBox.value.trim() || `${TEXT.recipeName} ${this.shelf.length + 1}`;
      this.shelf = keepBall(name, recipe);
      this.nameBox.value = '';
      this.buildShelf();
      this.say(this.shelf.length >= SHELF_LIMIT ? TEXT.recipeShelfFull : TEXT.recipeKept);
    })();
  }

  private async copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.codeBox.value);
      this.say(TEXT.recipeCopied);
    } catch {
      // Where the clipboard is off limits, selecting it is the next best.
      this.codeBox.select();
      this.say(TEXT.recipeCopyByHand);
    }
  }

  /** Takes whatever is in the box and tries to make a ball of it. */
  private usePasted(): void {
    const held = this.codeBox.value.trim();
    if (held.length === 0) {
      this.say(TEXT.recipeUnreadable);
      return;
    }
    this.actions.use(held);
  }

  /** Says something, briefly. */
  say(words: string): void {
    this.notice.textContent = words;
  }
}
