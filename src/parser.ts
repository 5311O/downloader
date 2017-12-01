import * as http from './http'
import { JSDOM } from 'jsdom'
import * as async from './async'
import * as path from 'path'
import * as fs from 'fs'
import * as file from './file'
import { RestartError } from './http';
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env' })

// https://github.com/coolaj86/knuth-shuffle
function shuffle(array: any[]) {
    let currentIndex = array.length, temporaryValue, randomIndex

    // While there remain elements to shuffle...
    while (0 !== currentIndex) {

        // Pick a remaining element...
        randomIndex = Math.floor(Math.random() * currentIndex)
        currentIndex -= 1

        // And swap it with the current element.
        temporaryValue = array[currentIndex]
        array[currentIndex] = array[randomIndex]
        array[randomIndex] = temporaryValue
    }

    return array;
}

async function chunkify(tail: ((...args: any[]) => Promise<any>)[], groupSize = 16): Promise<any> {
    if (tail.length <= groupSize) return tail.map(t => t())

    const head = shuffle(tail.splice(0, groupSize))

    const headResults = await Promise.all(head.map(h => h()))
    const tailResults = await chunkify(shuffle(tail))

    return [...headResults, ...tailResults]
}

function jQuery(doc: string) {
    const { window } = new JSDOM(doc)
    const JQ = require('jquery')(window)
    return JQ
}

const errors: Error[] = []

export default class Parser {

    async crawl() {
        try {
            await this.downloadFromPage()
        } catch {
            console.warn('unable to download from front page')
        }

        const $ = await this.getJqueryDocument()
        const pagesLinks = this.getPagesLinks($)
        const pagesPromises = await chunkify(pagesLinks.map(pl => () => {
            return this.downloadFromPage(pl).catch(e => {
                errors.push(e)
                console.warn(`%O`, e)
                return []
            })
        }))

        await Promise.all(pagesPromises)
        if (errors.length) throw new RestartError()
    }

    private async getJqueryDocument(url?: string) {
        const response = await http.request(url)
        if (!response || !response.ok) throw new Error('Cannot get document')
        const html = await response.text()
        return jQuery(html)
    }

    async downloadFromPage(pageLink?: string): Promise<any> {
        console.log(`Fetching ${pageLink ? pageLink : 'front'} page`)

        const $ = await this.getJqueryDocument(pageLink)
        const hrefs = this.parsePage($)

        const downloadedItems = await chunkify(hrefs.map(href => () => {
            return this.downloadItem(href).catch(e => {
                errors.push(e)
                console.warn(`%O`, e)
                return []
            })
        }))

        return await Promise.all(downloadedItems)
    }

    async downloadItem(href: string): Promise<any> {
        try {
            console.log(`Fetching ${href} item`)
            const $ = await this.getJqueryDocument(href)
            const body = $('body').html()
            let [data = '{}'] = body
                .replace(/[\r\n]/g, '')
                .replace(/\t/g, ' ')
                .match(/data =\s*(\{.+\})\;\s*var manga/gi) || []

            data = data.replace('; var manga', '').replace('data =  ', '').replace(',]', ']').replace(`\\'`, `'`)
            const jsData = JSON.parse(data)
            const title = jsData.meta.name
            const fullUrls: string[] = jsData.fullimg
            console.log(`Getting item: ${href}`)
            const dirPath = path.join(process.env['SAVE_TO_DIR'], `${title}`)

            const dirAlreadyExist = await file.exists(dirPath)
            if (!dirAlreadyExist) await file.mkdirp(dirPath)

            const metadataPath = path.join(`${dirPath}`, `${title}-metadata.json`)
            const metadataExist = await file.exists(metadataPath)

            if (!metadataExist) {
                try {
                    await file.write(metadataPath, data)
                } catch {
                    console.warn(`Unable to save metadata ${metadataPath}`)
                }
            }

            const imagesChunks = await chunkify(fullUrls.map(url => () => {
                return http.downloadImage(url, dirPath).catch(e => {
                    errors.push(e)
                    console.warn(`%O`, e)
                    return []
                })
            }))

            return await Promise.all(imagesChunks)
        } catch (e) {
            errors.push(e)
            console.warn(`%O`, e)
            return []
        }
    }

    getPagesLinks($: JQueryStatic<HTMLElement>): string[] {
        const pagination = $('#pagination > span')
        const links = pagination.find('a')
        const pagesLinks = $.map(links, (el: any) => {
            return http.formatQueryUrl(`${el.href}`)
        })
        return pagesLinks
    }

    getItemsHrefs (content: JQuery<Element>, $: JQueryStatic<HTMLElement>) {
        const rows = content.find('.content_row')
        const hrefsEls = $.map(rows, (row: any) => $(row).find('.manga_images > a:first-child'))
        const hrefs =  $.map(hrefsEls, (hrefEl: any) => {
            return http.formatRootUrl(`${hrefEl.prop('href')}`)
        })
        return hrefs.map(str => str.replace(/\/manga\//i, '/online/'))
    }

    parsePage($: JQueryStatic<HTMLElement>): string[] {
        const content = $('#content')
        const hrefs = this.getItemsHrefs(content, $)
        return [...hrefs]
    }
}