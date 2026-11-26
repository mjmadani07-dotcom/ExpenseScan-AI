import type { AiProviderId } from '../types/expense';

const DB_NAME = 'hesabyar_secure_vault_v1';
const STORE_NAME = 'vault';
const MASTER_KEY_ID = 'master_aes_key';
const CIPHER_DATA_ID = 'provider_keys_cipher';

const memoryFallback: Partial<Record<AiProviderId, string>> = {};

function openVaultDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Failed to open IndexedDB'));
  });
}

function idbGet<T>(db: IDBDatabase, key: string): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

function idbPut(db: IDBDatabase, key: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.put(value, key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function getOrCreateMasterKey(db: IDBDatabase): Promise<CryptoKey> {
  const existing = await idbGet<CryptoKey>(db, MASTER_KEY_ID);
  if (existing) return existing;
  const generated = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    false, // non-extractable
    ['encrypt', 'decrypt']
  );
  await idbPut(db, MASTER_KEY_ID, generated);
  return generated;
}

interface EncryptedPayload {
  iv: Uint8Array;
  ciphertext: ArrayBuffer;
}

async function persistMap(map: Partial<Record<AiProviderId, string>>): Promise<void> {
  if (
    typeof indexedDB === 'undefined' ||
    typeof crypto === 'undefined' ||
    !crypto.subtle
  ) {
    Object.keys(memoryFallback).forEach((k) => {
      delete memoryFallback[k as AiProviderId];
    });
    Object.assign(memoryFallback, map);
    return;
  }

  const db = await openVaultDb();
  try {
    const key = await getOrCreateMasterKey(db);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(JSON.stringify(map));
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
    const payload: EncryptedPayload = { iv, ciphertext };
    await idbPut(db, CIPHER_DATA_ID, payload);
  } finally {
    db.close();
  }
}

export async function loadLocalApiKeys(): Promise<Partial<Record<AiProviderId, string>>> {
  if (
    typeof indexedDB === 'undefined' ||
    typeof crypto === 'undefined' ||
    !crypto.subtle
  ) {
    return { ...memoryFallback };
  }

  try {
    const db = await openVaultDb();
    try {
      const key = await idbGet<CryptoKey>(db, MASTER_KEY_ID);
      const payload = await idbGet<EncryptedPayload>(db, CIPHER_DATA_ID);
      if (!key || !payload) return {};
      const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: new Uint8Array(payload.iv) },
        key,
        payload.ciphertext
      );
      const jsonStr = new TextDecoder().decode(decrypted);
      const parsed = JSON.parse(jsonStr) as Record<string, unknown>;
      const result: Partial<Record<AiProviderId, string>> = {};
      for (const prov of ['gemini', 'openai', 'openrouter'] as const) {
        if (typeof parsed[prov] === 'string' && parsed[prov].trim()) {
          result[prov] = parsed[prov].trim();
        }
      }
      return result;
    } finally {
      db.close();
    }
  } catch {
    return { ...memoryFallback };
  }
}

export async function saveLocalApiKey(
  provider: AiProviderId,
  apiKey: string
): Promise<Partial<Record<AiProviderId, string>>> {
  const current = await loadLocalApiKeys();
  const trimmed = apiKey.trim();
  const next: Partial<Record<AiProviderId, string>> = { ...current };
  if (trimmed) {
    next[provider] = trimmed;
  } else {
    delete next[provider];
  }
  await persistMap(next);
  return next;
}

export async function removeLocalApiKey(
  provider: AiProviderId
): Promise<Partial<Record<AiProviderId, string>>> {
  return saveLocalApiKey(provider, '');
}

export function maskApiKey(key: string | undefined): string {
  if (!key) return '';
  const trimmed = key.trim();
  if (trimmed.length <= 8) return '••••••••';
  return `${trimmed.slice(0, 4)}••••••${trimmed.slice(-4)}`;
}
