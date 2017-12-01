import fetch from 'node-fetch'
import * as fs from 'fs'
import * as file from './file'
import * as path from 'path'
import * as dotenv from 'dotenv'

export class RestartError extends Error {}

let errors: Error[] = []

const sessionFilePath = 'session.tmp'
dotenv.config({ path: '.env' })
const baseUrl = process.env['BASE_URL']
const queryUrl = encodeURI(`${baseUrl}${process.env['QUERY_URL']}`)
export let cookies: any = {}

async function login() {
    const FormData = require('form-data')
    const form = new FormData()

    const formData: any = JSON.parse(process.env['LOGIN_FORM'])
    // tslint:disable-next-line:prefer-const
    for (let key in formData) {
        form.append(key, formData[key])
    }

    const response = await fetch(baseUrl, { method: 'POST', body: form })
    const cookieHeaders = response.headers.getAll('set-cookie')
    fs.writeFileSync(sessionFilePath, JSON.stringify(cookieHeaders))
    return cookieHeaders
}

export async function head(url: string) {
    return await request(url, { method: 'HEAD' })
}

export async function request(url: string = queryUrl, options?: any) {
    // if (!force) await timeout()
    const cookie = Object.keys(cookies).map(key => cookies[key]).join('; ')
    const cookieHeaders = cookie ? { 'Cookie': cookie } : {}
    const fetchRequest = async () => {
        return await fetch(url, {
            ...options,
            // timeout: 20e3,
            headers: {
                ...cookieHeaders,
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/jpeg,image/apng,*/*;q=0.8',
                'Accept-Encoding': 'gzip, deflate',
                'Connection': 'keep-alive',
                'Host': getLocation(url).host,
                'Upgrade-Insecure-Requests': '1',
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_13_1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/63.0.3239.52 Safari/537.36'
            }
        })
    }

    const retry = async (er: any) => {
        console.warn(`Error ocurred, retrying: ${er}`)
        return await fetchRequest()
    }

    try {
        return await fetchRequest()

    } catch (e) {
        try {
            return await retry(e)
        } catch (e) {
            if (errors.length === 5) {
                errors = []
                throw new RestartError()
            }
            errors.push(e)
        }
    }
}

function getLocation(href: string) {
    const match = href.match(/^(https?\:)\/\/(([^:\/?#]*)(?:\:([0-9]+))?)([\/]{0,1}[^?#]*)(\?[^#]*|)(#.*|)$/);
    return match && {
        href: href,
        protocol: match[1],
        host: match[2],
        hostname: match[3],
        port: match[4],
        pathname: match[5],
        search: match[6],
        hash: match[7]
    }
}

export async function initializeSession(onInit: (...args: any[]) => Promise<any>) {
    try {
        const session = await file.read(sessionFilePath, 'utf-8')
        const savedSession = JSON.parse(session.toString())
        cookies = savedSession
    } catch (e) {
        cookies = await login()
    }

    try {
        await onInit()
    } catch {
        cookies = await login()
        await onInit()
    }
}

export async function clearSession() {
    if (await file.exists(sessionFilePath))
        await file.unlink(sessionFilePath)
}

export function formatRootUrl(url: string) {
    return `${baseUrl}${url}`
}

export function formatQueryUrl(url: string) {
    return `${queryUrl}${url}`
}

export async function downloadImage(href: string, dirPath: string) {
    const [_, fileName = href] = href.match(/.*\/(.*\.jpg)$/) || [, ]
    const filePath = path.join(`${dirPath}`, `${fileName}`)

    const fileExist = await file.exists(filePath)

    if (fileExist) {
        console.info(`Skipping already downloaded image ${filePath}`)
        const stats = await file.stat(filePath)
        const fileSizeInBytes = stats.size

        const headResponse = await head(href)
        if (!headResponse || !headResponse.ok) { return }

        const contentLength = Number(headResponse.headers.getAll('content-length'))
        const fileEqual = fileSizeInBytes === contentLength
        if (fileEqual) return
    }
    let timer: NodeJS.Timer

    try {
        const destPath = await new Promise(async (res, rej) => {
            const errorHandler = (e: any) => {
                if (e instanceof RestartError) throw e
                rej({reason: 'Unable to download file', meta: {href, e}})
            }

            try {
                console.log(`Downloading file: ${href}`)

                const response = await request(href)
                if (!response || !response.ok) { return }
                const FILE_DOWNLOAD_TIMEOUT = 8e3
                const stream = file.createWriteStream(filePath)

                response.body
                .on('error', errorHandler)
                .pipe(stream)

                stream
                .on('open', () => {
                    timer = setTimeout(() => {
                    stream.close()
                    rej({reason: 'Timed out downloading file', meta: {href}})
                    }, FILE_DOWNLOAD_TIMEOUT)
                })
                .on('error', errorHandler)
                .on('finish', () => {
                    console.log(`Downloaded file: ${href}`)
                    res(filePath)
                })
            } catch (e) {
                errorHandler(e)
            }
        })

        clearTimeout(timer)
        return destPath
    } catch (err) {
        clearTimeout(timer)
        console.warn(err)
        throw err
    }
}