import test from 'node:test';
import assert from 'node:assert/strict';
import { WheelSound } from '../src/lucky-wheel-ui.js';

test('custom music remains in IndexedDB across new wheel instances and is replaced only by user action', async () => {
  const existingWindow = globalThis.window;
  const existingDb = globalThis.indexedDB;
  const tracks = new Map();
  const committed = [];

  globalThis.window = { indexedDB: {}, navigator: { storage: { persist: () => Promise.resolve(true) } } };
  globalThis.indexedDB = {
    open() {
      const req = { result: null };
      queueMicrotask(() => {
        req.result = {
          transaction(_name, mode) {
            let request;
            const transaction = {
              oncomplete: null, onerror: null, onabort: null,
              objectStore() {
                return {
                  put(item) {
                    request = {};
                    queueMicrotask(() => {
                      if (mode !== 'readwrite') throw Error('Unexpected mode');
                      tracks.set(item.key, item);
                      request.result = item.key;
                      request.onsuccess?.();
                      committed.push(() => transaction.oncomplete?.());
                    });
                    return request;
                  },
                  get(key) {
                    request = {};
                    queueMicrotask(() => {
                      request.result = tracks.get(key);
                      request.onsuccess?.();
                      transaction.oncomplete?.();
                    });
                    return request;
                  },
                  delete(key) {
                    request = {};
                    queueMicrotask(() => {
                      tracks.delete(key);
                      request.result = undefined;
                      request.onsuccess?.();
                      transaction.oncomplete?.();
                    });
                    return request;
                  }
                };
              }
            };
            return transaction;
          },
          close() {}
        };
        req.onsuccess?.();
      });
      return req;
    }
  };
  try {
    const namespace = 'test:tenant:teacher';
    const first = new WheelSound(namespace);
    const file = { name: 'nhac-quay.mp3', type: 'audio/mpeg', size: 7 };
    let resolved = false;
    const saving = first.save('spin', file).then(() => { resolved = true; });
    // The request has succeeded but the transaction has not committed.
    for (let n = 0; n < 5; n++) await Promise.resolve();
    assert.equal(resolved, false);
    assert.equal(first.sounds.spin, undefined);
    assert.equal(committed.length, 1);
    committed.shift()();
    await saving;
    assert.equal(resolved, true);

    const second = new WheelSound(namespace);
    await second.restore();
    assert.equal(second.sounds.spin.name, 'nhac-quay.mp3');

    const otherTeacher = new WheelSound('test:tenant:otherTeacher');
    await otherTeacher.restore();
    assert.equal(otherTeacher.sounds.spin, null);

    const replacement = { name: 'nhac-moi.wav', type: 'audio/wav', size: 8 };
    const replacing = second.save('spin', replacement);
    for (let n = 0; n < 5; n++) await Promise.resolve();
    assert.equal(second.sounds.spin.name, 'nhac-quay.mp3', 'Old music remains active until new write commits');
    committed.shift()();
    await replacing;
    const third = new WheelSound(namespace);
    await third.restore();
    assert.equal(third.sounds.spin.name, 'nhac-moi.wav');

    assert.equal(await third.requestPersistentStorage(), true);
    await third.clear('spin');
    const afterReset = new WheelSound(namespace);
    await afterReset.restore();
    assert.equal(afterReset.sounds.spin, null);
  } finally {
    if (existingWindow === undefined) delete globalThis.window;
    else globalThis.window = existingWindow;
    if (existingDb === undefined) delete globalThis.indexedDB;
    else globalThis.indexedDB = existingDb;
  }
});

test('persist request is nonfatal when browser does not support permanent storage', async () => {
  const previous = globalThis.window;
  try {
    globalThis.window = { navigator: {} };
    const instance = new WheelSound('missing-persist-api');
    assert.equal(await instance.requestPersistentStorage(), null);
    globalThis.window = { navigator: { storage: { persist: () => Promise.reject(Error('denied')) } } };
    assert.equal(await instance.requestPersistentStorage(), false);
  } finally {
    if (previous === undefined) delete globalThis.window;
    else globalThis.window = previous;
  }
});
