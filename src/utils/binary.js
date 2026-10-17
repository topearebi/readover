// Binary asset & stream validation utilities.
// Prevents 0-byte ghost uploads, detached ArrayBuffers, and exhausted ReadableStream instances.

/**
 * Validates, measures, and clones/buffers a binary payload prior to network transmission.
 * Guarantees that:
 * 1. Promises are awaited.
 * 2. 0-byte or exhausted payloads fail fast before reaching the wire.
 * 3. Blobs are sliced to produce independent stream references.
 * 4. ArrayBuffers and TypedArrays are cloned so worker threading/transfer lists cannot detach them.
 * 5. ReadableStreams are safely consumed into a measured Uint8Array.
 *
 * @param {Blob|File|ArrayBuffer|ArrayBufferView|ReadableStream|Promise|string} payload
 * @returns {Promise<{ body: any, size: number }>}
 */
export async function validateBinaryPayload(payload) {
  if (payload == null) {
    throw new Error('Upload failed: binary payload is null or undefined.');
  }

  // 1. Resolve promise if passed
  if (typeof payload.then === 'function') {
    payload = await payload;
  }
  if (payload == null) {
    throw new Error('Upload failed: binary payload resolved to null or undefined.');
  }

  let size = 0;
  let readyBody = payload;

  // 2. Blob or File
  if (typeof Blob !== 'undefined' && payload instanceof Blob) {
    size = payload.size;
    if (size === 0) {
      throw new Error('Upload failed: remote server received 0 bytes (source payload is 0 bytes).');
    }
    // Slicing produces a fresh Blob reference with an unconsumed, independent stream state
    readyBody = payload.slice(0, payload.size, payload.type);
  }
  // 3. ArrayBuffer
  else if (payload instanceof ArrayBuffer) {
    size = payload.byteLength;
    if (size === 0) {
      throw new Error('Upload failed: remote server received 0 bytes (ArrayBuffer is detached or 0 bytes).');
    }
    readyBody = new Uint8Array(payload.slice(0));
  }
  // 4. TypedArray / ArrayBufferView (Uint8Array, Buffer, etc.)
  else if (ArrayBuffer.isView(payload)) {
    size = payload.byteLength;
    if (size === 0 || (payload.buffer && payload.buffer.byteLength === 0)) {
      throw new Error('Upload failed: remote server received 0 bytes (buffer view is detached or 0 bytes).');
    }
    readyBody = new Uint8Array(payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength));
  }
  // 5. ReadableStream
  else if (typeof globalThis.ReadableStream !== 'undefined' && payload instanceof globalThis.ReadableStream) {
    if (payload.locked) {
      throw new Error('Upload failed: ReadableStream is locked or already in use.');
    }
    const reader = payload.getReader();
    const chunks = [];
    let totalLen = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        totalLen += value.byteLength;
      }
    }
    if (totalLen === 0) {
      throw new Error('Upload failed: remote server received 0 bytes (ReadableStream was exhausted or empty).');
    }
    const combined = new Uint8Array(totalLen);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.byteLength;
    }
    size = totalLen;
    readyBody = combined;
  }
  // 6. String
  else if (typeof payload === 'string') {
    const encoded = new TextEncoder().encode(payload);
    size = encoded.byteLength;
    if (size === 0) {
      throw new Error('Upload failed: remote server received 0 bytes (text string is empty).');
    }
    readyBody = encoded;
  } else {
    throw new Error(`Upload failed: unrecognized binary payload type "${typeof payload}".`);
  }

  return { body: readyBody, size };
}

/**
 * Creates an independent clone of a Blob or binary buffer.
 * Used for metadata extraction and cover thumbnail rendering to ensure
 * the underlying stream for cloud transport remains unconsumed and uncorrupted.
 *
 * @param {Blob|Uint8Array|ArrayBuffer} binary
 * @returns {Blob|Uint8Array|ArrayBuffer}
 */
export function cloneBlob(binary) {
  if (!binary) return binary;
  if (typeof Blob !== 'undefined' && binary instanceof Blob) {
    return binary.slice(0, binary.size, binary.type);
  }
  if (ArrayBuffer.isView(binary)) {
    return new Uint8Array(binary.buffer.slice(binary.byteOffset, binary.byteOffset + binary.byteLength));
  }
  if (binary instanceof ArrayBuffer) {
    return binary.slice(0);
  }
  return binary;
}

/**
 * Enforces the Upload Verification Contract:
 * Rejects if the remote provider reports 0 bytes committed or a size discrepancy.
 *
 * @param {object} options
 * @param {number} options.expectedSize - Source payload size in bytes.
 * @param {number} options.remoteSize - Remote committed size reported by server descriptor/header.
 * @param {string} [options.provider='remote server'] - Provider name for error diagnostic.
 * @returns {boolean}
 */
export function verifyRemoteSize({ expectedSize, remoteSize, provider = 'remote server' }) {
  if (typeof remoteSize === 'number') {
    if (remoteSize === 0 && expectedSize > 0) {
      throw new Error(`Upload failed: ${provider} received 0 bytes`);
    }
    if (remoteSize !== expectedSize) {
      throw new Error(`Upload failed: ${provider} byte mismatch (received ${remoteSize} bytes, expected ${expectedSize} bytes)`);
    }
  }
  return true;
}

/**
 * Formats a byte size into a human-readable string (e.g. 512 B, 4.2 MB).
 * @param {number} bytes
 * @returns {string}
 */
export function formatBytes(bytes) {
  if (bytes == null || isNaN(bytes)) return '0 B';
  const b = Number(bytes);
  if (b === 0) return '0 B';
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} MB`;
  return `${(b / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
