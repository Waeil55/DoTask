// DoTask service worker: opens the side panel, adds right-click actions, and injects the
// page controller into tabs that were already open when DoTask was installed or updated.

async function setup() {
  try { await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }) } catch {}
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'explain', title: 'DoTask: Explain this', contexts: ['selection'] })
    chrome.contextMenus.create({ id: 'reply', title: 'DoTask: Write a reply to this', contexts: ['selection'] })
    chrome.contextMenus.create({ id: 'read', title: 'DoTask: Read this aloud', contexts: ['selection'] })
    chrome.contextMenus.create({ id: 'study', title: 'DoTask: Study this page with me', contexts: ['page'] })
  })
}

chrome.runtime.onInstalled.addListener(async () => {
  await setup()
  const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] })
  for (const tab of tabs) {
    chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: ['content.js'] }).catch(() => {})
  }
})

chrome.runtime.onStartup.addListener(setup)

chrome.contextMenus.onClicked.addListener((info, tab) => {
  // sidePanel.open must run synchronously inside the user gesture
  chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {})
  const pendingAction = { kind: info.menuItemId, text: info.selectionText || '', url: tab.url, tabId: tab.id, ts: Date.now() }
  chrome.storage.session.set({ pendingAction }).then(() => {
    chrome.runtime.sendMessage({ type: 'pendingAction' }).catch(() => {})
  })
})
