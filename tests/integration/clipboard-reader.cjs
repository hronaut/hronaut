const { app, clipboard, nativeImage } = require('electron')

app.whenReady().then(async () => {
  const items = await clipboard.read()
  const png = items.find((item) => item.types.includes('image/png'))
  const data = png ? await (await png.getType('image/png')).arrayBuffer() : new ArrayBuffer(0)
  const image = nativeImage.createFromBuffer(Buffer.from(data))
  const size = image.getSize()
  process.stdout.write(JSON.stringify({
    empty: image.isEmpty(),
    width: size.width,
    height: size.height,
    hasPng: items.some((item) => item.types.includes('image/png'))
  }))
  app.exit(image.isEmpty() ? 1 : 0)
}).catch((error) => {
  process.stderr.write(String(error))
  app.exit(1)
})
