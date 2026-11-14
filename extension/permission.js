import { addFolder } from './lib/localfiles.js'

const folderMode = new URLSearchParams(location.search).has('folder')
const btn = document.getElementById('allow')
const status = document.getElementById('status')

if (folderMode) {
  document.querySelector('h2').textContent = 'Give DoTask a folder'
  document.querySelector('p').textContent = 'Pick a folder (for example Documents\\Teaching). DoTask can open and create files only inside it.'
  btn.textContent = 'Choose folder'
}

btn.addEventListener('click', async () => {
  try {
    if (folderMode) {
      const f = await addFolder()
      status.className = 'ok'
      status.textContent = `Added “${f.name}”. You can close this tab and go back to DoTask.`
    } else {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      stream.getTracks().forEach(t => t.stop())
      status.className = 'ok'
      status.textContent = 'Microphone allowed. You can close this tab and go back to DoTask.'
    }
    setTimeout(() => window.close(), 2500)
  } catch (e) {
    if (e.name === 'AbortError') return
    status.className = 'err'
    status.textContent = folderMode
      ? `Could not add the folder: ${e.message}`
      : 'Microphone was blocked. Click the icon at the left of the address bar, allow the microphone, then try again.'
  }
})
