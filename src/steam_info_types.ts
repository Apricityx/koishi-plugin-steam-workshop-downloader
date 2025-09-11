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
