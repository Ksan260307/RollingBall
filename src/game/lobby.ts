/**
 * Finding somebody to race, and carrying what everybody does.
 *
 * The rules never have to be told where anybody's ball is: every screen runs
 * the same race from the same steering, so all that crosses between them is
 * "on step nine hundred, this player held right". That is a few bytes, and
 * it is the whole of the traffic.
 *
 * How those bytes travel is deliberately kept behind one small interface.
 * What ships is the way that needs nothing from anybody — a channel the
 * browser provides between windows on the same machine — and it genuinely
 * works: open the game twice and the two find each other and race. Anything
 * that reaches further, whether across a room or across the world, is a
 * matter of writing another one of these and needs a relay somewhere, which
 * a page served from a static host has no way to provide by itself.
 */

/** What one player tells everybody else. */
export type Message =
  | { kind: 'here'; who: string; name: string; ball: string }
  | { kind: 'off'; who: string }
  | { kind: 'start'; who: string; order: string[]; stage: string; day: number }
  | { kind: 'did'; who: string; step: number; packed: number };

export interface Transport {
  /** Starts listening, and says who this is. */
  open(room: string, onMessage: (message: Message) => void): void;
  /** Tells everybody else something. */
  send(message: Message): void;
  /** Stops listening. */
  close(): void;
  /** Whether this way of talking is available at all. */
  readonly usable: boolean;
}

/**
 * Talking between windows of the same browser.
 *
 * Two tabs, or two windows, on one machine. Everything the rest of the game
 * needs from a connection is here and real: players appear, players leave,
 * steering arrives. It is the smallest thing that is genuinely multiplayer
 * rather than a rehearsal of it.
 */
export class WindowTransport implements Transport {
  private channel: BroadcastChannel | null = null;

  get usable(): boolean {
    return typeof BroadcastChannel !== 'undefined';
  }

  open(room: string, onMessage: (message: Message) => void): void {
    if (!this.usable) return;
    this.close();
    this.channel = new BroadcastChannel(`rollingball.${room}`);
    this.channel.onmessage = (event) => {
      const held = event.data as Message;
      if (held && typeof held === 'object' && typeof held.kind === 'string') onMessage(held);
    };
  }

  send(message: Message): void {
    this.channel?.postMessage(message);
  }

  close(): void {
    if (!this.channel) return;
    this.channel.onmessage = null;
    this.channel.close();
    this.channel = null;
  }
}

/** Somebody who has turned up, waiting to race. */
export interface Player {
  who: string;
  name: string;
  /** Their ball, written down. */
  ball: string;
}

export interface LobbyOptions {
  transport: Transport;
  room: string;
  name: string;
  ball: string;
  /** How many can race at once. */
  most: number;
}

/**
 * The waiting room.
 *
 * Everybody announces themselves and hears the others. When enough have
 * gathered, whoever sorts first by name calls the start, so that every
 * screen begins the same race in the same order without anybody having to
 * be in charge of anything else.
 */
export class Lobby {
  readonly me: string;
  private readonly transport: Transport;
  private readonly options: LobbyOptions;
  private readonly seen = new Map<string, Player>();
  private ticking: number | null = null;

  /** Called whenever the list of people waiting changes. */
  onPlayers: ((players: Player[]) => void) | null = null;
  /** Called when the race is on, with everybody in an agreed order. */
  onStart: ((order: Player[]) => void) | null = null;
  /** Called when somebody's steering arrives. */
  onDid: ((who: string, step: number, packed: number) => void) | null = null;

  constructor(options: LobbyOptions) {
    this.options = options;
    this.transport = options.transport;
    // Long enough that two windows opened in the same second do not clash.
    this.me = `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
    this.seen.set(this.me, { who: this.me, name: options.name, ball: options.ball });
  }

  /** Everybody waiting, this screen included, in an order all agree on. */
  get players(): Player[] {
    return [...this.seen.values()].sort((a, b) => (a.who < b.who ? -1 : 1));
  }

  /** True where there is any way of talking to anybody at all. */
  get usable(): boolean {
    return this.transport.usable;
  }

  /** Opens the room and starts saying hello. */
  begin(): void {
    if (!this.usable) return;
    this.transport.open(this.options.room, (message) => this.take(message));
    this.hello();
    // Said again from time to time, so somebody who arrives later still
    // hears about everybody who was already waiting.
    this.ticking = window.setInterval(() => this.hello(), 700);
    this.onPlayers?.(this.players);
  }

  /** Leaves the room. */
  end(): void {
    if (this.ticking !== null) window.clearInterval(this.ticking);
    this.ticking = null;
    if (this.usable) {
      this.transport.send({ kind: 'off', who: this.me });
      this.transport.close();
    }
  }

  /** Tells everybody what this screen just did. */
  say(step: number, packed: number): void {
    this.transport.send({ kind: 'did', who: this.me, step, packed });
  }

  /**
   * Calls the start, telling everybody else as well.
   *
   * Anybody may call it — whoever presses the button does. What matters is
   * that everybody then races in the same order, and the order comes from
   * sorting, which every screen can do alone and agree on.
   */
  callStart(stage: string, day: number): boolean {
    const order = this.players;
    if (order.length < 2) return false;
    const names = order.map((player) => player.who);
    this.transport.send({ kind: 'start', who: this.me, order: names, stage, day });
    this.onStart?.(order);
    return true;
  }

  /**
   * True where it falls to this screen to call the start by itself.
   *
   * Used only when the room starts on its own, so that four screens all
   * noticing the same moment do not all shout "go" at once.
   */
  get callsTheStart(): boolean {
    const order = this.players;
    return order.length > 0 && order[0].who === this.me;
  }

  private hello(): void {
    this.transport.send({
      kind: 'here',
      who: this.me,
      name: this.options.name,
      ball: this.options.ball,
    });
  }

  private take(message: Message): void {
    switch (message.kind) {
      case 'here': {
        if (message.who === this.me) return;
        const known = this.seen.get(message.who);
        if (known && known.name === message.name && known.ball === message.ball) return;
        if (this.seen.size >= this.options.most && !known) return;
        this.seen.set(message.who, {
          who: message.who,
          name: message.name,
          ball: message.ball,
        });
        this.onPlayers?.(this.players);
        // Answered straight away, so the newcomer hears about this screen
        // without waiting for the next round of hellos.
        this.hello();
        break;
      }
      case 'off':
        if (this.seen.delete(message.who)) this.onPlayers?.(this.players);
        break;
      case 'start': {
        const order = message.order
          .map((who) => this.seen.get(who))
          .filter((player): player is Player => player !== undefined);
        if (order.length >= 2) this.onStart?.(order);
        break;
      }
      case 'did':
        if (message.who !== this.me) this.onDid?.(message.who, message.step, message.packed);
        break;
      default:
        break;
    }
  }
}
