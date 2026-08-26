import { readObject } from './object-store.js';

type StoredObjectReaderDependencies = {
  read: (pathname: string) => Promise<Buffer | null>;
  wait: (milliseconds: number) => Promise<void>;
};

const dependencies: StoredObjectReaderDependencies = {
  read: readObject,
  wait: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
};

export async function readStoredObject(pathname: string, reader: StoredObjectReaderDependencies = dependencies) {
  const retryDelays = [0, 150, 500];
  let lastError: unknown;

  for (const delay of retryDelays) {
    if (delay) await reader.wait(delay);
    try {
      return await reader.read(pathname);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Stored object read failed.');
}
