function check(matrix, scale, border) {
  if (!matrix.length || matrix.some(row => row.length !== matrix.length)) throw new TypeError('Expected a square matrix.');
  if (!Number.isInteger(scale) || scale < 1 || scale > 32) throw new RangeError('Scale must be an integer from 1 to 32.');
  if (!Number.isInteger(border) || border < 4 || border > 32) throw new RangeError('Quiet zone must be at least four modules.');
}

export function toSvg(matrix, { scale = 10, border = 4 } = {}) {
  check(matrix, scale, border);
  const side = matrix.length + border * 2;
  const paths = [];
  for (let y = 0; y < matrix.length; y++) {
    for (let x = 0; x < matrix.length; x++) {
      if (!matrix[y][x]) continue;
      const start = x;
      while (x + 1 < matrix.length && matrix[y][x + 1]) x++;
      const length = x - start + 1;
      paths.push(`M${start + border},${y + border}h${length}v1h-${length}z`);
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${side * scale}" height="${side * scale}" viewBox="0 0 ${side} ${side}" shape-rendering="crispEdges" role="img" aria-label="Generated QR code"><rect width="${side}" height="${side}" fill="#fff"/><path d="${paths.join('')}" fill="#000"/></svg>`;
}

export function paintCanvas(canvas, matrix, { scale = 10, border = 4 } = {}) {
  check(matrix, scale, border);
  canvas.width = canvas.height = (matrix.length + border * 2) * scale;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas rendering is unavailable in this browser.');
  context.imageSmoothingEnabled = false;
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#000';
  for (let y = 0; y < matrix.length; y++) for (let x = 0; x < matrix.length; x++) {
    if (matrix[y][x]) context.fillRect((x + border) * scale, (y + border) * scale, scale, scale);
  }
  return canvas;
}
