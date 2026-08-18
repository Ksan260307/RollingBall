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
  giveUp: 'やめる',

  chooseStage: 'コースをえらぶ',
  difficulty: 'むずかしさ',
  length: 'ながさ',
  bestTime: 'ベスト',
  noRecord: '記録なし',
  target: 'めやす',

  countdownGo: 'GO!',
  time: 'タイム',
  speed: 'スピード',
  progress: 'ゴールまで',
  collectedItems: 'あつめた光',

  finished: 'ゴール！',
  fallen: 'コースアウト',
  fallenHint: 'ふちに気をつけて、まん中をねらってみよう。',
  newRecord: 'ベスト更新！',
  yourTime: 'タイム',
  topSpeed: '最高スピード',
  distance: 'すすんだ距離',

  paused: 'ひとやすみ',

  howToTitle: 'あそびかた',
  howToBody: [
    '画面を ゆびで ドラッグ（PCはマウスで ドラッグ）すると、その向きに ボールが かたむきます。',
    '左右で ハンドル、上下で 加速と ブレーキ。キーボードの 矢印キーや WASD でも うごきます。',
    'コースの ふちから 落ちると そこで おわり。まん中を ねらって、いきおいよく ゴールへ。',
    'ゆびを 2本ひらくと ズーム（PCは マウスホイール）。右下の ボタンでも かえられます。',
    '光をあつめると すこし 元気が でます。タイムには ひびきません。',
  ],

  editorTitle: 'ボールをつくる',
  editorHint: 'ブロックを タップして けずったり、ふやしたり。写真を はると もっと あなたらしく。',
  toolAdd: 'ふやす',
  toolRemove: 'けずる',
  toolPaint: 'ぬる',
  colour: 'いろ',
  presets: 'かたち',
  presetRound: 'まる',
  presetCube: 'しかく',
  presetPebble: 'こつぶ',
  photo: '写真',
  choosePhoto: '写真をえらぶ',
  removePhoto: '写真をはずす',
  photoStrength: '写真のこさ',
  shine: 'つや',
  reset: 'さいしょから',
  save: 'できた',
  rotateHint: 'なにもない ところを ドラッグすると まわせます。',

  ballSize: '大きさ',
  ballWeight: 'おもさ',
  ballRoundness: 'ころがりやすさ',
  ballPickup: 'うごきだし',
  ballBlocks: 'ブロックの数',

  settingsZoom: 'カメラの近さ',
  settingsRich: 'きれいに描く',
  settingsSound: '音',
  settingsInvert: '上下の操作を逆に',
  settingsClear: '記録をけす',
  settingsCleared: '記録をけしました',

  neighbourhood: 'まわりのようす',
  quiet: 'しずか',
  lively: 'にぎやか',

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
