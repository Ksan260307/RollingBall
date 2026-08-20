/**
 * Talking to the other players through Steam.
 *
 * The web version can only find somebody in another window of the same
 * browser, because a page served from a static host has nowhere to put a
 * relay. Steam already runs one: it has lobbies, it knows who is in them,
 * and it will punch a hole between two players or carry their messages
 * itself if it cannot. So the desktop build hands that job to Steam and
 * everything above this file carries on exactly as before.
 *
 * Nothing here knows anything about Steam's own shape. The desktop shell
 * puts a small bridge on the window with four things on it — join, leave,
 * send, and a way to be told — and this turns that into the same Transport
 * the rest of the game already uses.
 */

import type { Message, Transport } from './lobby';

/** What the desktop shell puts on the window when Steam is running. */
export interface SteamBridge {
  /**
   * Whether Steam was actually reached.
   *
   * The bridge is put out whether or not Steam answered, so that the game
   * can tell the difference between "not a desktop build" and "a desktop
   * build with no Steam behind it". The second still plays, and still finds
   * people in other windows, exactly as the website does.
   */
  live: boolean;
  /** True once Steam has been reached and the player is signed in. */
  ready(): Promise<boolean>;
  /** Finds a lobby with room in it, or makes one. Gives back its id. */
  joinLobby(room: string, most: number): Promise<string>;
  /** Leaves whatever lobby this is in. */
  leaveLobby(): Promise<void>;
  /** Sends one message to everybody else in the lobby. */
  send(text: string): void;
  /** Called with every message from everybody else. */
  onMessage(handler: (text: string) => void): void;
  /** The player's own Steam name, for the waiting room. */
  name(): Promise<string>;
}

declare global {
  interface Window {
    steam?: SteamBridge;
  }
}

/** Whether this copy of the game is running with Steam behind it. */
export function steamAvailable(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.steam?.send === 'function' &&
    window.steam.live === true
  );
}

/**
 * The same waiting room and the same race, carried by Steam.
 *
 * Messages go out as text, because that is the one shape every way of
 * talking agrees on, and because a run's worth of them is a few hundred
 * bytes a second either way.
 */
export class SteamTransport implements Transport {
  private bridge: SteamBridge | null = null;
  private listening: ((message: Message) => void) | null = null;
  private joined = false;

  get usable(): boolean {
    return steamAvailable();
  }

  open(room: string, onMessage: (message: Message) => void): void {
    if (!this.usable) return;
    this.bridge = window.steam ?? null;
    this.listening = onMessage;
    this.bridge?.onMessage((text) => this.take(text));
    void this.bridge?.joinLobby(room, 4).then(() => {
      this.joined = true;
    });
  }

  send(message: Message): void {
    if (!this.joined) return;
    try {
      this.bridge?.send(JSON.stringify(message));
    } catch {
      // A message that will not go is dropped rather than thrown: the race
      // treats a player who has gone quiet as gone quiet, which is exactly
      // what has happened.
    }
  }

  close(): void {
    this.listening = null;
    this.joined = false;
    void this.bridge?.leaveLobby();
    this.bridge = null;
  }

  /**
   * Takes a message from somebody else.
   *
   * Everything arriving here comes from another machine, so none of it is
   * believed without being looked at first.
   */
  private take(text: string): void {
    if (!this.listening) return;
    try {
      const held = JSON.parse(text) as Message;
      if (held && typeof held === 'object' && typeof held.kind === 'string') {
        this.listening(held);
      }
    } catch {
      // Not a message. Nothing to do about it and nothing worth saying.
    }
  }
}
