import qrcode from 'qrcode-generator';

// リンクを外部へ送らず、4セルの余白を付けたQRを描く。
export function createQrCanvas(root, url, label) {
  const qr = qrcode(0, 'M'); qr.addData(url, 'Byte'); qr.make();
  const size = qr.getModuleCount(), scale = 5, canvas = root.createElement('canvas');
  canvas.width = canvas.height = (size + 8) * scale; canvas.className = 'registration-qr';
  canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', label);
  const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.fillStyle = '#000';
  for (let row = 0; row < size; row++) for (let column = 0; column < size; column++) {
    if (qr.isDark(row, column)) ctx.fillRect((column + 4) * scale, (row + 4) * scale, scale, scale);
  }
  return canvas;
}
