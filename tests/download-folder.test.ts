import { afterEach, describe, expect, it, vi } from 'vitest'
import { translate } from '../src/shared/i18n.js'

const fs = vi.hoisted(() => ({ mkdir: vi.fn() }))
vi.mock('node:fs/promises', () => fs)

const { createDownloadFolder } = await import('../src/main/download-folder.js')
const { LocalizedError, personErrorMessage } = await import('../src/main/localized-error.js')

// Settings → Downloads showed Node's English error, such as "EACCES: permission denied, mkdir '/media/usb/Downloads'",
// in every interface language when Hronaut could not create the download folder it was choosing or opening.

function nodeError(code: string, path = '/media/usb/Downloads'): NodeJS.ErrnoException {
  return Object.assign(new Error(`${code}: could not mkdir '${path}'`), { code, errno: -13, syscall: 'mkdir', path })
}

afterEach(() => { fs.mkdir.mockReset() })

describe('creating the download folder', () => {
  it('creates the folder and its parents', async () => {
    fs.mkdir.mockResolvedValue(undefined)
    await createDownloadFolder('/home/person/Downloads/Hronaut')
    expect(fs.mkdir).toHaveBeenCalledWith('/home/person/Downloads/Hronaut', { recursive: true })
  })

  it.each([
    ['EACCES', 'Hronaut does not have permission to create or use this download folder (EACCES). Choose another folder.'],
    ['EPERM', 'Hronaut does not have permission to create or use this download folder (EPERM). Choose another folder.'],
    ['ENOSPC', 'There is not enough disk space to create the download folder (ENOSPC).'],
    ['EDQUOT', 'There is not enough disk space to create the download folder (EDQUOT).'],
    ['EROFS', 'The download folder is on a read-only drive (EROFS). Choose another folder.'],
    ['EEXIST', 'A file is where the download folder should be (EEXIST). Choose another folder.'],
    ['ENOTDIR', 'A file is where the download folder should be (ENOTDIR). Choose another folder.'],
    ['EIO', 'Hronaut could not create the download folder (EIO).']
  ])('says why it could not create it for %s, without the path, and keeps Node\'s error for logs', async (code, sentence) => {
    const failure = nodeError(code)
    fs.mkdir.mockRejectedValue(failure)
    const error = await createDownloadFolder('/media/usb/Downloads').catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(LocalizedError)
    const text = (key: Parameters<typeof translate>[1], parameters?: Parameters<typeof translate>[2]) => translate('en-US', key, parameters)
    expect(personErrorMessage(error, text)).toBe(sentence)
    expect(personErrorMessage(error, text)).not.toContain('/media/usb')
    expect(error).toMatchObject({ message: failure.message, code, errno: -13, syscall: 'mkdir', path: '/media/usb/Downloads', cause: failure })
  })

  it('says it in the interface language', async () => {
    fs.mkdir.mockRejectedValue(nodeError('EACCES'))
    const error = await createDownloadFolder('/media/usb/Downloads').catch((caught: unknown) => caught)
    expect(personErrorMessage(error, (key, parameters) => translate('uk-UA', key, parameters)))
      .toBe('Hronaut не має дозволу створити або використовувати цю папку завантажень (EACCES). Виберіть іншу папку.')
  })

  it('keeps an error without a code as it is', async () => {
    const failure = new TypeError('The "path" argument must be of type string')
    fs.mkdir.mockRejectedValue(failure)
    await expect(createDownloadFolder('/media/usb/Downloads')).rejects.toBe(failure)
  })
})
