import type { Browser, Page } from 'puppeteer'
import 'koishi'

declare module 'koishi' {
  interface Context {
    /**
     * puppeteer 插件提供的服务接口：
     * launch(): Promise<void>
     * close(): Promise<void>
     * page(): Promise<Page>
     */
    puppeteer: {
      launch(): Promise<void>
      close(): Promise<void>
      page(): Promise<Page>
    }
  }
}
