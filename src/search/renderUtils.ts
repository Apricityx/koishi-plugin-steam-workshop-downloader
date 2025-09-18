// ===== 工具函数：HTML 转义 =====
export function escapeHtml(input: any): string {
  return String(input ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// ===== 工具函数：字节 -> MB 字符串 =====
export function formatFileSizeMB(bytes?: string | number): string {
  if (bytes == null || isNaN(Number(bytes))) return '—'
  const mb = Number(bytes) / 1024 / 1024
  return `${mb.toFixed(2)} MB`
}

// ===== 工具函数：Unix 秒 -> 本地时间字符串 =====
export function formatUpdateTime(sec?: number): string {
  if (!sec || !Number.isFinite(sec)) return '—'
  const d = new Date(sec * 1000)
  return d.toLocaleString()
}
