import fs from 'node:fs'
import path from 'node:path'
import archiver from 'archiver'

type ZipOptions = {
  keepRootDirName?: boolean
  ignore?: string[]
  noCompressExts?: string[]
}

// 本地扩展：给 ZIP 条目加上 store（仅打包不压缩）
type ZipEntryDataWithStore = archiver.EntryData & { store?: boolean }


/**
 * 打包文件为 zip（支持可选密码加密）
 * @param files  绝对路径数组（文件或目录）
 * @param outputDir 输出目录（注意：这里是目录，不是文件）
 * @param result_file_name
 * @param password 可选；若提供则使用 AES-256 加密，并把密码写入文件名
 * @returns 生成的 zip 文件的绝对路径
 */


export async function createZip(
  files: string[],
  outputDir: string,
  result_file_name: string,
  password?: string,
): Promise<string> {
  const absOutputDir = path.resolve(outputDir)
  await fs.promises.mkdir(absOutputDir, { recursive: true })

  const safePwd = password ? password.replace(/[^a-zA-Z0-9._-]/g, '_') : ''
  const safeBase = sanitizeFilename(result_file_name)
  const baseName = password ? `${safeBase}_pw-${safePwd}.zip` : `${safeBase}.zip`
  const zipPath = path.join(absOutputDir, baseName)

  const output = fs.createWriteStream(zipPath)
  const archive = password
    ? (archiver as any)('zip-encrypted', { zlib: { level: 9 }, encryptionMethod: 'aes256', password } as any)
    : archiver('zip', { zlib: { level: 9 } })

  const done = new Promise<void>((resolve, reject) => {
    output.on('close', resolve)
    archive.on('warning', (err: any) => (err.code === 'ENOENT' ? console.warn(err) : reject(err)))
    archive.on('error', reject)
  })

  archive.pipe(output)
  for (const file of files) {
    const stat = await fs.promises.stat(file)
    if (stat.isFile()) archive.file(file, { name: path.basename(file) })
    else if (stat.isDirectory()) archive.directory(file, path.basename(file))
    else console.warn(`[createZip] Skip unsupported path: ${file}`)
  }
  await archive.finalize()
  await done
  return zipPath
}

function sanitizeFilename(name: string) {
  return name
    .replace(/[\/\\]/g, '_')                    // 路径分隔符 -> 下划线
    .replace(/[\u0000-\u001F\u007F]/g, '')      // 控制字符
    .replace(/[<>:"|?*]/g, '_')                 // 其他常见非法字符
    .replace(/\s+/g, ' ')                       // 压缩连续空格
    .trim()
    .slice(0, 200);                              // 可选：限制长度
}
