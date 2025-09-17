/**
 * Steam API: ISteamRemoteStorage/GetPublishedFileDetails/v1
 * 返回数据类型定义
 */

export interface WorkshopFileDetail {
  publishedfileid: string
  result: number
  creator: string
  creator_app_id: number
  consumer_app_id: number
  filename: string
  file_size: string
  file_url: string
  hcontent_file: string
  preview_url: string
  hcontent_preview: string
  title: string
  description: string
  time_created: number
  time_updated: number
  visibility: number
  banned: number
  ban_reason: string
  subscriptions: number
  favorited: number
  lifetime_subscriptions: number
  lifetime_favorited: number
  views: number
  tags: { tag: string }[]
}

export interface WorkshopFileResponse {
  response: {
    result: number
    resultcount: number
    publishedfiledetails: WorkshopFileDetail[]
  }
}

// ---------- 正确的类型：QueryFiles ----------
interface QueryFilesItem {
  publishedfileid: string
  // 注意：QueryFiles 的字段很少，通常只给 id、部分元数据（不同版本差异较大）
}

export interface QueryFilesResp {
  response: {
    total: number
    // 有的文档/实现叫 results，有的直接返回 publishedfileid 列表，这里做宽松兼容
    results?: QueryFilesItem[]
    publishedfiledetails: PublishedFileDetails[]         // 少见形态，兜底
  }
}

// ---------- 正确的类型：GetPublishedFileDetails ----------
interface TagEntry {
  tag: string;
  display_name?: string
}

interface VoteData {
  score?: number;
  votes_up?: number;
  votes_down?: number
}

export interface PublishedFileDetails {
  result: number
  publishedfileid: string
  title?: string
  file_description?: string
  preview_url?: string
  filename?: string
  file_size?: string | number
  time_created?: number
  time_updated?: number
  subscriptions?: number
  favorited?: number
  views?: number
  tags?: TagEntry[]
  vote_data?: VoteData
  // ……还有很多可选字段，这里按需追加
}

export interface NormalizedWorkshopItem {
  id: string
  title?: string
  desc?: string
  preview?: string
  size?: number | null
  updatedAt?: number
  createdAt?: number
  subs?: number
  favs?: number
  views?: number
  tags?: string[]
  score?: number
}
