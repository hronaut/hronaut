const { app, clipboard } = require('electron')

app.whenReady().then(() => {
  const image = clipboard.readImage()
  const size = image.getSize()
  process.stdout.write(JSON.stringify({
    empty: image.isEmpty(),
    width: size.width,
    height: size.height,
    hasPng: clipboard.availableFormats().includes('image/png')
  }))
  app.exit(image.isEmpty() ? 1 : 0)
}).catch((error) => {
  process.stderr.write(String(error))
  app.exit(1)
})
