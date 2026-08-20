/**
 * The menus: the title, the course list, how to play, the settings, the
 * pause panel and the results.
 *
 * Each screen is a plain block of HTML that is shown or hidden. The game
 * itself carries on drawing behind them, which is why the title screen has a
 * course rolling past in the background.
 */

import { RunSummary } from '../game/session';
import { STAGES, Stage, courseMetres } from '../game/stages';
import { Records, Settings } from '../game/storage';
import { button, clear, el, slider, toggle } from './dom';
import { TEXT, difficultyDots, formatSpeed, formatTime } from './text';

export type ScreenName =
  | 'title'
  | 'stages'
  | 'howto'
  | 'settings'
  | 'editor'
  | 'result'
  | 'pause'
  | 'none';

export interface ScreenActions {
  onPlay(): void;
  onCustomise(): void;
  onHowTo(): void;
  onSettings(): void;
  onChooseStage(stage: Stage): void;
  onBackToTitle(): void;
  onRetry(): void;
  onNextStage(): void;
  onWatchAgain(): void;
  onBackToStages(): void;
  onResume(): void;
  onSettingsChange(settings: Settings): void;
  onClearRecords(): void;
}

export class Screens {
  readonly root: HTMLElement;
  private readonly panels = new Map<ScreenName, HTMLElement>();
  private readonly stageList: HTMLElement;
  private readonly resultBody: HTMLElement;
  private readonly settingsBody: HTMLElement;
  private current: ScreenName = 'title';

  constructor(
    private readonly actions: ScreenActions,
    private settings: Settings,
  ) {
    this.stageList = el('div', { class: 'stage-list' });
    this.resultBody = el('div', { class: 'result-body' });
    this.settingsBody = el('div', { class: 'panel-body' });

    this.root = el('div', { class: 'screens', id: 'screens' });
    this.panels.set('title', this.buildTitle());
    this.panels.set('stages', this.buildStages());
    this.panels.set('howto', this.buildHowTo());
    this.panels.set('settings', this.buildSettings());
    this.panels.set('result', this.buildResult());
    this.panels.set('pause', this.buildPause());
    for (const panel of this.panels.values()) this.root.append(panel);
    this.show('title');
  }

  private buildTitle(): HTMLElement {
    return el(
      'section',
      { class: 'screen screen-title' },
      el(
        'div',
        { class: 'title-card' },
        // Two deliberate lines rather than one long one: the title is wider
        // than a phone screen at any readable size, and left to itself it
        // breaks in the middle of a word.
        el(
          'h1',
          { class: 'title' },
          el('span', { class: 'title-lead', text: TEXT.titleLead }),
          el('span', { class: 'title-main', text: TEXT.titleMain }),
        ),
        el('p', { class: 'tagline', text: TEXT.tagline }),
        el(
          'div',
          { class: 'title-buttons' },
          button(TEXT.play, () => this.actions.onPlay(), 'primary'),
          button(TEXT.customise, () => this.actions.onCustomise()),
          button(TEXT.howTo, () => this.actions.onHowTo()),
          button(TEXT.settings, () => this.actions.onSettings(), 'wide'),
        ),
      ),
    );
  }

  private buildStages(): HTMLElement {
    return el(
      'section',
      { class: 'screen screen-panel' },
      el(
        'div',
        { class: 'panel' },
        el(
          'header',
          { class: 'panel-head' },
          el('h2', { text: TEXT.chooseStage }),
          button(TEXT.back, () => this.actions.onBackToTitle(), 'ghost'),
        ),
        this.stageList,
      ),
    );
  }

  private buildHowTo(): HTMLElement {
    return el(
      'section',
      { class: 'screen screen-panel' },
      el(
        'div',
        { class: 'panel' },
        el(
          'header',
          { class: 'panel-head' },
          el('h2', { text: TEXT.howToTitle }),
          button(TEXT.back, () => this.actions.onBackToTitle(), 'ghost'),
        ),
        el(
          'div',
          { class: 'panel-body' },
          ...TEXT.howToBody.map((line) => el('p', { class: 'howto-line', text: line })),
        ),
      ),
    );
  }

  private buildSettings(): HTMLElement {
    this.refreshSettings();
    return el(
      'section',
      { class: 'screen screen-panel' },
      el(
        'div',
        { class: 'panel' },
        el(
          'header',
          { class: 'panel-head' },
          el('h2', { text: TEXT.settings }),
          button(TEXT.back, () => this.actions.onBackToTitle(), 'ghost'),
        ),
        this.settingsBody,
      ),
    );
  }

  private refreshSettings(): void {
    clear(this.settingsBody);
    const change = (): void => this.actions.onSettingsChange({ ...this.settings });
    this.settingsBody.append(
      slider(TEXT.settingsZoom, 0.5, 2, 0.05, this.settings.zoom, (value) => {
        this.settings.zoom = value;
        change();
      }),
      toggle(TEXT.settingsRich, this.settings.richGraphics, (value) => {
        this.settings.richGraphics = value;
        change();
      }),
      toggle(TEXT.settingsSound, this.settings.sound, (value) => {
        this.settings.sound = value;
        change();
      }),
      toggle(TEXT.settingsInvert, this.settings.invertPush, (value) => {
        this.settings.invertPush = value;
        change();
      }),
      toggle(TEXT.settingsGhost, this.settings.ghost, (value) => {
        this.settings.ghost = value;
        change();
      }),
      toggle(TEXT.settingsLean, this.settings.leanButtons, (value) => {
        this.settings.leanButtons = value;
        change();
      }),
      button(TEXT.settingsClear, () => {
        this.actions.onClearRecords();
        const note = el('p', { class: 'note', text: TEXT.settingsCleared });
        this.settingsBody.append(note);
        window.setTimeout(() => note.remove(), 2000);
      }, 'ghost'),
    );
  }

  private buildResult(): HTMLElement {
    return el('section', { class: 'screen screen-panel' }, this.resultBody);
  }

  private buildPause(): HTMLElement {
    return el(
      'section',
      { class: 'screen screen-panel' },
      el(
        'div',
        { class: 'panel panel-narrow' },
        el('header', { class: 'panel-head' }, el('h2', { text: TEXT.paused })),
        el(
          'div',
          { class: 'panel-body' },
          button(TEXT.resume, () => this.actions.onResume(), 'primary'),
          button(TEXT.retry, () => this.actions.onRetry()),
          button(TEXT.backToTitle, () => this.actions.onBackToTitle(), 'ghost'),
        ),
      ),
    );
  }

  /** Rebuilds the course list, including each best time. */
  setStages(records: Records): void {
    clear(this.stageList);
    for (const stage of STAGES) {
      const best = records[stage.id];
      const card = el(
        'button',
        {
          class: 'stage-card',
          attrs: { type: 'button' },
          on: { click: () => this.actions.onChooseStage(stage) },
        },
        el('div', {
          class: 'stage-swatch',
          attrs: {
            style: `background: linear-gradient(160deg, ${stage.mood.sky}, ${stage.mood.edge})`,
          },
        }),
        el(
          'div',
          { class: 'stage-info' },
          el('h3', { class: 'stage-name', text: stage.name }),
          el('p', { class: 'stage-blurb', text: stage.blurb }),
          el(
            'div',
            { class: 'stage-facts' },
            el('span', { text: `${TEXT.difficulty} ${difficultyDots(stage.difficulty)}` }),
            el('span', { text: `${TEXT.length} ${courseMetres(stage)}m` }),
            el('span', {
              text: `${TEXT.bestTime} ${best === undefined ? TEXT.noRecord : formatTime(best)}`,
            }),
          ),
        ),
      );
      this.stageList.append(card);
    }
  }

  /** Fills in the results screen after a run. */
  setResult(summary: RunSummary, stage: Stage, best: number | undefined, isBest: boolean): void {
    clear(this.resultBody);
    const hasNext = STAGES.findIndex((s) => s.id === stage.id) < STAGES.length - 1;
    const won = summary.finished;
    this.resultBody.append(
      el(
        'div',
        { class: `panel panel-narrow ${won ? 'is-win' : 'is-lose'}` },
        el(
          'header',
          { class: 'panel-head' },
          el('h2', { text: won ? TEXT.finished : TEXT.stuckOver }),
        ),
        el(
          'div',
          { class: 'panel-body' },
          won
            ? el(
                'div',
                { class: 'result-time' },
                el('span', { class: 'result-time-label', text: TEXT.yourTime }),
                el('span', { class: 'result-time-value', text: formatTime(summary.seconds) }),
              )
            : el('p', { class: 'note', text: TEXT.stuckOverHint }),
          isBest ? el('p', { class: 'best-flag', text: TEXT.newRecord }) : null,
          el(
            'dl',
            { class: 'result-facts' },
            el('dt', { text: TEXT.topSpeed }),
            el('dd', { text: formatSpeed(summary.topSpeed) }),
            el('dt', { text: TEXT.falls }),
            el('dd', { text: String(summary.falls) }),
            el('dt', { text: TEXT.bestTime }),
            el('dd', { text: best === undefined ? TEXT.noRecord : formatTime(best) }),
          ),
          el(
            'div',
            { class: 'result-buttons' },
            button(TEXT.retry, () => this.actions.onRetry(), 'primary'),
            won && hasNext ? button(TEXT.nextStage, () => this.actions.onNextStage()) : null,
            button(TEXT.watchAgain, () => this.actions.onWatchAgain()),
            button(TEXT.backToStages, () => this.actions.onBackToStages(), 'ghost'),
            button(TEXT.backToTitle, () => this.actions.onBackToTitle(), 'ghost'),
          ),
        ),
      ),
    );
  }

  /** Shows one screen and hides the rest. */
  show(name: ScreenName): void {
    this.current = name;
    for (const [key, panel] of this.panels) {
      panel.classList.toggle('is-showing', key === name);
    }
    this.root.classList.toggle('is-idle', name === 'none');
    if (name === 'settings') this.refreshSettings();
  }

  /** Which screen is showing. */
  get showing(): ScreenName {
    return this.current;
  }

  /** Keeps the settings panel in step with changes made elsewhere. */
  updateSettings(settings: Settings): void {
    this.settings = settings;
    if (this.current === 'settings') this.refreshSettings();
  }
}
