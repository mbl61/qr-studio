import { encodeText } from './qr.js';

self.onmessage = ({ data: { id, text, options } }) => {
  try { self.postMessage({ id, result: encodeText(text, options) }); }
  catch (error) { self.postMessage({ id, error: error.message }); }
};
