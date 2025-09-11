import fs from 'node:fs'
import path from 'node:path'
import archiver, { Archiver } from 'archiver'

type ZipOptions = {
  keepRootDirName?: boolean
  ignore?: string[]
  noCompressExts?: string[]
}

// 本地扩展：给 ZIP 条目加上 store（仅打包不压缩）
type ZipEntryDataWithStore = archiver.EntryData & { store?: boolean }

export async function zipDirectory(
  dirPath: string,
  outputZipPath: string,
  options: ZipOptions = {}
): Promise<void> {
  const {
    keepRootDirName = true,
    ignore = [],
    noCompressExts = [
      'jpg','jpeg','png','gif','webp','svg','ico',
      'mp4','mov','avi','mkv','mp3','aac','flac','ogg',
      'zip','rar','7z','gz','bz2','xz','pdf','woff','woff2'
    ],
  } = options

  const rel = path.relative(dirPath, outputZipPath)
  if (!rel.startsWith('..') && !path.isAbsolute(rel)) {
    throw new Error(`outputZipPath 不能位于被压缩目录内：\n- dirPath: ${dirPath}\n- outputZipPath: ${outputZipPath}`)
  }

  await fs.promises.mkdir(path.dirname(outputZipPath), { recursive: true })

  const output = fs.createWriteStream(outputZipPath)
  const archive = archiver('zip', { zlib: { level: 9 } })

  const done = new Promise<void>((resolve, reject) => {
    output.on('close', () => resolve())
    archive.on('warning', (err) => ((err as any).code === 'ENOENT' ? console.warn(err) : reject(err)))
    archive.on('error', reject)
  })

  archive.pipe(output)

  async function addDir(current: string, baseInZip: string) {
    const entries = await fs.promises.readdir(current, { withFileTypes: true })
    for (const ent of entries) {
      const abs = path.join(current, ent.name)
      const relFromRoot = path.relative(dirPath, abs).split(path.sep).join('/')

      if (ignore.some((pat) => matchSimple(relFromRoot, pat))) continue

      if (ent.isDirectory()) {
        await addDir(abs, path.posix.join(baseInZip, ent.name))
      } else if (ent.isFile()) {
        const ext = path.extname(ent.name).slice(1).toLowerCase()
        const inZipName = path.posix.join(baseInZip, ent.name)
        const onlyStore = noCompressExts.includes(ext)

        if (onlyStore) {
          // 使用 append，可以带 store
          archive.append(fs.createReadStream(abs), { name: inZipName, store: true } as ZipEntryDataWithStore)
        } else {
          // 普通文件继续用 file
          archive.file(abs, { name: inZipName })
        }
      }
    }
  }

  const rootName = keepRootDirName ? path.basename(dirPath) : ''
  await addDir(dirPath, rootName)

  await archive.finalize()
  await done
}

function matchSimple(target: string, pattern: string): boolean {
  if (pattern.startsWith('**/')) pattern = pattern.slice(3)
  if (pattern.endsWith('/**')) pattern = pattern.slice(0, -3)
  if (pattern.startsWith('*') && pattern.endsWith('*')) {
    const token = pattern.slice(1, -1)
    return target.includes(token)
  }
  if (pattern.startsWith('*')) {
    const token = pattern.slice(1)
    return target.endsWith(token)
  }
  if (pattern.endsWith('*')) {
    const token = pattern.slice(0, -1)
    return target.startsWith(token)
  }
  return target === pattern
}
