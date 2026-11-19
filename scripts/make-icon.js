// Renders the app logo to build/icon.png (run with: electron scripts/make-icon.js).
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const html = `<html><body style="margin:0;background:transparent">
<div style="width:512px;height:512px;border-radius:112px;background:linear-gradient(135deg,#3987e5,#9085e9);
display:flex;align-items:center;justify-content:center;font:360px 'Segoe UI Symbol','Segoe UI',sans-serif;color:#fff;line-height:1">
<span style="margin-top:-24px">&#9822;</span></div></body></html>`;
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 512, height: 512, show: false, transparent: true, frame: false, useContentSize: true, webPreferences: { offscreen: true } });
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  await new Promise((r) => setTimeout(r, 500));
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: 512, height: 512 });
  fs.writeFileSync(path.join(__dirname, '..', 'build', 'icon.png'), img.resize({ width: 512, height: 512 }).toPNG());
  console.log('icon written');
  app.quit();
});
