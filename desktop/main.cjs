/**
 * The desktop shell.
 *
 * It opens one window and points it at the very same build the website
 * serves — the game itself is not forked, rebuilt or altered for Steam. All
 * this adds is a window to put it in and a way through to Steam, which is
 * the one thing a page on a static host cannot have: somewhere to find
 * other players.
 *
 * Steam is optional at every step. If the Steam client is not running, or
 * the library is not installed, the shell says so once and the game runs
 * exactly as it does in a browser, robots and all.
 */

const { app, BrowserWindow, ipcMain, net, protocol, shell } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

/**
 * The game is served to itself over a scheme of its own.
 *
 * Not from the file system directly: a page loaded from a file gets no
 * headers, which means it gets no rules about what it may do either, and
 * Electron rightly complains. Serving the very same files under a scheme
 * of our own lets the rules travel with them.
 */
const SCHEME = 'game';

protocol.registerSchemesAsPrivileged([
  { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

/**
 * Which game on Steam this is.
 *
 * 480 is Steam's own test game, and it is what to develop against until a
 * real one has been granted: it has working lobbies and costs nothing.
 * Replace it with the real number before shipping, and put the same number
 * in the file beside the executable that Steam reads on startup.
 */
const APP_ID = Number(process.env.ROLLINGBALL_STEAM_APP_ID ?? 480);

/** Steam, once it has been reached. Null where it has not. */
let steam = null;
let inLobby = null;
let window_ = null;

/** How often to look for messages from the other players, in milliseconds. */
const COLLECT_EVERY = 8;

/**
 * Sent straight out, with no promise it will arrive.
 *
 * Steering is only worth having on time. A message that had to be waited
 * for and re-sent would arrive after the step it was meant for had gone,
 * and the race would rather fill that step in itself.
 */
const UNRELIABLE = 0;

/** Steam's own list of things it can tell us about. */
function steamCallbacks() {
  return require('steamworks.js').SteamCallback;
}

/**
 * Brings Steam up, if it is there at all.
 *
 * Wrapped in every guard going, because a desktop game that refuses to
 * start when Steam is not running is a desktop game nobody can develop.
 */
function reachSteam() {
  try {
    // Loaded by name at run time: a build without it still runs, and a
    // machine without Steam still plays the game.
    const steamworks = require('steamworks.js');
    steam = steamworks.init(APP_ID);
    // The overlay needs the window drawn in a way it can get in front of.
    // Asked for before any window is made, which is why it is here.
    try {
      steamworks.electronEnableSteamOverlay();
    } catch {
      // No overlay. The game is the same game without it.
    }
    console.log('steam: reached, playing as', steam.localplayer.getName());
    return true;
  } catch (trouble) {
    console.log('steam: not reached —', trouble && trouble.message);
    steam = null;
    return false;
  }
}

function makeWindow() {
  window_ = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 640,
    minHeight: 480,
    backgroundColor: '#0c1018',
    title: 'ころがしタイムアタック',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      // The page is our own build and never loads anything from anywhere
      // else, so it gets no more than a page in a browser would.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  window_.setMenuBarVisibility(false);
  window_.loadURL(`${SCHEME}://game/index.html`);

  // Anything asking for a browser gets the browser, not a window of ours.
  window_.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });
}

/* ------------------------------------------------------ the way through */

ipcMain.handle('steam:ready', () => steam !== null);

// Asked once, as the page loads, so the game knows straight away whether it
// can look for players through Steam or should look in other windows.
ipcMain.on('steam:live', (event) => {
  event.returnValue = steam !== null;
});

ipcMain.handle('steam:name', () => {
  try {
    return steam ? steam.localplayer.getName() : '';
  } catch {
    return '';
  }
});

/**
 * Finds a lobby with room in it, or makes one.
 *
 * Steam's own matchmaking does the finding: everybody asks for a lobby
 * carrying the same mark, and whoever asks first when there is none makes
 * one for the rest to walk into.
 */
ipcMain.handle('steam:join', async (_event, room, most) => {
  if (!steam) return '';
  try {
    const found = await steam.matchmaking.getLobbies();
    for (const lobby of found) {
      // Somebody else's game, or one that is already full.
      if (lobby.getData('game') !== room) continue;
      if (Number(lobby.getMemberCount()) >= most) continue;
      const joined = await lobby.join();
      inLobby = joined;
      return String(joined.id);
    }
    // Nobody waiting: open one and wait to be walked into.
    const made = await steam.matchmaking.createLobby(2, most);
    made.setData('game', room);
    inLobby = made;
    return String(made.id);
  } catch (trouble) {
    console.log('steam: could not join a lobby —', trouble && trouble.message);
    return '';
  }
});

ipcMain.handle('steam:leave', () => {
  try {
    if (inLobby) inLobby.leave();
  } catch {
    // Already gone.
  }
  inLobby = null;
});

ipcMain.on('steam:send', (_event, text) => {
  if (!steam || !inLobby) return;
  try {
    const bytes = Buffer.from(text, 'utf8');
    const me = steam.localplayer.getSteamId().steamId64;
    for (const member of inLobby.getMembers()) {
      if (member.steamId64 === me) continue;
      // Sent without waiting and without a promise to arrive: steering that
      // turns up late is no use to anybody, and the race already copes
      // perfectly well with a message that never comes.
      steam.networking.sendP2PPacket(member.steamId64, UNRELIABLE, bytes);
    }
  } catch {
    // Somebody has left mid-message. The race handles that on its own.
  }
});

/**
 * Hands anything that has arrived to the window.
 *
 * Steam holds messages until they are asked for, so they are asked for
 * often — a race takes a hundred and twenty steps a second and nobody
 * wants their steering sitting in a queue.
 */
function collect() {
  if (!steam || !window_ || window_.isDestroyed()) return;
  try {
    for (;;) {
      const waiting = steam.networking.isP2PPacketAvailable();
      if (!waiting) return;
      const packet = steam.networking.readP2PPacket(waiting);
      if (!packet) return;
      window_.webContents.send('steam:message', Buffer.from(packet.data).toString('utf8'));
    }
  } catch {
    // Nothing waiting, or Steam has gone away.
  }
}

/* ------------------------------------------------------------ the shell */

/**
 * What the page is allowed to do.
 *
 * The game asks nothing of the network and loads nothing from anywhere
 * else, so it is told it may do neither. Set here rather than in the page,
 * because the page is the website's page and is not touched for Steam.
 *
 * Inline styles are allowed because the game positions things by setting
 * style on elements — an arrow under a finger, a bar that fills up — and
 * that is a style attribute, not a script.
 */
const RULES = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

function lockThePageDown() {
  const root = path.join(__dirname, '..', 'dist');
  protocol.handle(SCHEME, async (request) => {
    const asked = decodeURIComponent(new URL(request.url).pathname);
    // Anything trying to climb out of the folder is given the front page
    // instead, which is the same answer a web server would give.
    const wanted = path.normalize(path.join(root, asked));
    const inside = wanted.startsWith(root) ? wanted : path.join(root, 'index.html');
    const held = await net.fetch(pathToFileURL(inside).toString());
    const headers = new Headers(held.headers);
    headers.set('Content-Security-Policy', RULES);
    return new Response(held.body, { status: held.status, headers });
  });
}

app.whenReady().then(() => {
  lockThePageDown();
  reachSteam();
  if (steam) {
    // Anybody in the lobby is somebody we have agreed to race, so their
    // packets are accepted rather than each one being asked about.
    steam.callback.register(steamCallbacks().P2PSessionRequest, (event) => {
      try {
        steam.networking.acceptP2PSession(event.remote);
      } catch {
        // They have gone already.
      }
    });
    setInterval(collect, COLLECT_EVERY);
  }
  makeWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) makeWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
