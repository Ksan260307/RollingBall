/**
 * Squashing things down and writing them in letters that survive a link.
 *
 * Shared by the two things the game hands over: a ball, and a run. Both are
 * mostly repetition, both have to fit in something a person can send, and
 * both arrive back from outside and have to be treated as suspect.
 */

/** The letters used, chosen so text survives being put in a web address. */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** Writes bytes as letters. */
export function toText(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const held = (a << 16) | (b << 8) | c;
    const left = bytes.length - i;
    out += ALPHABET[(held >> 18) & 63] + ALPHABET[(held >> 12) & 63];
    if (left > 1) out += ALPHABET[(held >> 6) & 63];
    if (left > 2) out += ALPHABET[held & 63];
  }
  return out;
}

/** Reads letters back into bytes, or nothing if they are not those letters. */
export function fromText(text: string): Uint8Array | null {
  const held: number[] = [];
  let bits = 0;
  let carried = 0;
  for (const letter of text) {
    const value = ALPHABET.indexOf(letter);
    if (value < 0) return null;
    carried = (carried << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      held.push((carried >> bits) & 0xff);
    }
  }
  return Uint8Array.from(held);
}

/**
 * Squashes bytes, or gives nothing where the browser cannot.
 *
 * Every current browser can. An old one can still keep and paste what it
 * makes; it simply comes out longer.
 */
export async function squashed(bytes: Uint8Array): Promise<Uint8Array | null> {
  if (typeof CompressionStream === 'undefined') return null;
  try {
    return new Uint8Array(await through(bytes, false));
  } catch {
    return null;
  }
}

/** Unsquashes bytes, or gives nothing if they were not what they claimed. */
export async function unsquashed(bytes: Uint8Array): Promise<Uint8Array | null> {
  if (typeof DecompressionStream === 'undefined') return null;
  try {
    return new Uint8Array(await through(bytes, true));
  } catch {
    return null;
  }
}

/**
 * Puts bytes through a squasher and waits for everything to settle.
 *
 * Both ends have to be waited on. Rubbish fed to the unsquasher fails on the
 * writing end, and leaving that end unwatched turns something somebody
 * typed wrong into an error nobody asked for.
 */
async function through(bytes: Uint8Array, loosen: boolean): Promise<ArrayBuffer> {
  const stream = loosen
    ? new DecompressionStream('deflate-raw')
    : new CompressionStream('deflate-raw');
  const writer = stream.writable.getWriter();
  const written = writer
    .write(ownBuffer(bytes))
    .then(() => writer.close())
    .catch(() => {
      // The reading end reports the same trouble, and that is what is used.
    });
  const out = await new Response(stream.readable).arrayBuffer();
  await written;
  return out;
}

/** A copy that owns its own memory, which is what the squashing asks for. */
function ownBuffer(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(new ArrayBuffer(bytes.length));
  copy.set(bytes);
  return copy;
}
