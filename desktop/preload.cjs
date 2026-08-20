/**
 * The bridge between the game and Steam.
 *
 * The page cannot reach Steam, and should not be able to: it is the same
 * page the website serves and it gets no more power here than it has there.
 * What it gets instead is this — four things it can ask for and one it can
 * be told — and nothing else of the machine is on the other side of it.
 *
 * When Steam is not running, the bridge is not put out at all, and the game
 * falls back to finding people in other windows exactly as on the web.
 */

const { contextBridge, ipcRenderer } = require('electron');

let listening = null;

ipcRenderer.on('steam:message', (_event, text) => {
  if (listening) listening(text);
});

/**
 * Whether Steam was actually reached, asked for before the game starts.
 *
 * Put out as a plain value rather than a promise, because the game has to
 * decide where to look for other players the moment somebody asks to play
 * together, and a promise would have it deciding after the fact.
 *
 * Without this the desktop build would offer Steam and find nobody, and
 * would never fall back to the other windows on the machine — which is
 * worse than the browser, not better.
 */
const live = (() => {
  try {
    return ipcRenderer.sendSync('steam:live') === true;
  } catch {
    return false;
  }
})();

contextBridge.exposeInMainWorld('steam', {
  live,
  ready: () => ipcRenderer.invoke('steam:ready'),
  name: () => ipcRenderer.invoke('steam:name'),
  joinLobby: (room, most) => ipcRenderer.invoke('steam:join', String(room), Number(most)),
  leaveLobby: () => ipcRenderer.invoke('steam:leave'),
  send: (text) => ipcRenderer.send('steam:send', String(text)),
  onMessage: (handler) => {
    listening = typeof handler === 'function' ? handler : null;
  },
});
