chrome.action.onClicked.addListener(async () => {
  const displays = await chrome.system.display.getInfo();
  const primary = displays.find(d => d.isPrimary) || displays[0];
  const { left, top, width, height } = primary.workArea;

  const w = Math.round(width * 0.9);
  const h = Math.round(height * 0.9);
  const x = left + Math.max(0, Math.round((width  - w) / 2));
  const y = top  + Math.max(0, Math.round((height - h) / 2));

  await chrome.windows.create({
    url: chrome.runtime.getURL("popup.html"),
    type: "popup",
    width: w,
    height: h,
    left: x,
    top: y,
    focused: true
  });
});
