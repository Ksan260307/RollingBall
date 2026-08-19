/**
 * Every word the player sees, in one place.
 *
 * The game keeps its inner workings to itself: nothing here mentions steps,
 * seeds, checksums or fixed-point numbers. The rule is simple — if a word
 * would not make sense to someone who has never written a line of code, it
 * does not belong on the screen.
 */

/** How a piece of scenery is getting on with its life. */
export const LIFE_STAGE_WORDS = ['誕生', '成長', '充実', '変化', '完了', 'おやすみ'];

/** Whether a piece of scenery is up and about. */
export const ACTIVITY_WORDS = ['休憩中', '活動中'];

export const TEXT = {
  title: 'ころがしタイムアタック',
  /** The title split where it should break, so it never wraps awkwardly. */
  titleLead: 'ころがし',
  titleMain: 'タイムアタック',
  tagline: '高いところから ゴールまで、ころがして かけぬけよう。',

  play: 'あそぶ',
  customise: 'ボールをつくる',
  howTo: 'あそびかた',
  settings: 'せってい',
  back: 'もどる',
  close: 'とじる',
  start: 'スタート',
  retry: 'もういちど',
  nextStage: 'つぎのコース',
  backToStages: 'コースをえらぶ',
  resume: 'つづける',
  backToTitle: 'タイトルにもどる',
  watchAgain: 'リプレイ',
  replayAngle: 'アングル',
  replaySpeed: 'はやさ',
  replayFromTop: 'さいしょから',
  replayTitle: 'リプレイ',
  replayNow: 'リプレイ さいせい中',
  gapAhead: 'ベストより はやい',
  gapBehind: 'ベストより おそい',
  weightAt: 'おもりの いち',
  weightMiddle: 'まんなかに もどす',
  weightEven: 'つりあっています',
  weightSome: 'すこし かたよっています',
  weightLots: 'かなり かたよっています',
  mixColour: 'いろを つくる',
  mixedColour: 'つくった いろ',
  mixAdd: 'この いろを ふやす',
  mixNew: 'あたらしく つくる',
  mixEditing: 'えらんでいる いろを かえています',

  chooseStage: 'コースをえらぶ',
  difficulty: 'むずかしさ',
  length: 'ながさ',
  bestTime: 'ベスト',
  noRecord: '記録なし',
  target: 'めやす',

  countdownGo: 'GO!',
  time: 'タイム',
  speed: 'スピード',

  finished: 'ゴール！',
  fellOff: 'おっと！',
  stuckTitle: 'うごけません',
  stuckHint: 'あと',
  stuckOver: 'ストップ',
  stuckOverHint: '転がれなくなりました。かたちを見なおすと変わるかもしれません。',
  goodLuck: 'いってらっしゃい！',
  fellOffHint: 'スタートから やりなおし。',
  falls: '落ちた回数',
  newRecord: 'ベスト更新！',
  yourTime: 'タイム',
  topSpeed: '最高スピード',
  distance: 'すすんだ距離',

  paused: 'ひとやすみ',

  howToTitle: 'あそびかた',
  howToBody: [
    '画面を ゆびで ドラッグ（PCはマウスで ドラッグ）すると、その向きに ボールが かたむきます。',
    '左右で ハンドル、上下で 加速と ブレーキ。キーボードの 矢印キーや WASD でも うごきます。',
    'ボールの かたちで 転がりかたが 変わります。でっぱりが あると 引っかかって 進みません。',
    'ふちから 落ちても おわりでは ありません。スタートに もどって やりなおしです。',
    'ただし タイムは 止まりません。落ちないほうが ずっと 速く ゴールできます。',
    'まったく 進めなくなると 10秒の カウントが 出て、0で おわりになります。',
    'ゆびを 2本ひらくと ズーム（PCは マウスホイール）。右下の ボタンでも かえられます。',
  ],

  editorTitle: 'ボールをつくる',
  editorHint: 'ブロックを なぞると、その まま つづけて けずったり ふやしたり できます。',
  editorTarget: 'えらんでいる ところ',
  undo: 'ひとつ もどす',
  toolAdd: 'ふやす',
  toolRemove: 'けずる',
  toolPaint: 'ぬる',
  colour: 'いろ',
  presets: 'かたち',
  presetRound: 'まる',
  presetCube: 'しかく',
  presetPebble: 'こつぶ',
  presetRandom: 'ランダム',
  photo: '写真',
  choosePhoto: '写真をえらぶ',
  removePhoto: '写真をはずす',
  photoStrength: '写真のこさ',
  shine: 'つや',
  reset: 'さいしょから',
  save: 'できた',
  rotateHint: 'なにも ない ところを ドラッグ すると まわせます。ゆびを 2本ひらくと ズーム。',

  ballSize: '大きさ',
  ballWeight: 'おもさ',
  ballRoundness: 'ころがりやすさ',
  ballPickup: 'うごきだし',
  ballBumpiness: 'でこぼこ',
  ballBlocks: 'ブロックの数',

  settingsZoom: 'カメラの近さ',
  settingsRich: 'きれいに描く',
  settingsSound: '音',
  settingsInvert: '上下の操作を逆に',
  settingsGhost: 'ベストの走りと ならんで走る',
  settingsClear: '記録をけす',
  settingsCleared: '記録をけしました',

  photoTooLarge: '写真が 大きすぎます。べつの写真を えらんでください。',
  photoFailed: 'その写真は よみこめませんでした。',
  needBlocks: 'ブロックが なくなりました。ひとつ以上 のこしてください。',
  webglMissing: 'このブラウザでは 3Dが つかえないようです。べつのブラウザで ためしてみてください。',
} as const;

/** Turns a number of seconds into a clock reading like 1:23.45 . */
export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '--:--.--';
  const whole = Math.floor(seconds);
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  const hundredths = Math.floor((seconds - whole) * 100);
  return `${minutes}:${String(rest).padStart(2, '0')}.${String(hundredths).padStart(2, '0')}`;
}

/** Turns metres per second into a friendlier reading. */
export function formatSpeed(metresPerSecond: number): string {
  return `${Math.round(metresPerSecond * 3.6)} km/h`;
}

/** Fills in dots for a difficulty rating. */
export function difficultyDots(level: number): string {
  const filled = Math.max(1, Math.min(3, Math.round(level)));
  return '●'.repeat(filled) + '○'.repeat(3 - filled);
}
