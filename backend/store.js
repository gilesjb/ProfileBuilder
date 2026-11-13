// @ts-check
/**
 * Persistence for the profile state.
 *
 * The file store writes atomically (temp file + rename) so a crash can't leave
 * a half-written file, and validates on load. A corrupt file is moved aside
 * rather than silently overwritten.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { emptyState, parseState } from './profile.js';

/** @typedef {import('./profile.js').State} State */
/** @typedef {{ load(): Promise<State>, save(state: State): Promise<void> }} Store */

/**
 * @param {string} path
 * @param {(event: Record<string, unknown>) => void} log
 * @returns {Store}
 */
export function createFileStore(path, log) {
  return {
    async load() {
      let text;
      try {
        text = await readFile(path, 'utf8');
      } catch (error) {
        if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') return emptyState();
        throw error;
      }
      try {
        return parseState(JSON.parse(text));
      } catch (error) {
        const movedTo = `${path}.corrupt-${Date.now()}`;
        await rename(path, movedTo);
        log({ event: 'store.corrupt', path, movedTo, error: String(error) });
        return emptyState();
      }
    },

    async save(state) {
      await mkdir(dirname(path), { recursive: true });
      const temp = `${path}.tmp`;
      await writeFile(temp, JSON.stringify(state, null, 2));
      await rename(temp, path);
    },
  };
}

/**
 * In-memory store for tests.
 * @param {State} [initial]
 * @returns {Store}
 */
export function createMemoryStore(initial = emptyState()) {
  let saved = structuredClone(initial);
  return {
    async load() {
      return structuredClone(saved);
    },
    async save(state) {
      saved = structuredClone(state);
    },
  };
}
